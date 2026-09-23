import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireLabSession,
  cleanupAbandonedLabDatabases,
  type LabSessionLease,
} from "@/features/sync-lab/core/session-storage";
import { resetIndexedDB } from "../setup/indexeddb";

const CURRENT = "11111111-1111-4111-8111-111111111111";
const ACTIVE = "22222222-2222-4222-8222-222222222222";
const ABANDONED = "33333333-3333-4333-8333-333333333333";
const database = (session: string, client = "client") =>
  `sync-lab-${session}-lab-${client}`;
const leases: LabSessionLease[] = [];
let originalLocks: PropertyDescriptor | undefined;

function installLocks() {
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      async request(
        name: string,
        options: LockOptions,
        callback: (lock: Lock | null) => Promise<void>,
      ) {
        expect(options).toMatchObject({ mode: "exclusive", ifAvailable: true });
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          await callback({ name, mode: "exclusive" });
        } finally {
          held.delete(name);
        }
      },
    },
  });
}

async function createDatabase(name: string) {
  const db = new Dexie(name);
  db.version(1).stores({ rows: "id" });
  try {
    await db.table("rows").put({ id: "preserve", content: name });
  } finally {
    db.close();
  }
}

beforeEach(() => {
  resetIndexedDB();
  originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
  installLocks();
});
afterEach(async () => {
  for (const lease of leases.splice(0)) await lease.release();
  if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
  else Reflect.deleteProperty(navigator, "locks");
  vi.restoreAllMocks();
});

describe("abandoned Sync Lab database cleanup", () => {
  it("deletes only abandoned client databases and preserves active or unrecognized databases", async () => {
    const keep = [
      database(CURRENT),
      database(ACTIVE),
      "epub-reader-db-v2",
      "sync-lab-migration-example",
      "sync-lab-unknown-lab-client",
      `sync-lab-${ABANDONED}-other-data`,
    ];
    const abandoned = [database(ABANDONED, "a"), database(ABANDONED, "b")];
    for (const name of [...keep, ...abandoned]) await createDatabase(name);
    leases.push(await acquireLabSession(ACTIVE));
    const result = await cleanupAbandonedLabDatabases(CURRENT);
    expect(result).toEqual({
      supported: true,
      deletedDatabases: 2,
      activeSessions: 1,
      failures: [],
    });
    const names = await Dexie.getDatabaseNames();
    for (const name of keep) expect(names).toContain(name);
    for (const name of abandoned) expect(names).not.toContain(name);
  });

  it("makes released sessions reclaimable and refuses duplicate leases immediately", async () => {
    await createDatabase(database(ACTIVE));
    const lease = await acquireLabSession(ACTIVE);
    leases.push(lease);
    await expect(acquireLabSession(ACTIVE)).rejects.toThrow("already active");
    expect((await cleanupAbandonedLabDatabases(CURRENT)).deletedDatabases).toBe(
      0,
    );
    await lease.release();
    expect((await cleanupAbandonedLabDatabases(CURRENT)).deletedDatabases).toBe(
      1,
    );
  });

  it("holds the session lock for the entire database deletion", async () => {
    await createDatabase(database(ABANDONED));
    let releaseDelete!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const deleting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const remove = Dexie.delete.bind(Dexie);
    vi.spyOn(Dexie, "delete").mockImplementation((name) => {
      started();
      return Dexie.Promise.resolve(gate).then(() => remove(name));
    });
    const cleanup = cleanupAbandonedLabDatabases(CURRENT);
    await deleting;
    await expect(acquireLabSession(ABANDONED)).rejects.toThrow(
      "already active",
    );
    releaseDelete();
    expect((await cleanup).deletedDatabases).toBe(1);
    leases.push(await acquireLabSession(ABANDONED));
  });

  it("does not enumerate or delete databases when Web Locks is unavailable", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    const enumerate = vi.spyOn(Dexie, "getDatabaseNames");
    const remove = vi.spyOn(Dexie, "delete");
    const lease = await acquireLabSession(CURRENT);
    expect(lease.supported).toBe(false);
    await lease.release();
    expect(await cleanupAbandonedLabDatabases(CURRENT)).toEqual({
      supported: false,
      deletedDatabases: 0,
      activeSessions: 0,
      failures: [],
    });
    expect(enumerate).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

import { test, expect } from "bun:test";
import {
  SyncClient,
  createSyncClientState,
  nextSyncHlcBatch,
  compareSyncVersions,
  encodeSyncKey,
  type SyncRecord,
  type SyncRemote,
  type SyncClientStateStore,
} from "@zsh-eng/local-sync";
import { installSync, DexieSyncStorage } from "@zsh-eng/local-sync/dexie";
import { SpacedDatabase } from "@/lib/db/persistence";
import { syncTables, toStoredOperation } from "@/lib/sync/records";
import { convertRow } from "../scripts/sync-migration/convert";
import type { Operation } from "@/lib/sync/schema";
import { createEmptyCard, Rating } from "ts-fsrs";
import { gradeCard } from "@/lib/review/review";

function relay() {
  let seq = 0;
  const records = new Map<string, SyncRecord>();
  const remote: SyncRemote = {
    async pull(device, query) {
      const head = query.head ?? seq;
      const all = [...records.values()]
        .filter(
          (r) =>
            r.serverSeq > query.cursor &&
            r.serverSeq <= head &&
            (!query.excludeOwnDevice || r.deviceId !== device),
        )
        .sort((a, b) => a.serverSeq - b.serverSeq);
      const page = all.slice(0, 2),
        hasMore = all.length > 2;
      return {
        records: page,
        head,
        cursor: hasMore ? page.at(-1)!.serverSeq : head,
        hasMore,
      };
    },
    async push(device, changes) {
      return {
        results: changes.map((change) => {
          const current = records.get(change.key);
          const candidate = { ...change, deviceId: device, serverSeq: seq + 1 };
          const accepted =
            !current || compareSyncVersions(candidate, current) > 0;
          if (accepted) {
            seq++;
            records.set(change.key, candidate);
          }
          return { accepted, winner: records.get(change.key)! };
        }),
      };
    },
  };
  return remote;
}
function client(remote: SyncRemote) {
  const name = crypto.randomUUID(),
    db = new SpacedDatabase(name),
    raw = new SpacedDatabase(name);
  let state = createSyncClientState(name),
    now = 10000;
  const store: SyncClientStateStore = {
    read: () => state,
    write: (s) => {
      state = s;
    },
  };
  installSync(db, syncTables, (n) => nextSyncHlcBatch(n, store, now));
  const storage = new DexieSyncStorage({ db: raw, tables: syncTables });
  const sync = new SyncClient({ storage, stateStore: store, remote });
  return {
    db,
    raw,
    sync,
    storage,
    store,
    setNow: (n: number) => {
      now = n;
    },
    async put(op: Operation) {
      await db.operations.put(toStoredOperation(op));
    },
    async close() {
      raw.close();
      await db.delete();
    },
  };
}
const membership = (present: boolean): Operation => ({
  type: "updateDeckCard",
  payload: { deckId: "deck", cardId: "card", present },
  timestamp: 1,
});

test("two clients converge on remove and re-add using HLC, independent of old CL counts", async () => {
  const remote = relay(),
    a = client(remote),
    b = client(remote);
  try {
    await a.put(membership(true));
    await a.sync.sync();
    await b.sync.sync();
    await a.put(membership(false));
    b.setNow(20000);
    await b.put(membership(true));
    await a.sync.sync();
    await b.sync.sync();
    await a.sync.sync();
    expect((await a.db.operations.toArray())[0]).toMatchObject({
      isDeleted: false,
      payload: { present: true },
    });
    expect(await a.db.operations.toArray()).toEqual(
      await b.db.operations.toArray(),
    );
    expect(await a.db._sync_outbox.count()).toBe(0);
    await b.put(membership(false));
    await b.sync.sync();
    await a.sync.sync();
    expect((await a.db.operations.toArray())[0]).toMatchObject({
      isDeleted: true,
      payload: { present: false },
    });
  } finally {
    await a.close();
    await b.close();
  }
});

test("interrupted paged bootstrap resumes without echo writes; independent card fields survive", async () => {
  const remote = relay(),
    a = client(remote);
  let fail = true;
  const b = client({
    ...remote,
    async pull(device, q) {
      if (fail && q.cursor > 0) throw Error("Offline");
      return remote.pull(device, q);
    },
  });
  try {
    await a.put({
      type: "cardContent",
      payload: { cardId: "card", front: "front", back: "back" },
      timestamp: 1,
    });
    await a.put({
      type: "cardBookmarked",
      payload: { cardId: "card", bookmarked: true },
      timestamp: 2,
    });
    await a.put(membership(true));
    await a.sync.sync();
    await expect(b.sync.sync()).rejects.toThrow("Offline");
    expect(b.store.read()?.bootstrapped).toBe(false);
    expect(await b.db.operations.count()).toBe(2);
    expect(await b.db._sync_outbox.count()).toBe(0);
    fail = false;
    await b.sync.sync();
    expect(b.store.read()?.bootstrapped).toBe(true);
    expect(await b.db.operations.toArray()).toEqual(
      await a.db.operations.toArray(),
    );
    await b.put({
      type: "cardContent",
      payload: { cardId: "card", front: "edited", back: "back" },
      timestamp: 0,
    });
    await b.sync.sync();
    await a.sync.sync();
    expect(
      (await a.db.operations.toArray()).find((r) => r.type === "cardContent")
        ?.payload,
    ).toMatchObject({ front: "edited" });
  } finally {
    await a.close();
    await b.close();
  }
});

test("invalid record family or identity fails before advancing the client cursor", async () => {
  const row = toStoredOperation(membership(true));
  const invalid: SyncRecord = {
    key: encodeSyncKey("reviewLogOperations", row.id),
    value: JSON.stringify(row),
    schemaVersion: 1,
    hlc: { wallTimeMs: 1, counter: 0 },
    deviceId: "other",
    isDeleted: false,
    serverSeq: 1,
  };
  const a = client({
    pull: async () => ({
      records: [invalid],
      head: 1,
      cursor: 1,
      hasMore: false,
    }),
    push: async () => ({ results: [] }),
  });
  try {
    await expect(a.sync.sync()).rejects.toThrow("wrong table");
    expect(a.store.read()?.pullCursor).toBe(0);
    expect(await a.db.reviewLogOperations.count()).toBe(0);
  } finally {
    await a.close();
  }
});

test("conversion preserves FSRS values and dates, backfills steps, and converts membership parity", () => {
  const row = {
    user_id: "user",
    last_modified: 123,
    last_modified_client: "legacy",
    id: "card",
    due: 120000,
    stability: 12,
    difficulty: 4,
    elapsed_days: 2,
    scheduled_days: 4,
    reps: 3,
    lapses: 1,
    state: "Review",
    last_review: 100000,
  };
  const { record } = convertRow("cards", row, 1);
  const decoded = JSON.parse(record.value);
  expect(decoded.payload).toMatchObject({
    id: "card",
    due: new Date(row.due).toISOString(),
    stability: 12,
    difficulty: 4,
    reps: 3,
    learning_steps: 0,
    last_review: new Date(row.last_review).toISOString(),
  });
  expect(record.hlc.wallTimeMs).toBe(123);
  for (const count of [0, 1, 2, 11, 12]) {
    const r = convertRow(
      "card_decks",
      { ...row, deck_id: "deck", card_id: "card", cl_count: count },
      2,
    ).record;
    expect(JSON.parse(r.value).payload.present).toBe(count % 2 === 1);
    expect(r.isDeleted).toBe(count % 2 === 0);
  }
});

test("FSRS-6 uses explicit learning steps and produces finite schedules without mutating input", () => {
  const now = new Date("2026-09-19T00:00:00Z"),
    card = createEmptyCard(now),
    before = structuredClone(card);
  const again = gradeCard(card, Rating.Again, now),
    good = gradeCard(card, Rating.Good, now);
  expect(again.nextCard.due.getTime() - now.getTime()).toBe(60000);
  expect(good.nextCard.due.getTime() - now.getTime()).toBe(600000);
  expect(good.nextCard.learning_steps).toBe(1);
  for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    const next = gradeCard(card, rating, now).nextCard;
    expect(
      Number.isFinite(next.stability) && Number.isFinite(next.due.getTime()),
    ).toBe(true);
  }
  expect(card).toEqual(before);
});

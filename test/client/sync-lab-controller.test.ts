import { Blob as NodeBlob } from "node:buffer";
import { computeFileId } from "@/lib/files/file-id";
import { SyncLabController } from "@/features/sync-lab/core/controller";
import {
  createSyncV2ApplicationDb,
  EPUBReaderSyncV2DB,
  SYNC_V2_SYNCED_TABLES,
} from "@/lib/sync-v2/db";
import { SyncV2Client } from "@/lib/sync-v2/sync";
import {
  readSyncClientState,
  writeSyncClientState,
} from "@/lib/sync-v2/client-state";
import type { ClientInspection, ClientPreset } from "@/features/sync-lab/types";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";

const labs: SyncLabController[] = [];
it("publishes changed connectivity without mutating the previous client view", async () => {
  const lab = await setup();
  const id = await lab.spawn("metadata");
  const before = lab.getSnapshot().clients[0]!;
  lab.setOnline(id, false);
  await Promise.resolve();
  const after = lab.getSnapshot().clients[0]!;
  expect(after).not.toBe(before);
  expect(before.networkState.online).toBe(true);
  expect(after.networkState.online).toBe(false);
});
afterEach(async () => {
  for (const lab of labs.splice(0)) await lab.dispose();
});
async function setup() {
  const lab = new SyncLabController();
  labs.push(lab);
  await lab.setSeed({
    name: "Test baseline",
    rows: {
      notes: [
        {
          id: "note-a",
          bookId: "book-a",
          content: "baseline",
          isDeleted: false,
        },
      ],
    },
    files: [],
  });
  return lab;
}
async function attach(lab: SyncLabController, id: string) {
  const config = lab.connect(id);
  const app = createSyncV2ApplicationDb(config.databaseName, {
    deviceId: config.deviceId,
    storage: config.storage,
    now: config.now,
  });
  const raw = new EPUBReaderSyncV2DB(config.databaseName);
  await Promise.all([app.open(), raw.open()]);
  const sync = new SyncV2Client({
    syncDb: raw,
    remote: config.syncRemote,
    stateStorage: config.storage,
  });
  lab.attach(id, {
    async inspect() {
      return {
        rows: Object.fromEntries(
          await Promise.all(
            SYNC_V2_SYNCED_TABLES.map(async (table) => [
              table,
              await raw.table(table).toArray(),
            ]),
          ),
        ),
        outbox: await raw._sync_outbox.toArray(),
        files: [],
        materialized: [],
        state: readSyncClientState(config.storage),
      } as ClientInspection;
    },
    async command(command) {
      if (command.type === "sync") {
        await sync.sync();
        return;
      }
      if (command.type === "pull") {
        await sync.pull();
        return;
      }
      if (command.type === "push") {
        await sync.push();
        return;
      }
      if (command.type === "note")
        await app.table("notes").put({
          id: "note-a",
          bookId: "book-a",
          content: command.content,
          isDeleted: false,
        });
    },
    async snapshot() {
      return Object.fromEntries(
        await Promise.all(
          raw.tables.map(async (table) => [table.name, await table.toArray()]),
        ),
      );
    },
    async stop() {
      app.close();
      raw.close();
    },
  });
  return { id, app, raw, sync, config };
}
async function spawn(lab: SyncLabController, preset: ClientPreset) {
  return attach(lab, await lab.spawn(preset));
}

describe("Sync Lab controller with real sync and isolated databases", () => {
  it("bootstraps an empty client and starts metadata clients without pending changes", async () => {
    const lab = await setup();
    const empty = await spawn(lab, "empty");
    expect(await empty.raw.notes.count()).toBe(0);
    await lab.command(empty.id, { type: "sync" });
    expect(await empty.raw.notes.get("note-a")).toMatchObject({
      content: "baseline",
    });
    const seeded = await spawn(lab, "metadata");
    expect(await seeded.raw.notes.get("note-a")).toMatchObject({
      content: "baseline",
    });
    expect(await seeded.raw._sync_outbox.count()).toBe(0);
    expect(readSyncClientState(seeded.config.storage)).toMatchObject({
      bootstrapped: true,
      pullCursor: 1,
    });
  });
  it("spawns from current server rows after earlier clients changed the baseline", async () => {
    const lab = await setup();
    const a = await spawn(lab, "metadata");
    await lab.command(a.id, {
      type: "note",
      bookId: "book-a",
      content: "changed on A",
    });
    await lab.command(a.id, { type: "sync" });
    const b = await spawn(lab, "metadata");
    expect(await b.raw.notes.get("note-a")).toMatchObject({
      content: "changed on A",
    });
    await lab.command(b.id, { type: "sync" });
    expect(await b.raw.notes.get("note-a")).toMatchObject({
      content: "changed on A",
    });
  });
  it("converges concurrent offline writes after reconnect and repeated sync", async () => {
    const lab = await setup();
    const a = await spawn(lab, "metadata");
    const b = await spawn(lab, "metadata");
    lab.setOnline(a.id, false);
    lab.setOnline(b.id, false);
    await lab.command(a.id, {
      type: "note",
      bookId: "book-a",
      content: "first edit",
    });
    lab.configure(b.id, { clockOffset: 1000 });
    await lab.command(b.id, {
      type: "note",
      bookId: "book-a",
      content: "winning edit",
    });
    await expect(lab.command(a.id, { type: "sync" })).rejects.toThrow(
      "offline",
    );
    expect(await a.raw._sync_outbox.count()).toBe(1);
    lab.setOnline(a.id, true);
    lab.setOnline(b.id, true);
    await lab.command(a.id, { type: "sync" });
    await lab.command(b.id, { type: "sync" });
    await lab.command(a.id, { type: "sync" });
    expect(await a.raw.notes.get("note-a")).toMatchObject({
      content: "winning edit",
    });
    expect(await b.raw.notes.get("note-a")).toMatchObject({
      content: "winning edit",
    });
    expect(await a.raw._sync_outbox.count()).toBe(0);
    expect(await b.raw._sync_outbox.count()).toBe(0);
  });
  it("restores rows, cursor, network and clocks without writing to another database", async () => {
    const sourceName = `sync-lab-source-witness-${crypto.randomUUID()}`;
    const source = new Dexie(sourceName);
    source.version(1).stores({ witness: "id" });
    await source
      .table("witness")
      .put({ id: "keep", value: "source unchanged" });
    try {
      const lab = await setup();
      const client = await spawn(lab, "metadata");
      lab.setOnline(client.id, false);
      lab.configure(client.id, { clockOffset: 2000, latencyMs: 10 });
      lab.advanceClock(5000);
      const snapshot = await lab.checkpoint("Before edit");
      await attach(lab, client.id);
      await lab.command(client.id, {
        type: "note",
        bookId: "book-a",
        content: "discard",
      });
      await lab.restore(snapshot);
      const restored = await attach(lab, client.id);
      expect(await restored.raw.notes.get("note-a")).toMatchObject({
        content: "baseline",
      });
      expect(readSyncClientState(restored.config.storage)).toEqual(
        JSON.parse(snapshot.clients[0]!.storage["epub-reader-sync-v2-state"]!),
      );
      expect(restored.config.isOnline()).toBe(false);
      expect(lab.getSnapshot().elapsedMs).toBe(5000);
      expect(await source.table("witness").get("keep")).toEqual({
        id: "keep",
        value: "source unchanged",
      });
    } finally {
      source.close();
      await Dexie.delete(sourceName);
    }
  });
  it("captures storage after snapshots drain, then stops endpoints and restarts frames", async () => {
    const lab = await setup();
    const client = await spawn(lab, "metadata");
    await lab.refresh();
    const view = lab
      .getSnapshot()
      .clients.find((item) => item.id === client.id)!;
    const endpoint = view.endpoint!;
    const previousRevision = view.revision;
    const order: string[] = [];
    lab.attach(client.id, {
      ...endpoint,
      async snapshot() {
        const database = await endpoint.snapshot();
        const state = readSyncClientState(client.config.storage)!;
        writeSyncClientState(
          { ...state, hlc: { ...state.hlc, counter: state.hlc.counter + 9 } },
          client.config.storage,
        );
        order.push("drained");
        return database;
      },
      async stop() {
        order.push("stopped");
        await endpoint.stop();
      },
    });
    const saved = await lab.checkpoint("After drain");
    expect(
      JSON.parse(saved.clients[0]!.storage["epub-reader-sync-v2-state"]!),
    ).toEqual(readSyncClientState(client.config.storage));
    expect(order).toEqual(["drained", "stopped"]);
    const restarted = lab
      .getSnapshot()
      .clients.find((item) => item.id === client.id)!;
    expect(restarted.endpoint).toBeUndefined();
    expect(restarted.revision).toBe(previousRevision + 1);
    expect(client.app.isOpen()).toBe(false);
    expect(client.raw.isOpen()).toBe(false);
  });
  it("replaces an earlier reconnect deadline and manual connectivity cancels it", async () => {
    const lab = await setup();
    const client = await spawn(lab, "metadata");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      lab.offlineFor(client.id, 10);
      await vi.advanceTimersByTimeAsync(3000);
      lab.offlineFor(client.id, 20);
      await vi.advanceTimersByTimeAsync(7000);
      expect(client.config.isOnline()).toBe(false);
      await vi.advanceTimersByTimeAsync(13000);
      expect(client.config.isOnline()).toBe(true);
      lab.offlineFor(client.id, 10);
      lab.setOnline(client.id, false);
      await vi.advanceTimersByTimeAsync(10000);
      expect(client.config.isOnline()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves remaining offline time and restarts that duration after restore", async () => {
    const lab = await setup();
    const client = await spawn(lab, "metadata");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      lab.offlineFor(client.id, 10);
      await vi.advanceTimersByTimeAsync(3000);
      const saved = await lab.checkpoint("Seven seconds remain");
      expect(saved.clients[0]!.reconnectAfterMs).toBe(7000);
      expect(saved.clients[0]!.network.online).toBe(false);
      await vi.advanceTimersByTimeAsync(10000);
      await lab.restore(saved);
      const restored = lab.connect(client.id);
      expect(restored.isOnline()).toBe(false);
      await vi.advanceTimersByTimeAsync(6999);
      expect(restored.isOnline()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(restored.isOnline()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("spawns downloaded clients with bytes uploaded after the original baseline", async () => {
    vi.stubGlobal("Blob", NodeBlob);
    try {
      const lab = await setup();
      const blob = new Blob(["EPUB bytes uploaded after baseline"], {
        type: "application/epub+zip",
      });
      const fileId = await computeFileId(blob);
      await lab.server.files.put(fileId, blob, blob.type);
      const client = await spawn(lab, "downloaded");
      const local = await client.raw.files.get(fileId);
      expect(local).toMatchObject({
        id: fileId,
        size: blob.size,
        remotePresent: true,
      });
      expect(new Uint8Array(await local!.blob.arrayBuffer())).toEqual(
        new Uint8Array(await blob.arrayBuffer()),
      );
      expect(await client.raw.fileUploadOperations.count()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

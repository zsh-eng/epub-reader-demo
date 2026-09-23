import { liveQuery } from "dexie";
import { getLabRuntime, subscribeRuntimeOnline, drainLabWork } from "./runtime";
import type {
  ClientCommand,
  ClientInspection,
  DatabaseSnapshot,
  LabClientEndpoint,
} from "./types";
import {
  syncV2Db as db,
  syncV2SyncDb as raw,
  SYNC_V2_SYNCED_TABLES,
} from "@/lib/sync-v2/db";
import { SyncV2Client } from "@/lib/sync-v2/sync";
import { readSyncClientState } from "@/lib/sync-v2/client-state";
import { upsertCurrentDeviceReadingCheckpoint } from "@/data/reading-checkpoints";
import { files } from "@/lib/files/files-manager";
import { syncService } from "@/lib/sync-service";

/** Both presentation modes use this same client. Only app mode mounts React/Reader. */
export async function startLabClient(
  id: string,
  unmountUI: () => void | Promise<void> = () => {},
): Promise<LabClientEndpoint> {
  const runtime = getLabRuntime()!;
  const host = window.parent.__syncLabHost!;
  await Promise.all([db.open(), raw.open()]);
  const client = new SyncV2Client({
    syncDb: raw,
    remote: runtime.syncRemote,
    stateStorage: runtime.storage,
    onEvent: (event) => host.event(id, event),
  });
  let active: Promise<void> = Promise.resolve();
  let suspended = false;
  let pendingCommands = 0;
  let quiescing: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  const updateUploads = () => {
    if (!suspended && runtime.isOnline()) files.resumeUploads();
    else files.pauseUploads();
  };
  const unsubscribeOnline = subscribeRuntimeOnline(updateUploads);
  updateUploads();
  syncService.startPeriodicSync();

  // React cleanup saves the last Reader position. Keep databases open until
  // those writes and every request issued before suspension have completed.
  function quiesce(): Promise<void> {
    if (quiescing) return quiescing;
    suspended = true;
    syncService.stopPeriodicSync();
    files.pauseUploads();
    quiescing = (async () => {
      await unmountUI();
      await drainLabWork();
      await active;
      await Promise.all([syncService.drain(), files.drain()]);
      await raw.transaction("rw", raw.tables, () => {});
    })();
    return quiescing;
  }
  const subscription = liveQuery(() => db._sync_outbox.toArray()).subscribe(
    (rows) => {
      host.event(id, {
        phase: "local",
        outcome: `${rows.length} pending changes`,
        key: "",
      });
    },
  );
  const endpoint: LabClientEndpoint = {
    async inspect() {
      const rows = Object.fromEntries(
        await Promise.all(
          SYNC_V2_SYNCED_TABLES.map(async (name) => [
            name,
            await raw.table(name).toArray(),
          ]),
        ),
      );
      return {
        rows,
        outbox: await raw._sync_outbox.toArray(),
        files: (await raw.files.toArray()).map((file) => ({
          id: file.id,
          size: file.size,
        })),
        materialized: (await raw.bookMaterializations.toArray()).map(
          (item) => item.bookId,
        ),
        state: readSyncClientState(runtime.storage),
      } as ClientInspection;
    },
    command(command) {
      if (suspended)
        return Promise.reject(new Error("This client is suspended."));
      pendingCommands++;
      syncService.stopPeriodicSync();
      const run = active
        .then(async () => {
          await syncService.drain();
          await execute(command);
        })
        .finally(() => {
          pendingCommands--;
          if (!suspended && pendingCommands === 0)
            syncService.startPeriodicSync();
        });
      active = run.catch(() => {});
      return run;
    },
    async snapshot() {
      await quiesce();
      return raw.transaction("r", raw.tables, async () =>
        Object.fromEntries(
          await Promise.all(
            raw.tables.map(async (table) => [
              table.name,
              await table.toArray(),
            ]),
          ),
        ),
      ) as Promise<DatabaseSnapshot>;
    },
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        await quiesce();
        unsubscribeOnline();
        syncService.dispose();
        subscription.unsubscribe();
        db.close();
        raw.close();
      })();
      return stopping;
    },
  };
  async function execute(command: ClientCommand) {
    if (command.type === "sync") {
      await syncService.syncAll();
      return;
    }
    if (command.type === "pull") {
      await client.pull();
      return;
    }
    if (command.type === "push") {
      await client.push();
      return;
    }
    const book = await db.books.get(command.bookId);
    if (!book || book.isDeleted)
      throw new Error("Select an available book first.");
    if (command.type === "download") {
      await files.get(book.sourceFileId);
      return;
    }
    if (command.type === "checkpoint") {
      await upsertCurrentDeviceReadingCheckpoint({
        bookId: book.id,
        currentSpineIndex: 0,
        scrollProgress: command.progress,
        lastRead: runtime.now(),
      });
      return;
    }
    const noteId = `lab-note:${book.id}`;
    if (command.type === "delete-note") {
      await db.notes.delete(noteId);
      return;
    }
    const existing = await db.notes.get(noteId);
    await db.notes.put({
      id: noteId,
      bookId: book.id,
      kind: "note",
      content: command.content,
      anchor: {
        spineItemId: book.spine[0]?.idref ?? "",
        startOffset: 0,
        endOffset: 0,
        textBefore: "",
        textAfter: "",
      },
      createdAt: existing?.createdAt ?? runtime.now(),
      updatedAt: runtime.now(),
      isDeleted: false,
    });
  }
  host.attach(id, endpoint);
  return endpoint;
}

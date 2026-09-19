import Dexie from "dexie";
import { deckRecord } from "../sync-fixtures";
import assert from "node:assert/strict";
import SyncEngine from "@/lib/sync/engine";
import { db, rawDb } from "@/lib/db/persistence";
import { setClientId } from "@/lib/sync/meta";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
await setClientId("write-client");
globalThis.fetch = (async (url) =>
  Response.json(
    String(url).endsWith("/auth/me")
      ? { userId: "wipe-user" }
      : {
          records: [deckRecord("in-flight-deck", "Private")],
          cursor: 1,
          head: 1,
          hasMore: false,
        },
  )) as typeof fetch;
const started = deferred(),
  release = deferred();
const originalTable = rawDb.table.bind(rawDb);
rawDb.table = ((name: string) =>
  name === "operations"
    ? rawDb.operations
    : originalTable(name)) as typeof rawDb.table;
const originalAdd = rawDb.operations.bulkPut.bind(rawDb.operations);
rawDb.operations.bulkPut = ((...args: Parameters<typeof originalAdd>) => {
  started.resolve();
  return Dexie.waitFor(release.promise).then(() => originalAdd(...args));
}) as typeof originalAdd;
const pull = SyncEngine.syncFromServer();
await started.promise;
let cleared = false;
const wipe = SyncEngine.wipeDatabase().then(() => {
  cleared = true;
});
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(
  cleared,
  false,
  "wipe must wait for local writes that already started",
);
release.resolve();
await Promise.all([pull, wipe]);
await db.open();
assert.equal(await db.operations.count(), 0);
assert.equal(await db.metadataKv.count(), 0);
console.log("In-flight write checks passed");

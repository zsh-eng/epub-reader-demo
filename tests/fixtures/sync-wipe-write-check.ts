import assert from "node:assert/strict";
import SyncEngine from "@/lib/sync/engine";
import { db } from "@/lib/db/persistence";
import { setClientId } from "@/lib/sync/meta";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
await setClientId("write-client");
globalThis.fetch = (async () =>
  Response.json({
    ops: [
      {
        type: "deck",
        payload: {
          id: "in-flight-deck",
          name: "Private",
          description: "",
          deleted: false,
        },
        timestamp: Date.now(),
        seqNo: 1,
      },
    ],
  })) as typeof fetch;
const started = deferred(),
  release = deferred();
const originalAdd = db.operations.bulkAdd.bind(db.operations);
db.operations.bulkAdd = ((...args: Parameters<typeof originalAdd>) => {
  started.resolve();
  return release.promise.then(() => originalAdd(...args));
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

// Pending operations are persisted to IndexedDB.
// The sync engine is responsible for pushing pending operations to the server
// and for pulling operations from the server.
// It runs in the background and executes periodically.
// For pushing pending operations:
// 1. Executed every X seconds
// 2. Executed when we come online
// 3. Executed when the visibility changes

import { db } from "@/lib/db/persistence";
import { getClientId, getSeqNo } from "@/lib/sync/meta";
import { applyServerOperations } from "@/lib/sync/operation";
import { pullFromServer, pushToServer } from "@/lib/sync/server";

// Note: we don't have to handle race conditions as the operations being sent
// to the server are idempotent.

const MAX_OPERATIONS = 2500;

const SYNC_TO_SERVER_INTERVAL = 10000;
const SYNC_FROM_SERVER_INTERVAL = 30 * 1000 * 5; // Sync from server interval can be long
let started = false;
let stopped = false;
const localWork = new Set<Promise<unknown>>();

// A privacy wipe waits for local writes, but need not wait for a network response.
function trackLocal<T>(work: Promise<T>): Promise<T> {
  localWork.add(work);
  void work.then(
    () => localWork.delete(work),
    () => localWork.delete(work),
  );
  return work;
}

let syncToServerInProgress = false;
async function syncToServer() {
  if (stopped || syncToServerInProgress) {
    return;
  }

  syncToServerInProgress = true;

  try {
    if (!navigator.onLine) {
      return;
    }

    const clientId = await trackLocal(getClientId());
    if (stopped || !clientId) {
      return;
    }

    const pendingOperations = await trackLocal(db.pendingOperations.toArray());
    if (stopped || pendingOperations.length === 0) {
      return;
    }

    // Process operations in chunks
    for (let i = 0; i < pendingOperations.length; i += MAX_OPERATIONS) {
      if (stopped) return;
      const chunk = pendingOperations.slice(i, i + MAX_OPERATIONS);

      console.log("Pushing", chunk.length, "operations");
      const { success } = await pushToServer(clientId, chunk);

      if (stopped) return;
      if (!success) {
        console.error("Failed to push operations to server");
        break;
      }

      // Delete the successfully sent chunk
      await trackLocal(
        db.pendingOperations.bulkDelete(chunk.map((op) => op._id)),
      );
      console.log(
        "Synced",
        Math.min(i + MAX_OPERATIONS, pendingOperations.length),
        "operations",
        "of",
        pendingOperations.length,
      );
    }
  } finally {
    syncToServerInProgress = false;
  }
}

let syncFromServerInProgress = false;
let promise: Promise<void> | null = null;

async function syncFromServer() {
  try {
    const clientId = await trackLocal(getClientId());
    if (stopped || !clientId) {
      return;
    }

    const seqNo = await trackLocal(getSeqNo());
    if (stopped) return;

    const operations = await pullFromServer(clientId, seqNo);
    if (stopped || operations.length === 0) {
      return;
    }

    await trackLocal(applyServerOperations(operations));
  } finally {
    syncFromServerInProgress = false;
  }
}

// We sync from server more infrequently as we don't want to overload the server
function syncFromServerCached(): Promise<void> {
  if (stopped) return Promise.resolve();
  if (syncFromServerInProgress) {
    return promise!;
  }

  syncFromServerInProgress = true;
  promise = syncFromServer();
  return promise;
}

function start() {
  if (started || stopped) {
    return;
  }

  started = true;

  void syncToServer().catch(console.error);
  void syncFromServerCached().catch(console.error);

  // Sync to server
  setInterval(
    () => void syncToServer().catch(console.error),
    SYNC_TO_SERVER_INTERVAL,
  );
  document.addEventListener("visibilitychange", () => {
    // Sync when the user switches away
    if (document.visibilityState === "hidden") {
      void syncToServer().catch(console.error);
    }
  });
  document.addEventListener("online", () => {
    void syncToServer().catch(console.error);
  });

  // Sync from server
  setInterval(
    () => void syncFromServerCached().catch(console.error),
    SYNC_FROM_SERVER_INTERVAL,
  );
  document.addEventListener("online", () => {
    void syncFromServerCached().catch(console.error);
  });
  // Grab from serve whenever the user comes back
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void syncFromServerCached().catch(console.error);
    }
  });
}

async function wipeDatabase() {
  stopped = true;
  await Promise.allSettled([...localWork]);
  await db.delete();
}

const SyncEngine = {
  syncToServer,
  syncFromServer: syncFromServerCached,
  start,
  wipeDatabase,
};

export default SyncEngine;

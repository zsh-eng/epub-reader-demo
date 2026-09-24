import { toStoredOperation } from "@/lib/sync/records";
// Run in a separate process: sign-out deliberately stops sync and image writes until reload.
import assert from "node:assert/strict";
import { act } from "react";
import { render, click } from "../dom";
import { LogoutButton } from "@/components/profile/logout-button";
import {
  logoutAndClearLocalData,
  needsLocalAccountCleanup,
} from "@/lib/auth/privacy";
import SyncEngine from "@/lib/sync/engine";
import { db } from "@/lib/db/persistence";
import {
  imagePersistedDb,
  ImageMemoryDB,
  getCachedImage,
} from "@/lib/images/db";
import { setClientId } from "@/lib/sync/meta";
import MemoryDB from "@/lib/db/memory";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const pull = deferred<Response>(),
  push = deferred<Response>();
const pullStarted = deferred<void>(),
  pushStarted = deferred<void>();
let remoteSuccess = false,
  logoutCalls = 0;
globalThis.fetch = (async (url, options) => {
  if (String(url).includes("/auth/sign-out")) {
    logoutCalls++;
    return new Response(null, { status: remoteSuccess ? 200 : 500 });
  }
  if (String(url).endsWith("/me"))
    return Response.json({ userId: "privacy-user" });
  if (options?.method === "POST") {
    pushStarted.resolve();
    return push.promise;
  }
  pullStarted.resolve();
  return Promise.race([
    pull.promise,
    new Promise<Response>((_, reject) =>
      options?.signal?.addEventListener("abort", () =>
        reject(new Error("Aborted")),
      ),
    ),
  ]);
}) as typeof fetch;
Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
await setClientId("privacy-client");
const operation = {
  type: "deck" as const,
  payload: {
    id: "private-deck",
    name: "Private",
    description: "",
    deleted: false,
  },
  timestamp: Date.now(),
};
await db.operations.add(toStoredOperation(operation));
await imagePersistedDb.images.put({
  url: "https://image/private",
  altText: "Private",
  cachedAt: 1,
  thumbnail: new Blob(["thumbnail"]),
  size: 10,
});
await imagePersistedDb.imageBlobs.put({
  url: "https://image/private",
  content: new Blob(["image"]),
});
await getCachedImage("https://image/private", "Private");
localStorage.setItem("create-flashcard-draft", "private draft");
localStorage.setItem("vite-ui-theme", "dark");

const pulling = SyncEngine.syncFromServer().catch(() => {}),
  pushing = SyncEngine.syncToServer().catch(() => {});
await pullStarted.promise;
await assert.rejects(logoutAndClearLocalData());
assert.equal(await db.operations.count(), 1);
assert.equal(await imagePersistedDb.images.count(), 1);
assert.equal(localStorage.getItem("create-flashcard-draft"), "private draft");

// Fail the local database deletion after successful remote logout.
remoteSuccess = true;
const deleteStarted = deferred<void>(),
  deletion = deferred<void>();
const originalDelete = db.delete.bind(db);
db.delete = async () => {
  deleteStarted.resolve();
  await deletion.promise;
  throw new Error("Storage temporarily unavailable");
};
let reloads = 0;
Object.defineProperty(location, "reload", {
  value: () => {
    reloads++;
  },
  configurable: true,
});
const view = await render(<LogoutButton />);
await click(view.container.querySelector("button")!);
const confirm = [
  ...document.querySelectorAll<HTMLButtonElement>(
    '[role="alertdialog"] button',
  ),
].find((button) => button.textContent === "Sign out")!;
assert.ok(confirm);
await click(confirm);
const signingOut = logoutAndClearLocalData();
assert.equal(
  logoutAndClearLocalData(),
  signingOut,
  "concurrent sign-out must share the active promise",
);
const failedCleanup = signingOut.catch((error: unknown) => error);
await deleteStarted.promise;
await act(async () => {
  deletion.resolve();
  await failedCleanup;
});
assert.equal(reloads, 0);
assert.equal(needsLocalAccountCleanup(), true);
assert.equal(logoutCalls, 2);
assert.match(view.container.textContent ?? "", /Retry local cleanup/);

// Retry is local and must work without another network request.
db.delete = originalDelete;
Object.defineProperty(navigator, "onLine", {
  value: false,
  configurable: true,
});
await act(async () => {
  window.dispatchEvent(new Event("offline"));
});
const retry = view.container.querySelector("button")!;
assert.equal(retry.disabled, false);
await click(retry);
const confirmRetry = [
  ...document.querySelectorAll<HTMLButtonElement>(
    '[role="alertdialog"] button',
  ),
].find((button) => button.textContent === "Retry cleanup")!;
assert.ok(confirmRetry);
await click(confirmRetry);
await act(async () => {
  await logoutAndClearLocalData();
});
assert.equal(logoutCalls, 2);
assert.equal(reloads, 1);
assert.equal(needsLocalAccountCleanup(), false);
assert.equal(localStorage.getItem("create-flashcard-draft"), null);
assert.equal(localStorage.getItem("vite-ui-theme"), "dark");
assert.equal(ImageMemoryDB.size, 0);

// Late network completions must not restore private data after cleanup.
pull.resolve(
  Response.json({
    ops: [
      {
        ...operation,
        payload: { ...operation.payload, id: "late-private-deck" },
        seqNo: 1,
      },
    ],
  }),
);
push.resolve(Response.json({ success: true }));
await Promise.all([pulling, pushing]);
await db.open();
await imagePersistedDb.open();
assert.equal(await db.operations.count(), 0);
assert.equal(await db._sync_outbox.count(), 0);
assert.equal(await db.metadataKv.count(), 0);
assert.equal(await imagePersistedDb.images.count(), 0);
assert.equal(await imagePersistedDb.imageBlobs.count(), 0);
assert.equal(MemoryDB.getDeckById("late-private-deck"), undefined);
await assert.rejects(getCachedImage("https://image/future", "Future"));
await view.unmount();
console.log("Privacy checks passed");

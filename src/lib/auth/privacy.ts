import { logout } from "@/lib/auth";
import { clearImageCache } from "@/lib/images/db";
import SyncEngine from "@/lib/sync/engine";

let remoteLogoutComplete = false;
let localCleanupComplete = false;
let pending: Promise<void> | undefined;

/** Clear sensitive local data only after the server confirms sign-out. */
export function logoutAndClearLocalData(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    if (!remoteLogoutComplete) {
      const response = await logout();
      if (!response.success)
        throw new Error(response.message ?? "Failed to sign out");
      remoteLogoutComplete = true;
    }
    const results = await Promise.allSettled([
      SyncEngine.wipeDatabase(),
      clearImageCache(),
      Promise.resolve().then(() =>
        localStorage.removeItem("create-flashcard-draft"),
      ),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    localCleanupComplete = true;
  })();
  const reset = () => {
    pending = undefined;
  };
  void pending.then(reset, reset);
  return pending;
}

/** A confirmed server sign-out can retry local cleanup without a connection. */
export function needsLocalAccountCleanup() {
  return remoteLogoutComplete && !localCleanupComplete;
}

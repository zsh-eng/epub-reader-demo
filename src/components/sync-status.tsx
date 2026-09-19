import { useLocation } from "react-router";
import { useSyncExternalStore, type ReactNode } from "react";
import SyncEngine from "@/lib/sync/engine";
export function SyncStatus() {
  const status = useSyncExternalStore(
    SyncEngine.subscribe,
    SyncEngine.getSnapshot,
  );
  if (!status.error) return null;
  return (
    <div role="alert" className="col-span-full rounded border p-3">
      <p>{status.error}</p>
      <button onClick={() => void SyncEngine.syncFromServer().catch(() => {})}>
        Retry sync
      </button>
    </div>
  );
}

export function SyncBoundary({ children }: { children: ReactNode }) {
  const status = useSyncExternalStore(
    SyncEngine.subscribe,
    SyncEngine.getSnapshot,
  );
  const { pathname } = useLocation();
  if (status.restoring && !["/profile", "/login-success"].includes(pathname))
    return (
      <p role="status" className="col-span-full p-4">
        {status.error
          ? "Restore is incomplete. Retry sync to continue."
          : "Restoring your cards and review history…"}
      </p>
    );
  return children;
}

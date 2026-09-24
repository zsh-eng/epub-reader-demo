import { useSyncExternalStore } from "react";
import SyncEngine from "@/lib/sync/engine";
export default function SyncRoute() {
  const status = useSyncExternalStore(
    SyncEngine.subscribe,
    SyncEngine.getSnapshot,
  );
  return (
    <div>
      <button
        disabled={status.syncing}
        onClick={() => void SyncEngine.syncFromServer().catch(() => {})}
      >
        Sync now
      </button>
      {status.error && <p role="alert">{status.error}</p>}
    </div>
  );
}

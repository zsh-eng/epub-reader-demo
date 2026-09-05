/** Application lifecycle wrapper around the small sync v2 client. */

import { getOrCreateDeviceId } from "@/lib/device";
import { getOrCreateSyncClientState } from "@/lib/sync-v2/client-state";
import { syncV2SyncDb } from "@/lib/sync-v2/db";
import { SyncV2Client, type SyncV2RunResult } from "@/lib/sync-v2/sync";

const SYNC_INTERVAL_MS = 30_000;
const EMPTY_SYNC_RESULT: SyncV2RunResult = {
  pulled: 0,
  skipped: 0,
  pushed: 0,
};

/**
 * Owns browser lifecycle concerns only. Protocol and persistence logic remain
 * in SyncV2Client.
 */
class SyncService {
  private readonly client: SyncV2Client;
  private syncInterval: number | null = null;
  private isOnline = typeof navigator === "undefined" || navigator.onLine;

  constructor() {
    getOrCreateSyncClientState(getOrCreateDeviceId());
    this.client = new SyncV2Client({ syncDb: syncV2SyncDb });

    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  startPeriodicSync(intervalMs = SYNC_INTERVAL_MS): void {
    if (this.syncInterval !== null || typeof window === "undefined") return;

    this.syncInterval = window.setInterval(() => {
      void this.syncAll().catch((error) => {
        console.error("Periodic sync failed:", error);
      });
    }, intervalMs);

    void this.syncAll().catch((error) => {
      console.error("Initial sync failed:", error);
    });
  }

  stopPeriodicSync(): void {
    if (this.syncInterval === null) return;

    window.clearInterval(this.syncInterval);
    this.syncInterval = null;
  }

  async syncAll(): Promise<SyncV2RunResult> {
    if (!this.isOnline) return EMPTY_SYNC_RESULT;

    return this.client.sync();
  }

  private handleOnline = (): void => {
    this.isOnline = true;
    void this.syncAll().catch((error) => {
      console.error("Online sync failed:", error);
    });
  };

  private handleOffline = (): void => {
    this.isOnline = false;
  };
}

export const syncService = new SyncService();
export { SyncService };

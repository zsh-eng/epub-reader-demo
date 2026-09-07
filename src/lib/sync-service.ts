/** Application lifecycle wrapper around the small sync v2 client. */

import {
  getLabRuntime,
  getRuntimeOnline,
  subscribeRuntimeOnline,
} from "@/features/sync-lab/runtime";
import { getOrCreateDeviceId } from "@/lib/device";
import { getOrCreateSyncClientState } from "@/lib/sync-v2/client-state";
import { syncV2SyncDb } from "@/lib/sync-v2/db";
import { SyncV2Client, type SyncV2RunResult } from "@/lib/sync-v2/sync";

const SYNC_INTERVAL_MS = 30_000;
export type SyncServiceResult =
  | { status: "offline" }
  | ({ status: "completed" } & SyncV2RunResult);

/** Owns automatic sync and its subscriptions for one application lifetime. */
class SyncService {
  private readonly client: SyncV2Client;
  private readonly pendingRuns = new Set<Promise<SyncServiceResult>>();
  private isOnline = getRuntimeOnline();
  private syncInterval: number | null = null;
  private requestedInterval: number | null = null;
  private readonly unsubscribers: Array<() => void> = [];

  constructor() {
    getOrCreateSyncClientState(getOrCreateDeviceId());
    this.client = new SyncV2Client({
      syncDb: syncV2SyncDb,
      onEvent: getLabRuntime()?.onSyncEvent,
    });
    if (typeof window === "undefined") return;
    this.unsubscribers.push(subscribeRuntimeOnline(this.handleOnline));
    const lab = getLabRuntime();
    if (lab)
      this.unsubscribers.push(lab.subscribeAutoSync(this.updatePeriodicSync));
  }

  startPeriodicSync(intervalMs = SYNC_INTERVAL_MS): void {
    this.requestedInterval = intervalMs;
    this.updatePeriodicSync();
  }

  stopPeriodicSync(): void {
    this.requestedInterval = null;
    this.clearInterval();
  }

  dispose(): void {
    this.stopPeriodicSync();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }

  syncAll(): Promise<SyncServiceResult> {
    if (!this.isOnline) return Promise.resolve({ status: "offline" });
    const run: Promise<SyncServiceResult> = this.client
      .sync()
      .then((result) => ({ status: "completed" as const, ...result }))
      .finally(() => this.pendingRuns.delete(run));
    this.pendingRuns.add(run);
    return run;
  }

  /** Call after stopping the scheduler to wait for issued sync exchanges. */
  async drain(): Promise<void> {
    await Promise.allSettled(this.pendingRuns);
  }

  private clearInterval(): void {
    if (this.syncInterval === null) return;
    window.clearInterval(this.syncInterval);
    this.syncInterval = null;
  }

  private updatePeriodicSync = (): void => {
    const enabled = getLabRuntime()?.autoSync() ?? true;
    if (!enabled || this.requestedInterval === null) {
      this.clearInterval();
      return;
    }
    if (this.syncInterval !== null || typeof window === "undefined") return;
    this.syncInterval = window.setInterval(
      this.runAutomaticSync,
      this.requestedInterval,
    );
    this.runAutomaticSync();
  };

  private runAutomaticSync = (): void => {
    void this.syncAll().catch((error) =>
      console.error("Automatic sync failed:", error),
    );
  };

  private handleOnline = (online: boolean): void => {
    this.isOnline = online;
    if (!online || this.syncInterval === null) return;
    this.runAutomaticSync();
  };
}

export const syncService = new SyncService();
export { SyncService };

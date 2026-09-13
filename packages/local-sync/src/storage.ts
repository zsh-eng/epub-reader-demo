import type {
  SyncPushChange,
  SyncPullBody,
  SyncPullResponse,
  SyncPushResponse,
  SyncRecord,
} from "./protocol.js";

export interface SyncRemote {
  pull(deviceId: string, request: SyncPullBody): Promise<SyncPullResponse>;
  push(
    deviceId: string,
    changes: readonly SyncPushChange[],
  ): Promise<SyncPushResponse>;
}

export interface SyncRunResult {
  pulled: number;
  skipped: number;
  pushed: number;
}

/** Optional diagnostic events, emitted after storage changes commit. */
export interface SyncEvent {
  phase: "pull" | "push";
  outcome:
    | "applied"
    | "kept-local"
    | "acknowledged"
    | "replaced"
    | "edited-in-flight";
  key: string;
}

/** Storage adapters validate a complete response before committing any rows.
 * Apply and reconcile must commit domain rows and pending changes atomically.
 * Reconciliation must preserve edits made while the request was in flight.
 */
export interface SyncStorage<Prepared> {
  getPendingChanges(): Promise<SyncPushChange[]>;
  prepareRemoteRecords(records: readonly SyncRecord[]): Prepared;
  applyRemoteRecords(
    prepared: Prepared,
    localDeviceId: string,
  ): Promise<{ applied: number; skipped: number }>;
  reconcilePushResults(
    sent: readonly SyncPushChange[],
    prepared: Prepared,
  ): Promise<number>;
}

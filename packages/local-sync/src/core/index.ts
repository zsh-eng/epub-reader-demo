export type JsonPrimitive = boolean | null | number | string;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** The default canonical payload shape exchanged by sync adapters. */
export type SyncPayload = Readonly<Record<string, JsonValue>>;

/** Client-generated HLC components used before the device-ID tie-breaker. */
export interface HybridLogicalTimestamp {
  readonly wallTimeMs: number;
  readonly counter: number;
}

const SYNC_DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Device IDs participate in deterministic LWW ordering across all adapters. */
export function isValidSyncDeviceId(deviceId: string): boolean {
  return deviceId.length > 0 && SYNC_DEVICE_ID_PATTERN.test(deviceId);
}

/**
 * A server-assigned position in the app's ordered change stream.
 *
 * Cursor zero means that no server records have been observed yet.
 */
export type SyncCursor = number;

export const INITIAL_SYNC_CURSOR: SyncCursor = 0;

export interface SyncRecordBase {
  readonly tableName: string;
  readonly recordId: string;
  readonly scopeId?: string;
  readonly hlc: HybridLogicalTimestamp;
  readonly deviceId: string;
  readonly schemaVersion: number;
}

export type SyncVersion = Pick<SyncRecordBase, "hlc" | "deviceId">;

/**
 * Reference/client LWW comparison. Production SQL adapters must encode this
 * ordering atomically in their `ON CONFLICT` condition.
 */
export function compareSyncVersions(
  left: SyncVersion,
  right: SyncVersion,
): -1 | 0 | 1 {
  if (left.hlc.wallTimeMs !== right.hlc.wallTimeMs) {
    return left.hlc.wallTimeMs < right.hlc.wallTimeMs ? -1 : 1;
  }

  if (left.hlc.counter !== right.hlc.counter) {
    return left.hlc.counter < right.hlc.counter ? -1 : 1;
  }

  if (left.deviceId === right.deviceId) {
    return 0;
  }

  return left.deviceId < right.deviceId ? -1 : 1;
}

export interface SyncPutRecord<TPayload = SyncPayload> extends SyncRecordBase {
  readonly operation: "put";
  readonly payload: TPayload;
}

/** A retained deletion marker whose domain data remains available to restore. */
export interface SyncDeleteRecord<
  TPayload = SyncPayload,
> extends SyncRecordBase {
  readonly operation: "delete";
  readonly payload: TPayload;
}

export type SyncRecord<TPayload = SyncPayload> =
  | SyncPutRecord<TPayload>
  | SyncDeleteRecord<TPayload>;

/** A record after the server has placed it in the ordered change stream. */
export type SequencedSyncRecord<TPayload = SyncPayload> =
  SyncRecord<TPayload> & {
    readonly serverSeq: SyncCursor;
  };

/** A page returned during bootstrap or incremental catch-up. */
export interface SyncBatch<TPayload = SyncPayload> {
  readonly records: readonly SequencedSyncRecord<TPayload>[];
  readonly cursor: SyncCursor;
  readonly hasMore: boolean;
}

export type SyncConflictPolicy = "lww";

/** Declarative sync behavior that will eventually attach to a schema table. */
export interface SyncTablePolicy<
  RecordIdField extends string = string,
  ScopeIdField extends string = string,
> {
  readonly recordId: RecordIdField;
  readonly scopeId?: ScopeIdField;
  readonly conflict: SyncConflictPolicy;
  readonly schemaVersion: number;
}

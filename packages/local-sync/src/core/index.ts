export type JsonPrimitive = boolean | null | number | string;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** The default canonical payload shape exchanged by sync adapters. */
export type SyncPayload = Readonly<Record<string, JsonValue>>;

/**
 * An encoded `<wallTimeMs>:<logicalCounter>` HLC value.
 *
 * Conflict resolution compares both numeric components, then uses the record's
 * separate device ID as the deterministic final tie-breaker.
 */
export type HybridLogicalTimestamp = string;

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

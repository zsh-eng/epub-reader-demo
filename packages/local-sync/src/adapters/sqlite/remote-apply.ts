import type { HybridLogicalClock } from "../../client/index.js";
import {
  type HybridLogicalTimestamp,
  type SequencedSyncRecord,
  type SyncCursor,
  type SyncPayload,
  isValidSyncDeviceId,
} from "../../core/index.js";
import type { SyncSchemaMetadata, TableMetadata } from "../../schema/index.js";
import { DEFAULT_SYNC_CURSOR_KEY, writeSyncCursor } from "./cursors.js";
import { readDomainRow, upsertDomainRow } from "./domain-rows.js";
import type { SqlDriver, SqlExecutor } from "./index.js";
import {
  assertNonEmpty,
  assertNonNegativeSafeInteger,
  getRecordId,
  getScopeId,
  getSyncedTable,
  getSyncPolicy,
  normalizeSyncPayload,
  recordKey,
} from "./sync-record.js";

export interface RemoteApplyOptions {
  /** The pull-page cursor to commit atomically with the materialized rows. */
  readonly cursor?: SyncCursor;
  readonly cursorKey?: string;
}

/** Structural subset accepted directly from `SyncServer.push()` outcomes. */
export interface PushOutcomeLike {
  /** Included for wire compatibility; reconciliation is driven by `record`. */
  readonly accepted: boolean;
  readonly record: SequencedSyncRecord<unknown>;
}

export interface AffectedSyncTarget {
  readonly tableName: string;
  readonly scopeId?: string;
}

export interface ServerRecordApplyResult {
  readonly processedRecordCount: number;
  /** Records whose newer versions changed materialized domain state. */
  readonly appliedRecordCount: number;
  readonly affected: readonly AffectedSyncTarget[];
}

interface NormalizedServerRecord {
  readonly table: TableMetadata;
  readonly record: SequencedSyncRecord<SyncPayload>;
}

interface SyncMetaWinnerRow {
  readonly record_id: string;
}

export async function applyRemoteRecords(
  driver: SqlDriver,
  clock: HybridLogicalClock,
  schema: SyncSchemaMetadata,
  records: readonly SequencedSyncRecord<unknown>[],
  options: RemoteApplyOptions = {},
): Promise<ServerRecordApplyResult> {
  const normalized = normalizeServerRecords(schema, records);
  validateCursorOptions(normalized, options);

  const latestHlc = findLatestHlc(normalized);
  if (latestHlc !== undefined) {
    await clock.observe(latestHlc);
  }

  return driver.transaction(async (transaction) => {
    const affected = new Map<string, AffectedSyncTarget>();
    let appliedRecordCount = 0;

    for (const { table, record } of normalized) {
      const applied = await writeRemoteMetadata(transaction, record);
      if (!applied) {
        await acknowledgeStoredVersion(transaction, record);
        continue;
      }

      const previous =
        table.sync?.scopeId === undefined
          ? undefined
          : await readDomainRow(
              transaction,
              record.tableName,
              table,
              record.recordId,
            );
      await upsertDomainRow(
        transaction,
        record.tableName,
        table,
        record.payload,
      );
      appliedRecordCount += 1;

      if (previous !== undefined) {
        addAffectedTarget(
          affected,
          record.tableName,
          getScopeId(table, previous),
        );
      }
      addAffectedTarget(affected, record.tableName, record.scopeId);
    }

    if (options.cursor !== undefined) {
      await writeSyncCursor(
        transaction,
        options.cursorKey ?? DEFAULT_SYNC_CURSOR_KEY,
        options.cursor,
      );
    }

    return Object.freeze({
      processedRecordCount: normalized.length,
      appliedRecordCount,
      affected: Object.freeze([...affected.values()]),
    });
  });
}

export function reconcilePushOutcomeRecords(
  driver: SqlDriver,
  clock: HybridLogicalClock,
  schema: SyncSchemaMetadata,
  outcomes: readonly PushOutcomeLike[],
): Promise<ServerRecordApplyResult> {
  return applyRemoteRecords(
    driver,
    clock,
    schema,
    outcomes.map(({ record }) => record),
  );
}

function normalizeServerRecords(
  schema: SyncSchemaMetadata,
  records: readonly SequencedSyncRecord<unknown>[],
): readonly NormalizedServerRecord[] {
  const keys = new Set<string>();

  return records.map((candidate) => {
    const tableName = candidate.tableName;
    const recordId = candidate.recordId;
    assertNonEmpty(tableName, "record.tableName");
    assertNonEmpty(recordId, "record.recordId");
    const key = recordKey(tableName, recordId);
    if (keys.has(key)) {
      throw new Error(
        `Remote batch contains duplicate record: ${tableName}/${recordId}`,
      );
    }
    keys.add(key);

    const table = getSyncedTable(schema, tableName);
    const payload = normalizeSyncPayload(tableName, table, candidate.payload);
    if (getRecordId(table, payload) !== recordId) {
      throw new Error(
        `Remote payload record ID does not match: ${tableName}/${recordId}`,
      );
    }

    const scopeId = getScopeId(table, payload);
    if (scopeId !== candidate.scopeId) {
      throw new Error(
        `Remote payload scope ID does not match: ${tableName}/${recordId}`,
      );
    }
    const operation: unknown = candidate.operation;
    if (operation !== "put" && operation !== "delete") {
      throw new Error(
        `Remote record has an invalid operation: ${tableName}/${recordId}`,
      );
    }
    if (!isValidSyncDeviceId(candidate.deviceId)) {
      throw new Error(
        `Remote record has an invalid device ID: ${tableName}/${recordId}`,
      );
    }
    assertNonNegativeSafeInteger(
      candidate.hlc.wallTimeMs,
      "remote HLC wallTimeMs",
    );
    assertNonNegativeSafeInteger(candidate.hlc.counter, "remote HLC counter");
    if (
      !Number.isSafeInteger(candidate.serverSeq) ||
      candidate.serverSeq <= 0
    ) {
      throw new Error("remote serverSeq must be a positive safe integer");
    }

    const schemaVersion = getSyncPolicy(table).schemaVersion;
    if (candidate.schemaVersion !== schemaVersion) {
      throw new Error(
        `Remote schema version mismatch for ${tableName}: expected ${schemaVersion}, received ${candidate.schemaVersion}`,
      );
    }

    const base = {
      tableName,
      recordId,
      ...(scopeId === undefined ? {} : { scopeId }),
      hlc: Object.freeze({ ...candidate.hlc }),
      deviceId: candidate.deviceId,
      schemaVersion,
      serverSeq: candidate.serverSeq,
      payload,
    };
    const record: SequencedSyncRecord<SyncPayload> =
      operation === "delete"
        ? { ...base, operation: "delete" }
        : { ...base, operation: "put" };

    return Object.freeze({ table, record });
  });
}

function validateCursorOptions(
  records: readonly NormalizedServerRecord[],
  options: RemoteApplyOptions,
): void {
  if (options.cursorKey !== undefined) {
    assertNonEmpty(options.cursorKey, "cursorKey");
    if (options.cursor === undefined) {
      throw new Error("cursorKey requires a cursor");
    }
  }
  if (options.cursor === undefined) {
    return;
  }

  assertNonNegativeSafeInteger(options.cursor, "sync cursor");
  for (const { record } of records) {
    if (record.serverSeq > options.cursor) {
      throw new Error(
        `Sync cursor ${options.cursor} precedes record serverSeq ${record.serverSeq}`,
      );
    }
  }
}

async function writeRemoteMetadata(
  transaction: SqlExecutor,
  record: SequencedSyncRecord<SyncPayload>,
): Promise<boolean> {
  const winners = await transaction.all<SyncMetaWinnerRow>(
    `insert into sync_meta (
       table_name,
       record_id,
       hlc_wall_time,
       hlc_counter,
       device_id,
       last_server_seq,
       dirty,
       is_deleted
     ) values (?, ?, ?, ?, ?, ?, 0, ?)
     on conflict (table_name, record_id) do update set
       hlc_wall_time = excluded.hlc_wall_time,
       hlc_counter = excluded.hlc_counter,
       device_id = excluded.device_id,
       last_server_seq = max(sync_meta.last_server_seq, excluded.last_server_seq),
       dirty = 0,
       is_deleted = excluded.is_deleted
     where excluded.hlc_wall_time > sync_meta.hlc_wall_time
       or (
         excluded.hlc_wall_time = sync_meta.hlc_wall_time
         and excluded.hlc_counter > sync_meta.hlc_counter
       )
       or (
         excluded.hlc_wall_time = sync_meta.hlc_wall_time
         and excluded.hlc_counter = sync_meta.hlc_counter
         and excluded.device_id > sync_meta.device_id
       )
     returning record_id`,
    [
      record.tableName,
      record.recordId,
      record.hlc.wallTimeMs,
      record.hlc.counter,
      record.deviceId,
      record.serverSeq,
      record.operation === "delete" ? 1 : 0,
    ],
  );

  return winners.length === 1 && winners[0]?.record_id === record.recordId;
}

async function acknowledgeStoredVersion(
  transaction: SqlExecutor,
  record: SequencedSyncRecord<SyncPayload>,
): Promise<void> {
  await transaction.run(
    `update sync_meta
     set
       last_server_seq = max(last_server_seq, ?),
       dirty = case
         when hlc_wall_time = ?
          and hlc_counter = ?
          and device_id = ?
         then 0
         else dirty
       end
     where table_name = ? and record_id = ?`,
    [
      record.serverSeq,
      record.hlc.wallTimeMs,
      record.hlc.counter,
      record.deviceId,
      record.tableName,
      record.recordId,
    ],
  );
}

function findLatestHlc(
  records: readonly NormalizedServerRecord[],
): HybridLogicalTimestamp | undefined {
  let latest: HybridLogicalTimestamp | undefined;
  for (const { record } of records) {
    if (
      latest === undefined ||
      record.hlc.wallTimeMs > latest.wallTimeMs ||
      (record.hlc.wallTimeMs === latest.wallTimeMs &&
        record.hlc.counter > latest.counter)
    ) {
      latest = record.hlc;
    }
  }
  return latest;
}

function addAffectedTarget(
  affected: Map<string, AffectedSyncTarget>,
  tableName: string,
  scopeId: string | undefined,
): void {
  const target = Object.freeze({
    tableName,
    ...(scopeId === undefined ? {} : { scopeId }),
  });
  affected.set(recordKey(tableName, scopeId ?? ""), target);
}

import type { HybridLogicalClock } from "../../client/index.js";
import type { SyncPayload, SyncRecord } from "../../core/index.js";
import type { TableMetadata } from "../../schema/index.js";
import { readDomainRow, upsertDomainRow } from "./domain-rows.js";
import type { SqlDriver, SqlExecutor } from "./index.js";
import {
  assertNonEmpty,
  assertUniqueRecordIds,
  assertUniqueStrings,
  createLocalSyncRecord,
  normalizeSyncPayload,
} from "./sync-record.js";

interface SyncMetaWinnerRow {
  readonly record_id: string;
}

export async function putLocalRows(
  driver: SqlDriver,
  clock: HybridLogicalClock,
  tableName: string,
  table: TableMetadata,
  rows: readonly unknown[],
): Promise<readonly SyncRecord<SyncPayload>[]> {
  const payloads = rows.map((row) =>
    normalizeSyncPayload(tableName, table, row),
  );
  assertUniqueRecordIds(tableName, table, payloads);

  if (payloads.length === 0) {
    return Object.freeze([]);
  }

  const timestamps = await clock.tickMany(payloads.length);
  const records = await driver.transaction(async (transaction) => {
    const written: SyncRecord<SyncPayload>[] = [];

    for (const [index, payload] of payloads.entries()) {
      const timestamp = timestamps[index];
      if (timestamp === undefined) {
        throw new Error("HLC batch returned too few timestamps");
      }

      const record = createLocalSyncRecord(
        tableName,
        table,
        payload,
        timestamp,
        clock.deviceId,
        "put",
      );
      await writeSyncMetadata(transaction, record);
      await upsertDomainRow(transaction, tableName, table, payload);
      written.push(record);
    }

    return written;
  });

  return Object.freeze(records);
}

export async function deleteLocalRows(
  driver: SqlDriver,
  clock: HybridLogicalClock,
  tableName: string,
  table: TableMetadata,
  recordIds: readonly string[],
): Promise<readonly SyncRecord<SyncPayload>[]> {
  for (const recordId of recordIds) {
    assertNonEmpty(recordId, "recordId");
  }
  assertUniqueStrings(recordIds, `delete batch for ${tableName}`);

  if (recordIds.length === 0) {
    return Object.freeze([]);
  }

  const timestamps = await clock.tickMany(recordIds.length);
  const records = await driver.transaction(async (transaction) => {
    const deleted: SyncRecord<SyncPayload>[] = [];

    for (const [index, recordId] of recordIds.entries()) {
      const timestamp = timestamps[index];
      if (timestamp === undefined) {
        throw new Error("HLC batch returned too few timestamps");
      }

      const payload = await readDomainRow(
        transaction,
        tableName,
        table,
        recordId,
      );
      if (payload === undefined) {
        throw new Error(`Cannot delete missing row: ${tableName}/${recordId}`);
      }

      const record = createLocalSyncRecord(
        tableName,
        table,
        payload,
        timestamp,
        clock.deviceId,
        "delete",
      );
      await writeSyncMetadata(transaction, record);
      deleted.push(record);
    }

    return deleted;
  });

  return Object.freeze(records);
}

async function writeSyncMetadata(
  transaction: SqlExecutor,
  record: SyncRecord,
): Promise<void> {
  const winners = await transaction.all<SyncMetaWinnerRow>(
    `insert into sync_meta (
       table_name,
       record_id,
       hlc_wall_time,
       hlc_counter,
       device_id,
       dirty,
       is_deleted
     ) values (?, ?, ?, ?, ?, 1, ?)
     on conflict (table_name, record_id) do update set
       hlc_wall_time = excluded.hlc_wall_time,
       hlc_counter = excluded.hlc_counter,
       device_id = excluded.device_id,
       dirty = 1,
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
      record.operation === "delete" ? 1 : 0,
    ],
  );

  if (winners.length !== 1 || winners[0]?.record_id !== record.recordId) {
    throw new Error(
      `Local write was superseded before commit: ${record.tableName}/${record.recordId}`,
    );
  }
}

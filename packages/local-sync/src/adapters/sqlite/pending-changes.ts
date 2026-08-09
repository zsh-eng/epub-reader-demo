import {
  type SyncPayload,
  type SyncRecord,
  isValidSyncDeviceId,
} from "../../core/index.js";
import type { SyncSchemaMetadata } from "../../schema/index.js";
import type { SqlDriver, SqlExecutor, SqlRow } from "./index.js";
import {
  assertNonNegativeSafeInteger,
  columnList,
  createLocalSyncRecord,
  getSyncedTable,
  normalizeSyncPayload,
  quoteIdentifier,
  recordKey,
} from "./sync-record.js";

export const DEFAULT_PENDING_CHANGES_LIMIT = 500;
export const MAX_PENDING_CHANGES_LIMIT = 500;

export interface PendingChangesOptions {
  readonly limit?: number;
}

interface PendingSyncMetaRow {
  readonly table_name: string;
  readonly record_id: string;
  readonly hlc_wall_time: number;
  readonly hlc_counter: number;
  readonly device_id: string;
  readonly is_deleted: number;
}

export async function readPendingChanges(
  driver: SqlDriver,
  schema: SyncSchemaMetadata,
  options: PendingChangesOptions,
): Promise<readonly SyncRecord<SyncPayload>[]> {
  const limit = options.limit ?? DEFAULT_PENDING_CHANGES_LIMIT;
  assertNonNegativeSafeInteger(limit, "pending changes limit");
  if (limit > MAX_PENDING_CHANGES_LIMIT) {
    throw new Error(
      `pending changes limit must not exceed ${MAX_PENDING_CHANGES_LIMIT}`,
    );
  }
  if (limit === 0) {
    return Object.freeze([]);
  }

  const records = await driver.transaction(async (transaction) => {
    const metadata = await transaction.all<PendingSyncMetaRow>(
      `select
         table_name,
         record_id,
         hlc_wall_time,
         hlc_counter,
         device_id,
         is_deleted
       from sync_meta
       where dirty = 1
       order by table_name, record_id
       limit ?`,
      [limit],
    );
    const payloads = await readPendingPayloads(transaction, schema, metadata);

    return metadata.map((row) => {
      const table = getSyncedTable(schema, row.table_name);
      const payload = payloads.get(recordKey(row.table_name, row.record_id));
      if (payload === undefined) {
        throw new Error(
          `Pending metadata has no domain row: ${row.table_name}/${row.record_id}`,
        );
      }
      if (!isValidSyncDeviceId(row.device_id)) {
        throw new Error(
          `Pending metadata has an invalid device ID: ${row.table_name}/${row.record_id}`,
        );
      }
      assertNonNegativeSafeInteger(row.hlc_wall_time, "pending HLC wallTimeMs");
      assertNonNegativeSafeInteger(row.hlc_counter, "pending HLC counter");
      if (row.is_deleted !== 0 && row.is_deleted !== 1) {
        throw new Error(
          `Pending metadata has invalid tombstone state: ${row.table_name}/${row.record_id}`,
        );
      }

      return createLocalSyncRecord(
        row.table_name,
        table,
        payload,
        {
          wallTimeMs: row.hlc_wall_time,
          counter: row.hlc_counter,
        },
        row.device_id,
        row.is_deleted === 1 ? "delete" : "put",
      );
    });
  });

  return Object.freeze(records);
}

async function readPendingPayloads(
  transaction: SqlExecutor,
  schema: SyncSchemaMetadata,
  metadata: readonly PendingSyncMetaRow[],
): Promise<ReadonlyMap<string, SyncPayload>> {
  const rowsByTable = new Map<string, PendingSyncMetaRow[]>();
  for (const row of metadata) {
    getSyncedTable(schema, row.table_name);
    const rows = rowsByTable.get(row.table_name) ?? [];
    rows.push(row);
    rowsByTable.set(row.table_name, rows);
  }

  const payloads = new Map<string, SyncPayload>();
  for (const [tableName, tableRows] of rowsByTable) {
    const table = getSyncedTable(schema, tableName);
    const primaryKey = quoteIdentifier(table.primaryKey);
    const placeholders = tableRows.map(() => "?").join(", ");
    const rows = await transaction.all<SqlRow>(
      `select ${columnList(table)}
       from ${quoteIdentifier(tableName)}
       where ${primaryKey} in (${placeholders})`,
      tableRows.map(({ record_id }) => record_id),
    );

    for (const row of rows) {
      const payload = normalizeSyncPayload(tableName, table, row);
      const recordId = payload[table.primaryKey];
      if (typeof recordId !== "string") {
        throw new Error(`Synced record ID must be text: ${tableName}`);
      }
      payloads.set(recordKey(tableName, recordId), payload);
    }
  }

  return payloads;
}

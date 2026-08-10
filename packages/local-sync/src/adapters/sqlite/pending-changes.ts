import type { SyncPayload, SyncRecord } from "../../core/index.js";
import type { SyncSchemaMetadata } from "../../schema/index.js";
import type { SqlDriver, SqlExecutor, SqlRow } from "./index.js";
import {
  columnList,
  createLocalSyncRecord,
  getSyncedTable,
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
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    limit > MAX_PENDING_CHANGES_LIMIT
  ) {
    throw new Error(
      `pending changes limit must be between 0 and ${MAX_PENDING_CHANGES_LIMIT}`,
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
      const recordId = row[table.primaryKey] as string;
      payloads.set(recordKey(tableName, recordId), row);
    }
  }

  return payloads;
}

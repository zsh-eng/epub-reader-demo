import type { SyncPayload } from "../../core/index.js";
import type { TableMetadata } from "../../schema/index.js";
import type { SqlExecutor, SqlRow, SqlValue } from "./index.js";
import { columnList, quoteIdentifier } from "./sync-record.js";

export async function upsertDomainRow(
  transaction: SqlExecutor,
  tableName: string,
  table: TableMetadata,
  payload: SyncPayload,
): Promise<void> {
  const columnNames = Object.keys(table.columns);
  const updateColumns = columnNames.filter(
    (columnName) => columnName !== table.primaryKey,
  );
  const conflictAction =
    updateColumns.length === 0
      ? "do nothing"
      : `do update set ${updateColumns
          .map(
            (columnName) =>
              `${quoteIdentifier(columnName)} = excluded.${quoteIdentifier(columnName)}`,
          )
          .join(", ")}`;

  await transaction.run(
    `insert into ${quoteIdentifier(tableName)} (
       ${columnNames.map(quoteIdentifier).join(", ")}
     ) values (${columnNames.map(() => "?").join(", ")})
     on conflict (${quoteIdentifier(table.primaryKey)}) ${conflictAction}`,
    columnNames.map((columnName) => payload[columnName] as SqlValue),
  );
}

export async function readDomainRow(
  transaction: SqlExecutor,
  tableName: string,
  table: TableMetadata,
  recordId: string,
): Promise<SyncPayload | undefined> {
  const rows = await transaction.all<SqlRow>(
    `select ${columnList(table)}
     from ${quoteIdentifier(tableName)}
     where ${quoteIdentifier(table.primaryKey)} = ?`,
    [recordId],
  );
  const row = rows[0];
  return row;
}

import type { SyncSchemaMetadata, TableMetadata } from "../../schema/index.js";
import type { SqlDriver } from "./index.js";

export interface SqliteSchemaSource {
  readonly meta: SyncSchemaMetadata;
}

const RESERVED_TABLE_NAMES = new Set(["sync_meta", "sync_cursors"]);

/**
 * Generates idempotent SQLite initialization statements for application tables
 * and the local sync sidecars. Existing tables are not altered or migrated.
 */
export function generateSqliteSchema(
  schema: SqliteSchemaSource,
): readonly string[] {
  const statements: string[] = [];

  for (const [tableName, table] of Object.entries(schema.meta.tables)) {
    assertAvailableTableName(tableName);
    statements.push(generateTableStatement(tableName, table));

    const uniqueIndexes = new Set(table.uniqueIndexes);
    for (const columnName of table.indexes) {
      statements.push(
        generateIndexStatement(
          tableName,
          columnName,
          uniqueIndexes.has(columnName),
        ),
      );
    }
  }

  statements.push(...SYNC_SIDECAR_STATEMENTS);
  return Object.freeze(statements);
}

/** Creates missing tables and indexes atomically for a fresh local database. */
export async function initializeSqliteSchema(
  driver: SqlDriver,
  schema: SqliteSchemaSource,
): Promise<void> {
  const statements = generateSqliteSchema(schema);

  await driver.transaction(async (transaction) => {
    for (const statement of statements) {
      await transaction.run(statement, []);
    }
  });
}

function generateTableStatement(
  tableName: string,
  table: TableMetadata,
): string {
  const columns = Object.entries(table.columns).map(([columnName, column]) => {
    const constraints = [column.nullable ? "" : " not null"];
    if (column.primaryKey) {
      constraints.push(" primary key");
    }

    return `  ${quoteIdentifier(columnName)} ${column.kind}${constraints.join("")}`;
  });

  return `create table if not exists ${quoteIdentifier(tableName)} (\n${columns.join(",\n")}\n)`;
}

function generateIndexStatement(
  tableName: string,
  columnName: string,
  unique: boolean,
): string {
  const indexName = unique
    ? `${tableName}_${columnName}_unique_idx`
    : `${tableName}_${columnName}_idx`;
  const uniqueKeyword = unique ? "unique " : "";

  return `create ${uniqueKeyword}index if not exists ${quoteIdentifier(indexName)} on ${quoteIdentifier(tableName)} (${quoteIdentifier(columnName)})`;
}

function assertAvailableTableName(tableName: string): void {
  if (RESERVED_TABLE_NAMES.has(tableName.toLowerCase())) {
    throw new Error(`Table name is reserved by local-sync: ${tableName}`);
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

const SYNC_SIDECAR_STATEMENTS = Object.freeze([
  `create table if not exists "sync_meta" (
  "table_name" text not null,
  "record_id" text not null,
  "hlc_wall_time" integer not null,
  "hlc_counter" integer not null,
  "device_id" text not null,
  "last_server_seq" integer not null default 0,
  "dirty" integer not null default 0,
  "is_deleted" integer not null default 0,
  primary key ("table_name", "record_id")
)`,
  `create index if not exists "sync_meta_dirty_table_idx" on "sync_meta" ("dirty", "table_name")`,
  `create table if not exists "sync_cursors" (
  "cursor_key" text primary key,
  "server_seq" integer not null
)`,
]);

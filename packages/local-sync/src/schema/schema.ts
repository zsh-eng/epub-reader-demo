import type { SyncTablePolicy } from "../core/index.js";
import type { InferColumnValue } from "./columns.js";
import type { TableBuilder, TableDefinitions, TableMetadata } from "./table.js";

export interface SyncSchemaMetadata {
  readonly tables: Readonly<Record<string, TableMetadata>>;
}

/** The application schema consumed by storage and sync adapters. */
export class SyncSchemaBuilder<TTables extends TableDefinitions> {
  readonly tables: TTables;
  readonly meta: SyncSchemaMetadata;

  constructor(tables: TTables) {
    this.tables = Object.freeze({ ...tables }) as TTables;
    this.meta = extractSchemaMetadata(this.tables);
  }
}

export type InferTableRow<TTable> =
  TTable extends TableBuilder<infer TColumns, SyncTablePolicy | undefined>
    ? { [K in keyof TColumns]: InferColumnValue<TColumns[K]> }
    : never;

export function defineSyncSchema<TTables extends TableDefinitions>(
  tables: TTables,
): SyncSchemaBuilder<TTables> {
  return new SyncSchemaBuilder(tables);
}

function extractSchemaMetadata<TTables extends TableDefinitions>(
  tables: TTables,
): SyncSchemaMetadata {
  const tableMetadata: Record<string, TableMetadata> = {};

  for (const [tableName, tableDefinition] of Object.entries(tables)) {
    tableMetadata[tableName] = tableDefinition.meta;
  }

  return Object.freeze({
    tables: Object.freeze(tableMetadata),
  });
}

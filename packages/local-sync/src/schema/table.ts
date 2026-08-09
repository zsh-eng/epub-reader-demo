import type { SyncTablePolicy } from "../core/index.js";
import type {
  ColumnDefinitions,
  ColumnMetadata,
  TextColumnBuilder,
} from "./columns.js";

export interface TableMetadata {
  readonly columns: Readonly<Record<string, ColumnMetadata>>;
  readonly primaryKey: string;
  readonly indexes: readonly string[];
  readonly uniqueIndexes: readonly string[];
  readonly sync?: SyncTablePolicy;
}

type TextPrimaryKeyColumnName<TColumns extends ColumnDefinitions> = {
  [ColumnName in keyof TColumns]: TColumns[ColumnName] extends TextColumnBuilder<
    false,
    true
  >
    ? ColumnName
    : never;
}[keyof TColumns] &
  string;

type NonNullableTextColumnName<TColumns extends ColumnDefinitions> = {
  [ColumnName in keyof TColumns]: TColumns[ColumnName] extends TextColumnBuilder<
    false,
    boolean
  >
    ? ColumnName
    : never;
}[keyof TColumns] &
  string;

export interface SyncedTableOptions<TColumns extends ColumnDefinitions> {
  readonly scopeId?: NonNullableTextColumnName<TColumns>;
  readonly schemaVersion?: number;
}

type SyncedColumns<TColumns extends ColumnDefinitions> = TColumns &
  ([TextPrimaryKeyColumnName<TColumns>] extends [never] ? never : unknown);

type NormalizedSyncPolicy<
  TColumns extends ColumnDefinitions,
  TOptions extends SyncedTableOptions<TColumns> | undefined,
> = Readonly<{
  recordId: TextPrimaryKeyColumnName<TColumns>;
  conflict: "lww";
  schemaVersion: number;
}> &
  (TOptions extends { readonly scopeId: infer ScopeId extends string }
    ? Readonly<{ scopeId: ScopeId }>
    : object);

/** A typed table definition and its storage-neutral metadata. */
export class TableBuilder<
  TColumns extends ColumnDefinitions,
  TSyncPolicy extends SyncTablePolicy | undefined = undefined,
> {
  readonly columns: TColumns;
  readonly sync: TSyncPolicy;
  readonly meta: TableMetadata;

  constructor(columns: TColumns, sync: TSyncPolicy) {
    this.columns = Object.freeze({ ...columns }) as TColumns;
    this.sync = freezeSyncPolicy(sync);
    this.meta = extractTableMetadata(this.columns, this.sync);
  }
}

export type TableDefinitions = Record<
  string,
  TableBuilder<ColumnDefinitions, SyncTablePolicy | undefined>
>;

export function table<TColumns extends ColumnDefinitions>(
  columns: TColumns,
): TableBuilder<TColumns, undefined> {
  return new TableBuilder(columns, undefined);
}

export function syncedTable<TColumns extends ColumnDefinitions>(
  columns: SyncedColumns<TColumns>,
): TableBuilder<TColumns, NormalizedSyncPolicy<TColumns, undefined>>;

export function syncedTable<
  TColumns extends ColumnDefinitions,
  TOptions extends SyncedTableOptions<TColumns>,
>(
  columns: SyncedColumns<TColumns>,
  options: TOptions,
): TableBuilder<TColumns, NormalizedSyncPolicy<TColumns, TOptions>>;

export function syncedTable<TColumns extends ColumnDefinitions>(
  columns: TColumns,
  options: SyncedTableOptions<TColumns> = {},
): TableBuilder<TColumns, SyncTablePolicy> {
  const recordId = findPrimaryKey(columns);
  return new TableBuilder(columns, {
    recordId,
    conflict: "lww",
    schemaVersion: options.schemaVersion ?? 1,
    ...(options.scopeId === undefined ? {} : { scopeId: options.scopeId }),
  });
}

function freezeSyncPolicy<TSyncPolicy extends SyncTablePolicy | undefined>(
  sync: TSyncPolicy,
): TSyncPolicy {
  if (sync === undefined) {
    return sync;
  }

  return Object.freeze({ ...sync }) as unknown as TSyncPolicy;
}

function extractTableMetadata<TColumns extends ColumnDefinitions>(
  columns: TColumns,
  sync: SyncTablePolicy | undefined,
): TableMetadata {
  const columnMetadata: Record<string, ColumnMetadata> = {};
  const indexes: string[] = [];
  const uniqueIndexes: string[] = [];

  for (const [columnName, column] of Object.entries(columns)) {
    columnMetadata[columnName] = column.meta;

    if (column.meta.primaryKey) {
      continue;
    }

    if (column.meta.indexed) {
      indexes.push(columnName);
    }

    if (column.meta.unique) {
      uniqueIndexes.push(columnName);
    }
  }

  const primaryKey = findPrimaryKey(columns);

  if (sync !== undefined) {
    validateSyncPolicy(columns, primaryKey, sync);
  }

  return Object.freeze({
    columns: Object.freeze(columnMetadata),
    primaryKey,
    indexes: Object.freeze(indexes),
    uniqueIndexes: Object.freeze(uniqueIndexes),
    ...(sync === undefined ? {} : { sync }),
  });
}

function findPrimaryKey(columns: ColumnDefinitions): string {
  const primaryKeys = Object.entries(columns)
    .filter(([, column]) => column.meta.primaryKey)
    .map(([columnName]) => columnName);
  const primaryKey = primaryKeys[0];
  if (primaryKeys.length !== 1 || primaryKey === undefined) {
    throw new Error("A table must define exactly one primary key");
  }

  return primaryKey;
}

function validateSyncPolicy(
  columns: ColumnDefinitions,
  primaryKey: string,
  sync: SyncTablePolicy,
): void {
  if (sync.conflict !== "lww") {
    throw new Error(`Unsupported sync conflict policy: ${sync.conflict}`);
  }
  if (!Number.isSafeInteger(sync.schemaVersion) || sync.schemaVersion <= 0) {
    throw new Error("Sync schemaVersion must be a positive safe integer");
  }

  const recordIdColumn = columns[sync.recordId];
  if (
    sync.recordId !== primaryKey ||
    recordIdColumn?.meta.kind !== "text" ||
    recordIdColumn.meta.nullable
  ) {
    throw new Error("A synced table must use a non-null text primary key");
  }

  if (sync.scopeId === undefined) {
    return;
  }

  const scopeIdColumn = columns[sync.scopeId];
  if (scopeIdColumn?.meta.kind !== "text" || scopeIdColumn.meta.nullable) {
    throw new Error("Sync scopeId must name a non-null text column");
  }
}

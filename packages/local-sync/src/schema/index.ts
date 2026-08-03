export type ColumnKind = "text";

export interface TextColumnMetadata<
  Nullable extends boolean = boolean,
  PrimaryKey extends boolean = boolean,
> {
  readonly kind: "text";
  readonly nullable: Nullable;
  readonly primaryKey: PrimaryKey;
  readonly indexed: boolean;
  readonly unique: boolean;
}

export type ColumnMetadata = TextColumnMetadata;

export interface TableMetadata {
  readonly columns: Readonly<Record<string, ColumnMetadata>>;
  readonly primaryKey: string;
  readonly indexes: readonly string[];
  readonly uniqueIndexes: readonly string[];
}

export interface SyncSchemaMetadata {
  readonly tables: Readonly<Record<string, TableMetadata>>;
}

/** Immutable builder for the text-only first slice of the schema DSL. */
export class TextColumnBuilder<
  Nullable extends boolean = true,
  PrimaryKey extends boolean = false,
> {
  readonly meta: TextColumnMetadata<Nullable, PrimaryKey>;

  constructor(meta: TextColumnMetadata<Nullable, PrimaryKey>) {
    this.meta = Object.freeze({ ...meta });
  }

  notNull(): TextColumnBuilder<false, PrimaryKey> {
    return new TextColumnBuilder({ ...this.meta, nullable: false });
  }

  nullable(): TextColumnBuilder<
    PrimaryKey extends true ? false : true,
    PrimaryKey
  > {
    if (this.meta.primaryKey) {
      return new TextColumnBuilder({
        ...this.meta,
        nullable: false,
      }) as TextColumnBuilder<
        PrimaryKey extends true ? false : true,
        PrimaryKey
      >;
    }

    return new TextColumnBuilder({
      ...this.meta,
      nullable: true,
    }) as TextColumnBuilder<PrimaryKey extends true ? false : true, PrimaryKey>;
  }

  primaryKey(): TextColumnBuilder<false, true> {
    return new TextColumnBuilder({
      ...this.meta,
      nullable: false,
      primaryKey: true,
      indexed: true,
      unique: true,
    });
  }

  index(): TextColumnBuilder<Nullable, PrimaryKey> {
    return new TextColumnBuilder({ ...this.meta, indexed: true });
  }

  unique(): TextColumnBuilder<Nullable, PrimaryKey> {
    return new TextColumnBuilder({
      ...this.meta,
      indexed: true,
      unique: true,
    });
  }
}

export type AnyColumnBuilder = TextColumnBuilder<boolean, boolean>;
export type ColumnDefinitions = Record<string, AnyColumnBuilder>;

/** A typed table definition and its storage-neutral metadata. */
export class TableBuilder<TColumns extends ColumnDefinitions> {
  readonly columns: TColumns;
  readonly meta: TableMetadata;

  constructor(columns: TColumns) {
    this.columns = Object.freeze({ ...columns }) as TColumns;
    this.meta = extractTableMetadata(this.columns);
  }
}

export type TableDefinitions = Record<string, TableBuilder<ColumnDefinitions>>;

/** The application schema consumed by future storage and sync adapters. */
export class SyncSchemaBuilder<TTables extends TableDefinitions> {
  readonly tables: TTables;
  readonly meta: SyncSchemaMetadata;

  constructor(tables: TTables) {
    this.tables = Object.freeze({ ...tables }) as TTables;
    this.meta = extractSchemaMetadata(this.tables);
  }
}

export type InferColumnValue<TColumn> =
  TColumn extends TextColumnBuilder<infer Nullable, boolean>
    ? Nullable extends true
      ? string | null
      : string
    : never;

export type InferTableRow<TTable> =
  TTable extends TableBuilder<infer TColumns>
    ? { [K in keyof TColumns]: InferColumnValue<TColumns[K]> }
    : never;

export function text(): TextColumnBuilder<true, false> {
  return new TextColumnBuilder({
    kind: "text",
    nullable: true,
    primaryKey: false,
    indexed: false,
    unique: false,
  });
}

export function table<TColumns extends ColumnDefinitions>(
  columns: TColumns,
): TableBuilder<TColumns> {
  return new TableBuilder(columns);
}

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

function extractTableMetadata<TColumns extends ColumnDefinitions>(
  columns: TColumns,
): TableMetadata {
  const columnMetadata: Record<string, ColumnMetadata> = {};
  const primaryKeys: string[] = [];
  const indexes: string[] = [];
  const uniqueIndexes: string[] = [];

  for (const [columnName, column] of Object.entries(columns)) {
    columnMetadata[columnName] = column.meta;

    if (column.meta.primaryKey) {
      primaryKeys.push(columnName);
      continue;
    }

    if (column.meta.indexed) {
      indexes.push(columnName);
    }

    if (column.meta.unique) {
      uniqueIndexes.push(columnName);
    }
  }

  const primaryKey = primaryKeys[0];
  if (primaryKeys.length !== 1 || primaryKey === undefined) {
    throw new Error("A sync table must define exactly one primary key");
  }

  return Object.freeze({
    columns: Object.freeze(columnMetadata),
    primaryKey,
    indexes: Object.freeze(indexes),
    uniqueIndexes: Object.freeze(uniqueIndexes),
  });
}

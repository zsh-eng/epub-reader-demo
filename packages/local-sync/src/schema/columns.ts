export type ColumnKind = "text" | "integer" | "real" | "json-text";

export interface ColumnMetadata<
  Kind extends ColumnKind = ColumnKind,
  Nullable extends boolean = boolean,
  PrimaryKey extends boolean = boolean,
> {
  readonly kind: Kind;
  readonly nullable: Nullable;
  readonly primaryKey: PrimaryKey;
  readonly indexed: boolean;
  readonly unique: boolean;
}

export type TextColumnMetadata<
  Nullable extends boolean = boolean,
  PrimaryKey extends boolean = boolean,
> = ColumnMetadata<"text", Nullable, PrimaryKey>;

export type IntegerColumnMetadata<
  Nullable extends boolean = boolean,
  PrimaryKey extends boolean = boolean,
> = ColumnMetadata<"integer", Nullable, PrimaryKey>;

export type RealColumnMetadata<Nullable extends boolean = boolean> =
  ColumnMetadata<"real", Nullable, false>;

export type JsonTextColumnMetadata<Nullable extends boolean = boolean> =
  ColumnMetadata<"json-text", Nullable, false>;

/** Immutable builder for SQLite text columns. */
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

/** Immutable builder for SQLite integer columns. */
export class IntegerColumnBuilder<
  Nullable extends boolean = true,
  PrimaryKey extends boolean = false,
> {
  readonly meta: IntegerColumnMetadata<Nullable, PrimaryKey>;

  constructor(meta: IntegerColumnMetadata<Nullable, PrimaryKey>) {
    this.meta = Object.freeze({ ...meta });
  }

  notNull(): IntegerColumnBuilder<false, PrimaryKey> {
    return new IntegerColumnBuilder({ ...this.meta, nullable: false });
  }

  nullable(): IntegerColumnBuilder<
    PrimaryKey extends true ? false : true,
    PrimaryKey
  > {
    if (this.meta.primaryKey) {
      return new IntegerColumnBuilder({
        ...this.meta,
        nullable: false,
      }) as IntegerColumnBuilder<
        PrimaryKey extends true ? false : true,
        PrimaryKey
      >;
    }

    return new IntegerColumnBuilder({
      ...this.meta,
      nullable: true,
    }) as IntegerColumnBuilder<
      PrimaryKey extends true ? false : true,
      PrimaryKey
    >;
  }

  primaryKey(): IntegerColumnBuilder<false, true> {
    return new IntegerColumnBuilder({
      ...this.meta,
      nullable: false,
      primaryKey: true,
      indexed: true,
      unique: true,
    });
  }

  index(): IntegerColumnBuilder<Nullable, PrimaryKey> {
    return new IntegerColumnBuilder({ ...this.meta, indexed: true });
  }

  unique(): IntegerColumnBuilder<Nullable, PrimaryKey> {
    return new IntegerColumnBuilder({
      ...this.meta,
      indexed: true,
      unique: true,
    });
  }
}

/** Immutable builder for SQLite real columns. */
export class RealColumnBuilder<Nullable extends boolean = true> {
  readonly meta: RealColumnMetadata<Nullable>;

  constructor(meta: RealColumnMetadata<Nullable>) {
    this.meta = Object.freeze({ ...meta });
  }

  notNull(): RealColumnBuilder<false> {
    return new RealColumnBuilder({ ...this.meta, nullable: false });
  }

  nullable(): RealColumnBuilder<true> {
    return new RealColumnBuilder({ ...this.meta, nullable: true });
  }

  index(): RealColumnBuilder<Nullable> {
    return new RealColumnBuilder({ ...this.meta, indexed: true });
  }

  unique(): RealColumnBuilder<Nullable> {
    return new RealColumnBuilder({
      ...this.meta,
      indexed: true,
      unique: true,
    });
  }
}

/** Immutable builder for JSON validated and stored as SQLite text. */
export class JsonTextColumnBuilder<Nullable extends boolean = true> {
  readonly meta: JsonTextColumnMetadata<Nullable>;

  constructor(meta: JsonTextColumnMetadata<Nullable>) {
    this.meta = Object.freeze({ ...meta });
  }

  notNull(): JsonTextColumnBuilder<false> {
    return new JsonTextColumnBuilder({ ...this.meta, nullable: false });
  }

  nullable(): JsonTextColumnBuilder<true> {
    return new JsonTextColumnBuilder({ ...this.meta, nullable: true });
  }

  index(): JsonTextColumnBuilder<Nullable> {
    return new JsonTextColumnBuilder({ ...this.meta, indexed: true });
  }

  unique(): JsonTextColumnBuilder<Nullable> {
    return new JsonTextColumnBuilder({
      ...this.meta,
      indexed: true,
      unique: true,
    });
  }
}

export type AnyColumnBuilder =
  | TextColumnBuilder<boolean, boolean>
  | IntegerColumnBuilder<boolean, boolean>
  | RealColumnBuilder<boolean>
  | JsonTextColumnBuilder<boolean>;

export type ColumnDefinitions = Record<string, AnyColumnBuilder>;

type InferNullableValue<Value, Nullable extends boolean> = Nullable extends true
  ? Value | null
  : Value;

export type InferColumnValue<TColumn> =
  TColumn extends TextColumnBuilder<infer Nullable, boolean>
    ? InferNullableValue<string, Nullable>
    : TColumn extends IntegerColumnBuilder<infer Nullable, boolean>
      ? InferNullableValue<number, Nullable>
      : TColumn extends RealColumnBuilder<infer Nullable>
        ? InferNullableValue<number, Nullable>
        : TColumn extends JsonTextColumnBuilder<infer Nullable>
          ? InferNullableValue<string, Nullable>
          : never;

export function text(): TextColumnBuilder<true, false> {
  return new TextColumnBuilder(createColumnMetadata("text"));
}

export function integer(): IntegerColumnBuilder<true, false> {
  return new IntegerColumnBuilder(createColumnMetadata("integer"));
}

export function real(): RealColumnBuilder<true> {
  return new RealColumnBuilder(createColumnMetadata("real"));
}

export function jsonText(): JsonTextColumnBuilder<true> {
  return new JsonTextColumnBuilder(createColumnMetadata("json-text"));
}

function createColumnMetadata<Kind extends ColumnKind>(
  kind: Kind,
): ColumnMetadata<Kind, true, false> {
  return {
    kind,
    nullable: true,
    primaryKey: false,
    indexed: false,
    unique: false,
  };
}

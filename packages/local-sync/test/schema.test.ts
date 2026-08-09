import { describe, expect, expectTypeOf, it } from "vitest";
import {
  defineSyncSchema,
  integer,
  jsonText,
  real,
  syncedTable,
  table,
  text,
  type ColumnDefinitions,
  type InferTableRow,
} from "../src/schema/index.js";

describe("local-sync schema DSL", () => {
  it("extracts storage-neutral metadata from text columns", () => {
    const schema = defineSyncSchema({
      books: table({
        id: text().primaryKey(),
        title: text().notNull(),
        subtitle: text(),
        author: text().notNull().index(),
        fileHash: text().notNull().unique(),
      }),
    });

    expect(schema.meta).toEqual({
      tables: {
        books: {
          columns: {
            id: {
              kind: "text",
              nullable: false,
              primaryKey: true,
              indexed: true,
              unique: true,
            },
            title: {
              kind: "text",
              nullable: false,
              primaryKey: false,
              indexed: false,
              unique: false,
            },
            subtitle: {
              kind: "text",
              nullable: true,
              primaryKey: false,
              indexed: false,
              unique: false,
            },
            author: {
              kind: "text",
              nullable: false,
              primaryKey: false,
              indexed: true,
              unique: false,
            },
            fileHash: {
              kind: "text",
              nullable: false,
              primaryKey: false,
              indexed: true,
              unique: true,
            },
          },
          primaryKey: "id",
          indexes: ["author", "fileHash"],
          uniqueIndexes: ["fileHash"],
        },
      },
    });
  });

  it("keeps builders and exposed definitions immutable", () => {
    const baseColumn = text();
    const requiredColumn = baseColumn.notNull();
    const books = table({
      id: text().primaryKey(),
      title: requiredColumn,
    });
    const schema = defineSyncSchema({ books });

    expect(baseColumn.meta.nullable).toBe(true);
    expect(requiredColumn.meta.nullable).toBe(false);
    expect(Object.isFrozen(baseColumn.meta)).toBe(true);
    expect(Object.isFrozen(books.columns)).toBe(true);
    expect(Object.isFrozen(books.meta)).toBe(true);
    expect(Object.isFrozen(schema.tables)).toBe(true);
    expect(Object.isFrozen(schema.meta)).toBe(true);
    expect(books.sync).toBeUndefined();
  });

  it("derives v1 sync policy from a synced table", () => {
    const books = syncedTable({
      id: text().primaryKey(),
      title: text().notNull(),
    });
    const highlights = syncedTable(
      {
        id: text().primaryKey(),
        bookId: text().notNull().index(),
        page: integer(),
        progress: real().notNull(),
        metadata: jsonText(),
      },
      {
        scopeId: "bookId",
      },
    );

    expect(books.sync).toEqual({
      recordId: "id",
      conflict: "lww",
      schemaVersion: 1,
    });
    expect("scopeId" in books.sync).toBe(false);
    expect(highlights.meta).toMatchObject({
      primaryKey: "id",
      sync: {
        recordId: "id",
        scopeId: "bookId",
        conflict: "lww",
        schemaVersion: 1,
      },
      columns: {
        page: { kind: "integer", nullable: true },
        progress: { kind: "real", nullable: false },
        metadata: { kind: "json-text", nullable: true },
      },
    });
    expect(Object.isFrozen(highlights.sync)).toBe(true);
    expect(Object.isFrozen(highlights.meta.sync)).toBe(true);
    expectTypeOf(highlights.sync.recordId).toEqualTypeOf<"id">();
    expectTypeOf(highlights.sync.scopeId).toEqualTypeOf<"bookId">();
  });

  it("keeps a primary key non-null when nullable is called later", () => {
    const id = text().primaryKey().nullable();

    expect(id.meta).toEqual({
      kind: "text",
      nullable: false,
      primaryKey: true,
      indexed: true,
      unique: true,
    });

    expectTypeOf(id).toEqualTypeOf<
      ReturnType<ReturnType<typeof text>["primaryKey"]>
    >();
  });

  it("requires exactly one primary key per table", () => {
    expect(() =>
      table({
        title: text().notNull(),
      }),
    ).toThrow("A table must define exactly one primary key");

    expect(() =>
      table({
        id: text().primaryKey(),
        externalId: text().primaryKey(),
      }),
    ).toThrow("A table must define exactly one primary key");
  });

  it("validates sync policies at runtime", () => {
    const unsafeSyncedTable = syncedTable as (
      columns: ColumnDefinitions,
      options?: { readonly scopeId?: string; readonly schemaVersion?: number },
    ) => unknown;

    expect(() =>
      unsafeSyncedTable({
        id: integer().primaryKey(),
      }),
    ).toThrow("A synced table must use a non-null text primary key");

    expect(() =>
      unsafeSyncedTable(
        {
          id: text().primaryKey(),
          bookId: text(),
        },
        { scopeId: "bookId" },
      ),
    ).toThrow("Sync scopeId must name a non-null text column");

    expect(() =>
      unsafeSyncedTable({ id: text().primaryKey() }, { schemaVersion: 0 }),
    ).toThrow("Sync schemaVersion must be a positive safe integer");
  });

  it("infers row types from column metadata", () => {
    const books = table({
      id: text().primaryKey(),
      title: text().notNull(),
      subtitle: text(),
      pageCount: integer(),
      progress: real().notNull(),
      metadata: jsonText(),
    });

    type BookRow = InferTableRow<typeof books>;

    expectTypeOf<BookRow>().toEqualTypeOf<{
      id: string;
      title: string;
      subtitle: string | null;
      pageCount: number | null;
      progress: number;
      metadata: string | null;
    }>();

    const row: BookRow = {
      id: "book-1",
      title: "Example",
      subtitle: null,
      pageCount: 12,
      progress: 0.5,
      metadata: '{"language":"en"}',
    };

    expect(row).toEqual({
      id: "book-1",
      title: "Example",
      subtitle: null,
      pageCount: 12,
      progress: 0.5,
      metadata: '{"language":"en"}',
    });
  });
});

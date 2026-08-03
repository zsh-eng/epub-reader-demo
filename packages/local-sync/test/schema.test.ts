import { describe, expect, expectTypeOf, it } from "vitest";
import {
  defineSyncSchema,
  table,
  text,
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
    ).toThrow("A sync table must define exactly one primary key");

    expect(() =>
      table({
        id: text().primaryKey(),
        externalId: text().primaryKey(),
      }),
    ).toThrow("A sync table must define exactly one primary key");
  });

  it("infers row types from column metadata", () => {
    const books = table({
      id: text().primaryKey(),
      title: text().notNull(),
      subtitle: text(),
    });

    type BookRow = InferTableRow<typeof books>;

    expectTypeOf<BookRow>().toEqualTypeOf<{
      id: string;
      title: string;
      subtitle: string | null;
    }>();

    const row: BookRow = {
      id: "book-1",
      title: "Example",
      subtitle: null,
    };

    expect(row).toEqual({
      id: "book-1",
      title: "Example",
      subtitle: null,
    });
  });
});

import { describe, expect, it } from "vitest";
import { generateSqliteSchema } from "../src/adapters/sqlite/index.js";
import {
  defineSyncSchema,
  integer,
  jsonText,
  real,
  syncedTable,
  table,
  text,
} from "../src/schema/index.js";

describe("SQLite schema generation", () => {
  it("generates app tables, indexes, and sync sidecars", () => {
    const schema = defineSyncSchema({
      books: table({
        id: text().primaryKey(),
        title: text().notNull(),
        subtitle: text(),
        author: text().notNull().index(),
        fileHash: text().notNull().unique(),
      }),
    });

    const statements = generateSqliteSchema(schema);

    expect(statements).toEqual([
      `create table if not exists "books" (
  "id" text not null primary key,
  "title" text not null,
  "subtitle" text,
  "author" text not null,
  "fileHash" text not null
)`,
      `create index if not exists "books_author_idx" on "books" ("author")`,
      `create unique index if not exists "books_fileHash_unique_idx" on "books" ("fileHash")`,
      `create table if not exists "sync_meta" (
  "table_name" text not null check (length("table_name") > 0),
  "record_id" text not null check (length("record_id") > 0),
  "hlc_wall_time" integer not null check ("hlc_wall_time" >= 0),
  "hlc_counter" integer not null check ("hlc_counter" >= 0),
  "device_id" text not null check (length("device_id") > 0),
  "last_server_seq" integer not null default 0 check ("last_server_seq" >= 0),
  "dirty" integer not null default 0 check ("dirty" in (0, 1)),
  "is_deleted" integer not null default 0 check ("is_deleted" in (0, 1)),
  primary key ("table_name", "record_id")
)`,
      `create index if not exists "sync_meta_dirty_table_idx" on "sync_meta" ("dirty", "table_name")`,
      `create table if not exists "sync_cursors" (
  "cursor_key" text primary key check (length("cursor_key") > 0),
  "server_seq" integer not null check ("server_seq" >= 0)
)`,
      `create table if not exists "sync_hlc_state" (
  "device_id" text primary key check (length("device_id") > 0),
  "wall_time_ms" integer not null check ("wall_time_ms" >= 0),
  "counter" integer not null check ("counter" >= 0)
)`,
    ]);
    expect(Object.isFrozen(statements)).toBe(true);
  });

  it("quotes declared SQLite identifiers without renaming them", () => {
    const schema = defineSyncSchema({
      "reading-log": table({
        select: text().primaryKey(),
        'display"name': text().index(),
      }),
    });

    const statements = generateSqliteSchema(schema);

    expect(statements[0]).toContain('"reading-log"');
    expect(statements[0]).toContain('"select" text not null primary key');
    expect(statements[0]).toContain('"display""name" text');
    expect(statements[1]).toContain(
      '"reading-log_display""name_idx" on "reading-log" ("display""name")',
    );
  });

  it("generates integer, real, and JSON-text columns", () => {
    const schema = defineSyncSchema({
      highlights: syncedTable(
        {
          id: text().primaryKey(),
          bookId: text().notNull(),
          page: integer(),
          progress: real().notNull(),
          metadata: jsonText(),
          requiredMetadata: jsonText().notNull(),
        },
        {
          scopeId: "bookId",
        },
      ),
    });

    expect(generateSqliteSchema(schema)[0]).toBe(
      `create table if not exists "highlights" (
  "id" text not null primary key,
  "bookId" text not null,
  "page" integer,
  "progress" real not null,
  "metadata" text check ("metadata" is null or json_valid("metadata")),
  "requiredMetadata" text not null check (json_valid("requiredMetadata"))
)`,
    );
  });

  it("reserves the sidecar table names", () => {
    const schema = defineSyncSchema({
      Sync_Meta: table({
        id: text().primaryKey(),
      }),
    });

    expect(() => generateSqliteSchema(schema)).toThrow(
      "Table name is reserved by local-sync: Sync_Meta",
    );

    const hlcSchema = defineSyncSchema({
      SYNC_HLC_STATE: table({
        id: text().primaryKey(),
      }),
    });
    expect(() => generateSqliteSchema(hlcSchema)).toThrow(
      "Table name is reserved by local-sync: SYNC_HLC_STATE",
    );
  });
});

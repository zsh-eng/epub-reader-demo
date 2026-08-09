import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initializeSqliteSchema } from "../src/adapters/sqlite/index.js";
import {
  defineSyncSchema,
  integer,
  jsonText,
  real,
  table,
  text,
} from "../src/schema/index.js";
import { BunSqliteTestDriver } from "./support/bun-sqlite-driver.js";

interface SqliteObjectRow {
  name: string;
  type: string;
}

interface SyncMetaDefaultsRow {
  last_server_seq: number;
  dirty: number;
  is_deleted: number;
}

describe("SQLite generated schema", () => {
  let driver: BunSqliteTestDriver;

  beforeEach(() => {
    driver = new BunSqliteTestDriver();
  });

  afterEach(() => {
    driver.close();
  });

  it("initializes a usable schema idempotently", async () => {
    const schema = defineSyncSchema({
      books: table({
        id: text().primaryKey(),
        title: text().notNull(),
        author: text().index(),
        fileHash: text().notNull().unique(),
      }),
    });

    await initializeSqliteSchema(driver, schema);
    await initializeSqliteSchema(driver, schema);

    const objects = await driver.all<SqliteObjectRow>(
      `select type, name
       from sqlite_schema
       where name not like 'sqlite_autoindex%'
       order by type, name`,
      [],
    );

    expect(objects).toEqual([
      { type: "index", name: "books_author_idx" },
      { type: "index", name: "books_fileHash_unique_idx" },
      { type: "index", name: "sync_meta_dirty_table_idx" },
      { type: "table", name: "books" },
      { type: "table", name: "sync_cursors" },
      { type: "table", name: "sync_hlc_state" },
      { type: "table", name: "sync_meta" },
    ]);

    await driver.run(
      "insert into books (id, title, author, fileHash) values (?, ?, ?, ?)",
      ["book-1", "First", null, "hash-1"],
    );
    await expect(
      driver.run(
        "insert into books (id, title, author, fileHash) values (?, ?, ?, ?)",
        ["book-2", "Second", null, "hash-1"],
      ),
    ).rejects.toThrow();
    await expect(
      driver.run(
        "insert into books (id, title, author, fileHash) values (?, ?, ?, ?)",
        ["book-3", null, null, "hash-3"],
      ),
    ).rejects.toThrow();

    await driver.run(
      `insert into sync_meta (
        table_name, record_id, hlc_wall_time, hlc_counter, device_id
      ) values (?, ?, ?, ?, ?)`,
      ["books", "book-1", 100, 0, "device-1"],
    );
    expect(
      await driver.all<SyncMetaDefaultsRow>(
        `select last_server_seq, dirty, is_deleted
         from sync_meta
         where table_name = ? and record_id = ?`,
        ["books", "book-1"],
      ),
    ).toEqual([{ last_server_seq: 0, dirty: 0, is_deleted: 0 }]);

    await driver.run(
      "insert into sync_cursors (cursor_key, server_seq) values (?, ?)",
      ["app", 42],
    );
    expect(
      await driver.all<{ server_seq: number }>(
        "select server_seq from sync_cursors where cursor_key = ?",
        ["app"],
      ),
    ).toEqual([{ server_seq: 42 }]);
  });

  it("enforces generated scalar and JSON-text columns", async () => {
    const schema = defineSyncSchema({
      measurements: table({
        id: integer().primaryKey(),
        score: real().notNull(),
        metadata: jsonText(),
        requiredMetadata: jsonText().notNull(),
      }),
    });
    await initializeSqliteSchema(driver, schema);

    await driver.run(
      `insert into measurements (id, score, metadata, requiredMetadata)
       values (?, ?, ?, ?)`,
      [1, 0.75, '{"source":"reader"}', '["required"]'],
    );
    await driver.run(
      `insert into measurements (id, score, metadata, requiredMetadata)
       values (?, ?, ?, ?)`,
      [2, 1.25, null, "{}"],
    );

    expect(
      await driver.all<{
        id: number;
        score: number;
        metadata: string | null;
      }>("select id, score, metadata from measurements order by id", []),
    ).toEqual([
      { id: 1, score: 0.75, metadata: '{"source":"reader"}' },
      { id: 2, score: 1.25, metadata: null },
    ]);

    await expect(
      driver.run(
        `insert into measurements (id, score, metadata, requiredMetadata)
         values (?, ?, ?, ?)`,
        [3, 1.5, "not-json", "{}"],
      ),
    ).rejects.toThrow();
    await expect(
      driver.run(
        `insert into measurements (id, score, metadata, requiredMetadata)
         values (?, ?, ?, ?)`,
        [4, 1.75, null, "not-json"],
      ),
    ).rejects.toThrow();
  });
});

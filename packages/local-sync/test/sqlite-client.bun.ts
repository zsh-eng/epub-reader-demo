import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHybridLogicalClock } from "../src/client/index.js";
import type { SequencedSyncRecord, SyncPayload } from "../src/core/index.js";
import {
  createSqliteSyncClient,
  initializeSqliteSchema,
  SqliteHlcStateStorage,
} from "../src/adapters/sqlite/index.js";
import {
  defineSyncSchema,
  integer,
  jsonText,
  real,
  syncedTable,
  table,
  text,
} from "../src/schema/index.js";
import { BunSqliteTestDriver } from "./support/bun-sqlite-driver.js";

const schema = defineSyncSchema({
  books: syncedTable({
    id: text().primaryKey(),
    title: text().notNull(),
    fileHash: text().notNull().unique(),
    pageCount: integer(),
    rating: real(),
    metadata: jsonText(),
  }),
  highlights: syncedTable(
    {
      id: text().primaryKey(),
      bookId: text().notNull().index(),
      quote: text().notNull(),
    },
    { scopeId: "bookId", schemaVersion: 2 },
  ),
  localFiles: table({
    id: integer().primaryKey(),
    path: text().notNull(),
  }),
});

interface BookRow {
  readonly id: string;
  readonly title: string;
  readonly fileHash: string;
}

interface SyncMetaRow {
  readonly table_name: string;
  readonly record_id: string;
  readonly hlc_wall_time: number;
  readonly hlc_counter: number;
  readonly device_id: string;
  readonly last_server_seq: number;
  readonly dirty: number;
  readonly is_deleted: number;
}

function book(id: string, title: string, fileHash = `hash-${id}`) {
  return {
    id,
    title,
    fileHash,
    pageCount: null,
    rating: null,
    metadata: '{"source":"test"}',
  } as const;
}

describe("SQLite sync client", () => {
  let driver: BunSqliteTestDriver;
  let now: number;

  beforeEach(async () => {
    driver = new BunSqliteTestDriver();
    now = 100;
    await initializeSqliteSchema(driver, schema);
  });

  afterEach(() => {
    driver.close();
  });

  function createClient() {
    const clock = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage: new SqliteHlcStateStorage(driver),
      now: () => now,
    });
    return createSqliteSyncClient({ schema, driver, clock });
  }

  it("writes domain rows and dirty metadata with unique batch HLCs", async () => {
    const client = createClient();
    const records = await client.putMany("books", [
      book("book-1", "First"),
      book("book-2", "Second"),
    ]);

    expect(records.map(({ hlc }) => hlc)).toEqual([
      { wallTimeMs: 100, counter: 0 },
      { wallTimeMs: 100, counter: 1 },
    ]);
    expect(
      await driver.all<BookRow>(
        "select id, title, fileHash from books order by id",
        [],
      ),
    ).toEqual([
      { id: "book-1", title: "First", fileHash: "hash-book-1" },
      { id: "book-2", title: "Second", fileHash: "hash-book-2" },
    ]);
    expect(await readSyncMetadata(driver)).toEqual([
      {
        table_name: "books",
        record_id: "book-1",
        hlc_wall_time: 100,
        hlc_counter: 0,
        device_id: "device-1",
        last_server_seq: 0,
        dirty: 1,
        is_deleted: 0,
      },
      {
        table_name: "books",
        record_id: "book-2",
        hlc_wall_time: 100,
        hlc_counter: 1,
        device_id: "device-1",
        last_server_seq: 0,
        dirty: 1,
        is_deleted: 0,
      },
    ]);
  });

  it("preserves the last acknowledged sequence on a later local write", async () => {
    const client = createClient();
    await client.put("books", book("book-1", "First"));
    await driver.run(
      `update sync_meta
       set last_server_seq = ?, dirty = 0
       where table_name = ? and record_id = ?`,
      [42, "books", "book-1"],
    );

    await client.put("books", book("book-1", "Updated"));

    expect(await readSyncMetadata(driver)).toEqual([
      {
        table_name: "books",
        record_id: "book-1",
        hlc_wall_time: 100,
        hlc_counter: 1,
        device_id: "device-1",
        last_server_seq: 42,
        dirty: 1,
        is_deleted: 0,
      },
    ]);
  });

  it("serializes concurrent calls through one client", async () => {
    const client = createClient();

    const first = client.put("books", book("book-1", "First"));
    const second = client.put("books", book("book-1", "Second"));
    await Promise.all([first, second]);

    expect(
      await driver.all<BookRow>(
        "select id, title, fileHash from books where id = ?",
        ["book-1"],
      ),
    ).toEqual([{ id: "book-1", title: "Second", fileHash: "hash-book-1" }]);
    expect((await readSyncMetadata(driver))[0]?.hlc_counter).toBe(1);
  });

  it("does not let a stale local HLC overwrite a newer stored version", async () => {
    const client = createClient();
    await driver.run(
      `insert into books (
         id, title, fileHash, pageCount, rating, metadata
       ) values (?, ?, ?, ?, ?, ?)`,
      ["book-1", "Remote", "hash-book-1", null, null, "{}"],
    );
    await driver.run(
      `insert into sync_meta (
         table_name,
         record_id,
         hlc_wall_time,
         hlc_counter,
         device_id,
         dirty,
         is_deleted
       ) values (?, ?, ?, ?, ?, 0, 0)`,
      ["books", "book-1", 1_000, 0, "device-2"],
    );

    await expect(
      client.put("books", book("book-1", "Stale local")),
    ).rejects.toThrow("Local write was superseded before commit: books/book-1");
    expect(
      await driver.all<{ title: string }>(
        "select title from books where id = ?",
        ["book-1"],
      ),
    ).toEqual([{ title: "Remote" }]);
  });

  it("retains domain payloads when marking local deletes", async () => {
    const client = createClient();
    await client.put("highlights", {
      id: "highlight-1",
      bookId: "book-1",
      quote: "Example",
    });

    const deleted = await client.delete("highlights", "highlight-1");

    expect(deleted).toMatchObject({
      tableName: "highlights",
      recordId: "highlight-1",
      scopeId: "book-1",
      operation: "delete",
      schemaVersion: 2,
      payload: {
        id: "highlight-1",
        bookId: "book-1",
        quote: "Example",
      },
    });
    expect(
      await driver.all(
        "select id, bookId, quote from highlights where id = ?",
        ["highlight-1"],
      ),
    ).toEqual([{ id: "highlight-1", bookId: "book-1", quote: "Example" }]);
    expect((await readSyncMetadata(driver))[0]?.is_deleted).toBe(1);
  });

  it("reconstructs deterministic pending puts and tombstones", async () => {
    const client = createClient();
    await client.put("books", book("book-1", "First"));
    await client.putMany("highlights", [
      { id: "highlight-2", bookId: "book-1", quote: "Second" },
      { id: "highlight-1", bookId: "book-1", quote: "First" },
    ]);
    await client.delete("highlights", "highlight-2");
    await driver.run(
      `update sync_meta
       set dirty = 0
       where table_name = ? and record_id = ?`,
      ["books", "book-1"],
    );

    const pending = await client.getPendingChanges();

    expect(
      pending.map((record) => ({
        key: `${record.tableName}/${record.recordId}`,
        operation: record.operation,
        scopeId: record.scopeId,
        counter: record.hlc.counter,
        schemaVersion: record.schemaVersion,
      })),
    ).toEqual([
      {
        key: "highlights/highlight-1",
        operation: "put",
        scopeId: "book-1",
        counter: 2,
        schemaVersion: 2,
      },
      {
        key: "highlights/highlight-2",
        operation: "delete",
        scopeId: "book-1",
        counter: 3,
        schemaVersion: 2,
      },
    ]);
    expect(await client.getPendingChanges({ limit: 1 })).toHaveLength(1);
  });

  it("rejects local-only tables before advancing the HLC", async () => {
    const client = createClient();
    const unsafeClient = client as unknown as {
      put(tableName: string, row: unknown): Promise<unknown>;
    };

    await expect(
      unsafeClient.put("localFiles", { id: 1, path: "/book.epub" }),
    ).rejects.toThrow("Table is local-only and cannot be synced: localFiles");
    expect(await driver.all("select * from sync_hlc_state", [])).toEqual([]);
  });

  it("rolls back the whole local batch when a domain write fails", async () => {
    const client = createClient();

    await expect(
      client.putMany("books", [
        book("book-1", "First", "duplicate"),
        book("book-2", "Second", "duplicate"),
      ]),
    ).rejects.toThrow();

    expect(await driver.all("select * from books", [])).toEqual([]);
    expect(await driver.all("select * from sync_meta", [])).toEqual([]);
    const next = await client.put("books", book("book-3", "Third"));
    expect(next.hlc).toEqual({ wallTimeMs: 100, counter: 2 });
  });

  it("rejects deletes for rows that do not exist", async () => {
    const client = createClient();

    await expect(client.delete("books", "missing")).rejects.toThrow(
      "Cannot delete missing row: books/missing",
    );
    expect(await driver.all("select * from sync_meta", [])).toEqual([]);
  });

  it("applies remote puts and retained tombstones with the pull cursor", async () => {
    const client = createClient();
    const result = await client.applyRemote(
      [
        sequencedBook({
          id: "book-1",
          title: "Remote",
          wallTimeMs: 500,
          counter: 2,
          serverSeq: 10,
        }),
        {
          tableName: "highlights",
          recordId: "highlight-1",
          scopeId: "book-1",
          operation: "delete",
          payload: {
            id: "highlight-1",
            bookId: "book-1",
            quote: "Retained",
          },
          hlc: { wallTimeMs: 501, counter: 3 },
          deviceId: "device-2",
          schemaVersion: 2,
          serverSeq: 11,
        },
      ],
      { cursor: 11 },
    );

    expect(result).toEqual({
      processedRecordCount: 2,
      appliedRecordCount: 2,
      affected: [
        { tableName: "books" },
        { tableName: "highlights", scopeId: "book-1" },
      ],
    });
    expect(
      await driver.all<BookRow>(
        "select id, title, fileHash from books order by id",
        [],
      ),
    ).toEqual([{ id: "book-1", title: "Remote", fileHash: "hash-book-1" }]);
    expect(
      await driver.all(
        "select id, bookId, quote from highlights where id = ?",
        ["highlight-1"],
      ),
    ).toEqual([{ id: "highlight-1", bookId: "book-1", quote: "Retained" }]);
    expect(await readSyncMetadata(driver)).toEqual([
      {
        table_name: "books",
        record_id: "book-1",
        hlc_wall_time: 500,
        hlc_counter: 2,
        device_id: "device-2",
        last_server_seq: 10,
        dirty: 0,
        is_deleted: 0,
      },
      {
        table_name: "highlights",
        record_id: "highlight-1",
        hlc_wall_time: 501,
        hlc_counter: 3,
        device_id: "device-2",
        last_server_seq: 11,
        dirty: 0,
        is_deleted: 1,
      },
    ]);
    expect(await client.getCursor()).toBe(11);
    expect(
      await driver.all(
        `select wall_time_ms, counter
         from sync_hlc_state
         where device_id = ?`,
        ["device-1"],
      ),
    ).toEqual([{ wall_time_ms: 501, counter: 4 }]);
  });

  it("keeps a newer local edit dirty when an older server row arrives", async () => {
    now = 1_000;
    const client = createClient();
    await client.put("books", book("book-1", "Local"));

    const result = await client.applyRemote(
      [
        sequencedBook({
          id: "book-1",
          title: "Older remote",
          wallTimeMs: 900,
          serverSeq: 7,
        }),
      ],
      { cursor: 7 },
    );

    expect(result).toEqual({
      processedRecordCount: 1,
      appliedRecordCount: 0,
      affected: [],
    });
    expect(
      await driver.all<{ title: string }>(
        "select title from books where id = ?",
        ["book-1"],
      ),
    ).toEqual([{ title: "Local" }]);
    expect(await readSyncMetadata(driver)).toMatchObject([
      { last_server_seq: 7, dirty: 1, hlc_wall_time: 1_000 },
    ]);
    expect(await client.getCursor()).toBe(7);
  });

  it("acknowledges only the exact local version returned by the server", async () => {
    const client = createClient();
    const first = await client.put("books", book("book-1", "First"));
    const acknowledgement = {
      accepted: true,
      record: { ...first, serverSeq: 20 },
    } as const;

    expect(await client.reconcilePushOutcomes([acknowledgement])).toEqual({
      processedRecordCount: 1,
      appliedRecordCount: 0,
      affected: [],
    });
    expect(await readSyncMetadata(driver)).toMatchObject([
      { last_server_seq: 20, dirty: 0 },
    ]);
    expect(await client.getPendingChanges()).toEqual([]);

    await client.put("books", book("book-1", "Second"));
    await client.reconcilePushOutcomes([acknowledgement]);

    expect(
      await driver.all<{ title: string }>(
        "select title from books where id = ?",
        ["book-1"],
      ),
    ).toEqual([{ title: "Second" }]);
    expect(await readSyncMetadata(driver)).toMatchObject([
      { last_server_seq: 20, dirty: 1, hlc_counter: 2 },
    ]);
  });

  it("applies the server winner returned for a rejected push", async () => {
    const client = createClient();
    await client.put("books", book("book-1", "Local"));
    const outcome = {
      accepted: false,
      record: sequencedBook({
        id: "book-1",
        title: "Remote winner",
        wallTimeMs: 200,
        serverSeq: 3,
      }),
    } as const;

    const result = await client.reconcilePushOutcomes([outcome]);

    expect(result).toEqual({
      processedRecordCount: 1,
      appliedRecordCount: 1,
      affected: [{ tableName: "books" }],
    });
    expect(
      await driver.all<{ title: string }>(
        "select title from books where id = ?",
        ["book-1"],
      ),
    ).toEqual([{ title: "Remote winner" }]);
    expect(await readSyncMetadata(driver)).toMatchObject([
      { last_server_seq: 3, dirty: 0, device_id: "device-2" },
    ]);
  });

  it("reports both scopes when a winning record moves between scopes", async () => {
    const client = createClient();
    await client.applyRemote([
      {
        tableName: "highlights",
        recordId: "highlight-1",
        scopeId: "book-1",
        operation: "put",
        payload: {
          id: "highlight-1",
          bookId: "book-1",
          quote: "First",
        },
        hlc: { wallTimeMs: 200, counter: 0 },
        deviceId: "device-2",
        schemaVersion: 2,
        serverSeq: 1,
      },
    ]);

    const result = await client.applyRemote([
      {
        tableName: "highlights",
        recordId: "highlight-1",
        scopeId: "book-2",
        operation: "put",
        payload: {
          id: "highlight-1",
          bookId: "book-2",
          quote: "Moved",
        },
        hlc: { wallTimeMs: 201, counter: 0 },
        deviceId: "device-2",
        schemaVersion: 2,
        serverSeq: 2,
      },
    ]);

    expect(result.affected).toEqual([
      { tableName: "highlights", scopeId: "book-1" },
      { tableName: "highlights", scopeId: "book-2" },
    ]);
  });

  it("rolls back remote rows and their cursor as one transaction", async () => {
    const client = createClient();

    await expect(
      client.applyRemote(
        [
          sequencedBook({
            id: "book-1",
            title: "First",
            fileHash: "duplicate",
            wallTimeMs: 300,
            serverSeq: 1,
          }),
          sequencedBook({
            id: "book-2",
            title: "Second",
            fileHash: "duplicate",
            wallTimeMs: 301,
            serverSeq: 2,
          }),
        ],
        { cursor: 2 },
      ),
    ).rejects.toThrow();

    expect(await driver.all("select * from books", [])).toEqual([]);
    expect(await driver.all("select * from sync_meta", [])).toEqual([]);
    expect(await client.getCursor()).toBe(0);
  });

  it("validates a remote batch before advancing storage state", async () => {
    const client = createClient();
    const invalidPayload = {
      ...sequencedBook({
        id: "book-1",
        title: "Missing columns",
        wallTimeMs: 500,
        serverSeq: 1,
      }),
      payload: { id: "book-1", title: "Missing columns" },
    } as unknown as SequencedSyncRecord<SyncPayload>;
    const invalid = {
      ...sequencedBook({
        id: "book-1",
        title: "Wrong version",
        wallTimeMs: 500,
        serverSeq: 1,
      }),
      schemaVersion: 2,
    };

    await expect(client.applyRemote([invalidPayload])).rejects.toThrow();
    await expect(client.applyRemote([invalid])).rejects.toThrow(
      "Remote schema version mismatch for books",
    );
    expect(await driver.all("select * from sync_hlc_state", [])).toEqual([]);
    expect(await driver.all("select * from books", [])).toEqual([]);
  });

  it("keeps named cursors monotonic", async () => {
    const client = createClient();

    await client.setCursor(10, "books");
    await client.setCursor(5, "books");
    await client.applyRemote([], { cursor: 12, cursorKey: "books" });

    expect(await client.getCursor("books")).toBe(12);
    expect(await client.getCursor("missing")).toBe(0);
  });
});

function sequencedBook(options: {
  readonly id: string;
  readonly title: string;
  readonly fileHash?: string;
  readonly wallTimeMs: number;
  readonly counter?: number;
  readonly serverSeq: number;
}): SequencedSyncRecord<ReturnType<typeof book>> {
  return {
    tableName: "books",
    recordId: options.id,
    operation: "put",
    payload: book(
      options.id,
      options.title,
      options.fileHash ?? `hash-${options.id}`,
    ),
    hlc: {
      wallTimeMs: options.wallTimeMs,
      counter: options.counter ?? 0,
    },
    deviceId: "device-2",
    schemaVersion: 1,
    serverSeq: options.serverSeq,
  };
}

function readSyncMetadata(
  driver: BunSqliteTestDriver,
): Promise<readonly SyncMetaRow[]> {
  return driver.all<SyncMetaRow>(
    `select
       table_name,
       record_id,
       hlc_wall_time,
       hlc_counter,
       device_id,
       last_server_seq,
       dirty,
       is_deleted
     from sync_meta
     order by table_name, record_id`,
    [],
  );
}

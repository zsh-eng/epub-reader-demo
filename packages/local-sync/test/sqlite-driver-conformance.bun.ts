import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BunSqliteTestDriver } from "./support/bun-sqlite-driver.js";

interface BookRow {
  id: string;
  title: string;
}

interface SyncMetaRow {
  record_id: string;
  hlc_wall_time: number;
  hlc_counter: number;
  device_id: string;
  is_deleted: number;
}

describe("SQLite driver conformance", () => {
  let driver: BunSqliteTestDriver;

  beforeEach(() => {
    driver = new BunSqliteTestDriver();
  });

  afterEach(() => {
    driver.close();
  });

  it("binds parameters for multi-row writes and typed reads", async () => {
    await createBooksTable(driver);

    const result = await driver.run(
      "insert into books (id, title) values (?, ?), (?, ?)",
      ["book-1", "First", "book-2", "Second"],
    );
    const rows = await driver.all<BookRow>(
      "select id, title from books where id = ?",
      ["book-2"],
    );

    expect(result.rowsAffected).toBe(2);
    expect(rows).toEqual([{ id: "book-2", title: "Second" }]);
  });

  it("returns only per-row LWW winners from one multi-row upsert", async () => {
    await createSyncMetaTable(driver);
    await driver.run(
      `insert into sync_meta (
        table_name, record_id, hlc_wall_time, hlc_counter, device_id, is_deleted
      ) values (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      [
        "books",
        "book-1",
        200,
        0,
        "device-a",
        0,
        "books",
        "book-2",
        200,
        0,
        "device-a",
        0,
      ],
    );

    const winners = await driver.all<{ record_id: string }>(
      `insert into sync_meta (
        table_name, record_id, hlc_wall_time, hlc_counter, device_id, is_deleted
      ) values
        (?, ?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?, ?)
      on conflict (table_name, record_id) do update set
        hlc_wall_time = excluded.hlc_wall_time,
        hlc_counter = excluded.hlc_counter,
        device_id = excluded.device_id,
        is_deleted = excluded.is_deleted
      where excluded.hlc_wall_time > sync_meta.hlc_wall_time
        or (
          excluded.hlc_wall_time = sync_meta.hlc_wall_time
          and excluded.hlc_counter > sync_meta.hlc_counter
        )
        or (
          excluded.hlc_wall_time = sync_meta.hlc_wall_time
          and excluded.hlc_counter = sync_meta.hlc_counter
          and excluded.device_id > sync_meta.device_id
        )
      returning record_id`,
      [
        "books",
        "book-1",
        199,
        10,
        "device-z",
        1,
        "books",
        "book-2",
        200,
        0,
        "device-b",
        1,
        "books",
        "book-3",
        100,
        0,
        "device-c",
        0,
      ],
    );
    const metadata = await driver.all<SyncMetaRow>(
      `select record_id, hlc_wall_time, hlc_counter, device_id, is_deleted
       from sync_meta
       order by record_id`,
      [],
    );

    expect(winners.map(({ record_id }) => record_id).sort()).toEqual([
      "book-2",
      "book-3",
    ]);
    expect(metadata).toEqual([
      {
        record_id: "book-1",
        hlc_wall_time: 200,
        hlc_counter: 0,
        device_id: "device-a",
        is_deleted: 0,
      },
      {
        record_id: "book-2",
        hlc_wall_time: 200,
        hlc_counter: 0,
        device_id: "device-b",
        is_deleted: 1,
      },
      {
        record_id: "book-3",
        hlc_wall_time: 100,
        hlc_counter: 0,
        device_id: "device-c",
        is_deleted: 0,
      },
    ]);
  });

  it("commits or rolls back domain and sidecar writes together", async () => {
    await createBooksTable(driver);
    await createSyncMetaTable(driver);

    await driver.transaction(async (transaction) => {
      await transaction.run("insert into books (id, title) values (?, ?)", [
        "book-1",
        "Original",
      ]);
      await transaction.run(
        `insert into sync_meta (
          table_name, record_id, hlc_wall_time, hlc_counter, device_id, is_deleted
        ) values (?, ?, ?, ?, ?, ?)`,
        ["books", "book-1", 100, 0, "device-a", 0],
      );
    });

    await expect(
      driver.transaction(async (transaction) => {
        await transaction.run("update books set title = ? where id = ?", [
          "Should roll back",
          "book-1",
        ]);
        await transaction.run(
          `update sync_meta
           set hlc_wall_time = ?, is_deleted = ?
           where table_name = ? and record_id = ?`,
          [200, 1, "books", "book-1"],
        );
        throw new Error("reject remote batch");
      }),
    ).rejects.toThrow("reject remote batch");

    expect(
      await driver.all<BookRow>("select id, title from books", []),
    ).toEqual([{ id: "book-1", title: "Original" }]);
    expect(
      await driver.all<SyncMetaRow>(
        `select record_id, hlc_wall_time, hlc_counter, device_id, is_deleted
         from sync_meta`,
        [],
      ),
    ).toEqual([
      {
        record_id: "book-1",
        hlc_wall_time: 100,
        hlc_counter: 0,
        device_id: "device-a",
        is_deleted: 0,
      },
    ]);
  });
});

async function createBooksTable(driver: BunSqliteTestDriver): Promise<void> {
  await driver.run(
    "create table books (id text primary key, title text not null)",
    [],
  );
}

async function createSyncMetaTable(driver: BunSqliteTestDriver): Promise<void> {
  await driver.run(
    `create table sync_meta (
      table_name text not null,
      record_id text not null,
      hlc_wall_time integer not null,
      hlc_counter integer not null,
      device_id text not null,
      is_deleted integer not null,
      primary key (table_name, record_id)
    )`,
    [],
  );
}

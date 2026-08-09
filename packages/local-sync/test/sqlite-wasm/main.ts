import {
  createSqliteWasmDriver,
  type SqliteWasmDriver,
} from "../../dist/adapters/sqlite-wasm/index.js";
import {
  createSqliteSyncClient,
  SqliteHlcStateStorage,
} from "../../dist/adapters/sqlite/index.js";
import { createHybridLogicalClock } from "../../dist/client/index.js";
import {
  defineSyncSchema,
  syncedTable,
  text,
} from "../../dist/schema/index.js";

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

export type SqliteWasmProofResult =
  | { readonly status: "running" }
  | {
      readonly status: "passed";
      readonly sqliteVersion: string;
      readonly storage: "opfs";
      readonly persistedBooks: number;
      readonly persistedHlcCounter: number;
      readonly pendingChanges: number;
      readonly remoteApplied: number;
      readonly lwwWinners: readonly string[];
    }
  | {
      readonly status: "failed";
      readonly message: string;
      readonly stack: string;
    };

declare global {
  interface Window {
    __sqliteWasmProof: SqliteWasmProofResult;
  }
}

window.__sqliteWasmProof = { status: "running" };

void runProof().then(
  (result) => publish(result),
  (error) => {
    const cause = error instanceof Error ? error : new Error(String(error));
    publish({
      status: "failed",
      message: cause.message,
      stack: cause.stack ?? "",
    });
  },
);

async function runProof(): Promise<SqliteWasmProofResult> {
  assert(crossOriginIsolated, "Browser context must be cross-origin isolated");

  const filename = `/local-sync-${crypto.randomUUID()}.sqlite3`;
  let driver = await createSqliteWasmDriver({ filename, storage: "opfs" });

  try {
    assert(driver.storage === "opfs", "Driver did not open OPFS storage");
    await createTables(driver);

    const inserted = await driver.run(
      "insert into books (id, title) values (?, ?), (?, ?)",
      ["book-1", "First", "book-2", "Second"],
    );
    assert(
      inserted.rowsAffected === 2,
      "Multi-row insert affected wrong count",
    );

    const selected = await driver.all<BookRow>(
      "select id, title from books where id = ?",
      ["book-2"],
    );
    assert(
      selected.length === 1 && selected[0]?.title === "Second",
      "Parameterized read returned the wrong row",
    );

    const lwwWinners = await verifyLwwReturning(driver);
    await verifyTransactions(driver);
    const clock = createHybridLogicalClock({
      deviceId: "device-browser",
      stateStorage: new SqliteHlcStateStorage(driver),
      now: () => 100,
    });
    await clock.tickMany(2);
    const { pendingChanges, remoteApplied } = await verifySyncClient(driver);

    const versionRows = await driver.all<{ version: string }>(
      "select sqlite_version() as version",
      [],
    );
    const sqliteVersion = versionRows[0]?.version;
    assert(sqliteVersion !== undefined, "SQLite version query returned no row");

    await driver.close();
    driver = await createSqliteWasmDriver({ filename, storage: "opfs" });

    const persistedRows = await driver.all<{ count: number }>(
      "select count(*) as count from books",
      [],
    );
    const persistedBooks = persistedRows[0]?.count;
    assert(persistedBooks === 3, "OPFS rows did not survive worker restart");
    const restartedClock = createHybridLogicalClock({
      deviceId: "device-browser",
      stateStorage: new SqliteHlcStateStorage(driver),
      now: () => 50,
    });
    const persistedHlc = await restartedClock.tick();
    assert(
      persistedHlc.wallTimeMs === 100 && persistedHlc.counter === 2,
      "HLC state did not survive worker restart",
    );

    return {
      status: "passed",
      sqliteVersion,
      storage: "opfs",
      persistedBooks,
      persistedHlcCounter: persistedHlc.counter,
      pendingChanges,
      remoteApplied,
      lwwWinners,
    };
  } finally {
    await driver.close();
  }
}

async function verifyLwwReturning(
  driver: SqliteWasmDriver,
): Promise<readonly string[]> {
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
  const winnerIds = winners.map(({ record_id }) => record_id).sort();
  assert(
    JSON.stringify(winnerIds) === JSON.stringify(["book-2", "book-3"]),
    "LWW UPSERT returned the wrong winners",
  );
  return winnerIds;
}

async function verifyTransactions(driver: SqliteWasmDriver): Promise<void> {
  await driver.transaction(async (transaction) => {
    await transaction.run("insert into books (id, title) values (?, ?)", [
      "book-3",
      "Committed",
    ]);
    await transaction.run(
      `insert into sync_meta (
        table_name, record_id, hlc_wall_time, hlc_counter, device_id, is_deleted
      ) values (?, ?, ?, ?, ?, ?)`,
      ["books", "book-4", 100, 0, "device-a", 0],
    );
  });

  let rejected = false;
  try {
    await driver.transaction(async (transaction) => {
      await transaction.run("update books set title = ? where id = ?", [
        "Should roll back",
        "book-1",
      ]);
      await Promise.resolve();
      await transaction.run(
        `update sync_meta
         set hlc_wall_time = ?, is_deleted = ?
         where table_name = ? and record_id = ?`,
        [300, 1, "books", "book-1"],
      );
      throw new Error("reject browser transaction");
    });
  } catch (error) {
    rejected =
      error instanceof Error && error.message === "reject browser transaction";
  }
  assert(rejected, "Rejected transaction did not preserve its error");

  const books = await driver.all<BookRow>(
    "select id, title from books where id = ?",
    ["book-1"],
  );
  const metadata = await driver.all<SyncMetaRow>(
    `select record_id, hlc_wall_time, hlc_counter, device_id, is_deleted
     from sync_meta
     where table_name = ? and record_id = ?`,
    ["books", "book-1"],
  );
  assert(books[0]?.title === "First", "Domain row escaped rollback");
  assert(
    metadata[0]?.hlc_wall_time === 200 && metadata[0]?.is_deleted === 0,
    "Sidecar row escaped rollback",
  );

  let markTransactionStarted = (): void => undefined;
  const transactionStarted = new Promise<void>((resolve) => {
    markTransactionStarted = resolve;
  });
  const transaction = driver.transaction(async (executor) => {
    await executor.run("insert into write_order (label) values (?)", [
      "transaction-before",
    ]);
    markTransactionStarted();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await executor.run("insert into write_order (label) values (?)", [
      "transaction-after",
    ]);
  });

  await transactionStarted;
  const outsideWrite = driver.run(
    "insert into write_order (label) values (?)",
    ["outside"],
  );
  await Promise.all([transaction, outsideWrite]);

  const writeOrder = await driver.all<{ label: string }>(
    "select label from write_order order by position",
    [],
  );
  assert(
    JSON.stringify(writeOrder.map(({ label }) => label)) ===
      JSON.stringify(["transaction-before", "transaction-after", "outside"]),
    "An outside write interleaved with the worker transaction",
  );
}

async function verifySyncClient(driver: SqliteWasmDriver): Promise<{
  readonly pendingChanges: number;
  readonly remoteApplied: number;
}> {
  const schema = defineSyncSchema({
    client_books: syncedTable({
      id: text().primaryKey(),
      title: text().notNull(),
    }),
  });
  const clock = createHybridLogicalClock({
    deviceId: "device-sync-client",
    stateStorage: new SqliteHlcStateStorage(driver),
    now: () => 200,
  });
  const client = createSqliteSyncClient({ schema, driver, clock });

  const written = await client.putMany("client_books", [
    { id: "client-book-1", title: "First" },
    { id: "client-book-2", title: "Second" },
  ]);
  assert(
    written[0]?.hlc.counter === 0 && written[1]?.hlc.counter === 1,
    "Sync client did not allocate unique batch HLCs",
  );
  await client.delete("client_books", "client-book-2");

  const pending = await client.getPendingChanges();
  const deleted = pending.find(
    ({ tableName, recordId }) =>
      tableName === "client_books" && recordId === "client-book-2",
  );
  assert(
    pending.filter(({ tableName }) => tableName === "client_books").length ===
      2,
    "Sync client did not materialize pending rows",
  );
  assert(
    deleted?.operation === "delete" && deleted.payload.title === "Second",
    "Sync client did not retain deleted payload",
  );
  const pendingChanges = pending.filter(
    ({ tableName }) => tableName === "client_books",
  ).length;

  const first = written[0];
  assert(
    first !== undefined,
    "Sync client did not return its first local write",
  );
  await client.reconcilePushOutcomes([
    { accepted: true, record: { ...first, serverSeq: 1 } },
  ]);
  const remote = await client.applyRemote(
    [
      {
        tableName: "client_books",
        recordId: "client-book-2",
        operation: "put",
        payload: { id: "client-book-2", title: "Remote restored" },
        hlc: { wallTimeMs: 300, counter: 0 },
        deviceId: "device-remote",
        schemaVersion: 1,
        serverSeq: 2,
      },
    ],
    { cursor: 2 },
  );
  const restored = await driver.all<{ title: string }>(
    "select title from client_books where id = ?",
    ["client-book-2"],
  );
  assert(
    remote.appliedRecordCount === 1 &&
      restored[0]?.title === "Remote restored" &&
      (await client.getCursor()) === 2,
    "Sync client did not apply and persist the remote winner",
  );
  assert(
    (await client.getPendingChanges()).length === 0,
    "Sync client did not clear acknowledged remote state",
  );

  return { pendingChanges, remoteApplied: remote.appliedRecordCount };
}

async function createTables(driver: SqliteWasmDriver): Promise<void> {
  await driver.run(
    "create table books (id text primary key, title text not null)",
    [],
  );
  await driver.run(
    `create table sync_meta (
      table_name text not null,
      record_id text not null,
      hlc_wall_time integer not null,
      hlc_counter integer not null,
      device_id text not null,
      last_server_seq integer not null default 0,
      dirty integer not null default 0,
      is_deleted integer not null default 0,
      primary key (table_name, record_id)
    )`,
    [],
  );
  await driver.run(
    "create table client_books (id text primary key, title text not null)",
    [],
  );
  await driver.run(
    `create table sync_cursors (
      cursor_key text primary key,
      server_seq integer not null
    )`,
    [],
  );
  await driver.run(
    `create table write_order (
      position integer primary key autoincrement,
      label text not null
    )`,
    [],
  );
  await driver.run(
    `create table sync_hlc_state (
      device_id text primary key,
      wall_time_ms integer not null,
      counter integer not null
    )`,
    [],
  );
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function publish(result: SqliteWasmProofResult): void {
  window.__sqliteWasmProof = result;
  const output = document.querySelector("#result");
  if (output !== null) {
    output.textContent = JSON.stringify(result, null, 2);
  }
}

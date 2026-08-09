# @zsh-eng/local-sync

Storage-agnostic building blocks for local-first applications.

Performance baselines and the planned SQLite-versus-IndexedDB fresh-sync
methodology are recorded in [BENCHMARKS.md](./BENCHMARKS.md).

This package is being built incrementally inside the EPUB reader monorepo. It
currently contains the schema definition language, storage-neutral data
contracts, and a durable client hybrid logical clock. It can also initialize
the corresponding local SQLite tables and sync sidecars.

```ts
import {
  defineSyncSchema,
  integer,
  jsonText,
  real,
  syncedTable,
  text,
  type InferTableRow,
} from "@zsh-eng/local-sync/schema";

const schema = defineSyncSchema({
  books: syncedTable({
    id: text().primaryKey(),
    title: text().notNull(),
    author: text().notNull().index(),
    pageCount: integer(),
    rating: real(),
    metadata: jsonText(),
  }),
});

type Book = InferTableRow<(typeof schema.tables)["books"]>;
```

`integer()` and `real()` infer `number`; `jsonText()` is JSON-validated SQLite
text and therefore infers `string`. The package does not claim that native
SQLite reads decode JSON objects. All columns are nullable until `.notNull()` or
`.primaryKey()` is applied.

Use `table()` for local-only data and `syncedTable()` for synchronized rows. A
synced table must have a non-null text primary key; the package derives that
column as `recordId` and uses whole-row `lww`. An optional `scopeId` must name a
non-null text column. Payload `schemaVersion` defaults to `1` and can be
overridden independently of the local SQLite migration number.

The core package distinguishes local records from server-sequenced records:

```ts
import type { SequencedSyncRecord, SyncRecord } from "@zsh-eng/local-sync/core";

const localChange: SyncRecord<Book> = {
  tableName: "books",
  recordId: "book-1",
  operation: "put",
  payload: {
    id: "book-1",
    title: "Example",
    author: "A. Reader",
    pageCount: null,
    rating: null,
    metadata: null,
  },
  hlc: { wallTimeMs: 1_722_732_000_000, counter: 0 },
  deviceId: "device-1",
  schemaVersion: 1,
};

declare const remoteChange: SequencedSyncRecord<Book>;
remoteChange.serverSeq;
```

The client assigns the structured HLC `{ wallTimeMs, counter }` before syncing.
Its logical counter preserves local ordering when physical time does not advance
or moves backwards. `deviceId` is stored once as a separate field and is the
final deterministic tie-breaker. The server separately assigns `serverSeq` only
after accepting a version into its catch-up stream.

Create the client clock with injected state storage and, optionally, a physical
clock for tests:

```ts
import { createHybridLogicalClock } from "@zsh-eng/local-sync/client";
import {
  initializeSqliteSchema,
  SqliteHlcStateStorage,
} from "@zsh-eng/local-sync/adapters/sqlite";

await initializeSqliteSchema(driver, schema);

const clock = createHybridLogicalClock({
  deviceId: "device-1",
  stateStorage: new SqliteHlcStateStorage(driver),
});

const localTimestamp = await clock.tick();
const importedTimestamps = await clock.tickMany(100);
await clock.observe(remoteChange.hlc);
```

`tick()` persists a timestamp before returning it. `observe()` applies the HLC
receive rule so a later local write is causally after an observed remote event.
`tickMany(count)` reserves consecutive logical counters in one state
transaction and returns one distinct timestamp per row; only the final counter
must be persisted.
SQLite stores one clock row per device in `sync_hlc_state` and serializes
updates through a transaction. Advancing the clock and then crashing before the
corresponding domain write can leave a harmless unused timestamp; it cannot
cause the clock to move backwards after restart.

Use the SQLite sync client for explicit synchronized writes:

```ts
import { createSqliteSyncClient } from "@zsh-eng/local-sync/adapters/sqlite";

const sync = createSqliteSyncClient({ schema, driver, clock });

await sync.put("books", book);
await sync.putMany("books", importedBooks);
await sync.delete("books", book.id);

const pending = await sync.getPendingChanges({ limit: 500 });

const pushResult = await transport.push(pending);
await sync.reconcilePushOutcomes(pushResult.outcomes);

const cursor = await sync.getCursor();
const pulled = await transport.pull({ cursor });
const applied = await sync.applyRemote(pulled.records, {
  cursor: pulled.cursor,
});
```

The table name controls the row type and local-only tables are rejected at
compile time. Writes validate complete rows against schema metadata, allocate a
distinct HLC per row, and atomically update the domain table with `sync_meta`.
`putMany()` and `deleteMany()` use one domain transaction and one HLC range.
Delete keeps the domain payload and marks its metadata as a dirty tombstone.

`getPendingChanges()` returns the latest dirty state rather than a history of
every local edit. It reconstructs canonical payloads from retained domain rows,
including deleted rows, in deterministic table-and-record order.

`reconcilePushOutcomes()` accepts the outcomes returned by `SyncServer.push()`.
The returned winner drives reconciliation: an equal version clears that exact
pending write, a newer server version replaces local state, and an older server
version leaves a newer in-flight local edit dirty. The outcome's `accepted` flag
remains useful for observability but is not sufficient to make those local
decisions.

`applyRemote()` validates a pull page, advances the client HLC past its greatest
observed timestamp, and applies strict LWW winners. Passing the page cursor
commits domain rows, tombstones, `sync_meta`, and the cursor in one SQLite
transaction. Its `affected` result contains deduplicated table/scope targets for
query invalidation, including both old and new scopes when a row moves. The
default cursor key is `"app"`; `getCursor()` and `setCursor()` also accept named
cursors for future filtered sync flows. Cursors only move forward.

Ordinary SQL writes intentionally bypass sync tracking; synchronized mutations
must use this client. Reads remain ordinary SQLite queries. Until filtered views
or generated query helpers are added, normal reads must join `sync_meta` and
exclude `is_deleted = 1` themselves.

Deletes use `operation: "delete"` and retain the complete domain payload. Both
client and server keep the materialized row so a future write can restore it;
normal local queries hide it using the accompanying tombstone metadata. Blob
bytes still stay outside sync records, and payloads can refer to them with
`BlobRef` from the `/blob` entrypoint.

These interfaces describe semantic records, not a required JSON encoding. An
HTTP transport may infer the user and app from request context, group records by
table, and compress batches without changing the core model.

The framework-neutral server coordinator operates on a generic latest-state bag
of rows:

```ts
import { SyncServer } from "@zsh-eng/local-sync/server";
import { InMemoryServerSyncStorage } from "@zsh-eng/local-sync/server/testing";

const server = new SyncServer<Book>(new InMemoryServerSyncStorage<Book>());

const pushed = await server.push({
  appName: "ebook-reader",
  userId: "user-1",
  deviceId: "device-1",
  records: [localChange],
});

const page = await server.pull({
  appName: "ebook-reader",
  userId: "user-1",
  cursor: 0,
});
```

The in-memory implementation is test support. A production adapter implements
`ServerSyncStorage`: it atomically applies LWW per logical row, assigns a new
global `serverSeq` only to accepted writes, and scans rows in sequence order.
Every push outcome returns the current winner, including when an older candidate
is rejected. Pulls support whole-app, table, and table-plus-scope cursors and do
not exclude records written by the requesting device.

Cloudflare Workers can use the production D1 adapter:

```ts
import { D1ServerSyncStorage } from "@zsh-eng/local-sync/adapters/d1";
import { SyncServer } from "@zsh-eng/local-sync/server";

const storage = new D1ServerSyncStorage<Book>(env.DATABASE);
const server = new SyncServer<Book>(storage);
```

The package ships `migrations/d1/0000_create_local_sync_rows.sql` as a migration
template rather than installing migrations programmatically. Copy it into the
application's Wrangler migration directory using the application's next
migration number, then apply migrations normally before constructing the
adapter. This works for an existing database: the migration adds
`local_sync_rows` alongside existing application and auth tables. Moving legacy
sync data into the new table is a separate application cutover step.

The template deliberately does not reference an auth table. The package cannot
assume that auth shares the sync database or that every host uses the same user
schema. A server transport must derive `userId` from its authenticated request
context; a foreign key does not replace that authorization boundary. A host
that keeps auth and sync in the same database may customize the copied migration
before first applying it, for example with a `REFERENCES user(id) ON DELETE
RESTRICT` constraint. `RESTRICT` keeps account deletion from silently cascading
through retained sync rows; an explicit account-deletion flow can purge sync
rows and blob storage first. Adding a foreign key after the table exists requires
a SQLite table-rebuild migration.

The migration creates the generic latest-state table and its logical-key,
whole-app, table, and scope cursor indexes. Pushes are limited to 1 MiB of
encoded JSON by default; `D1SyncBatchTooLargeError` lets a future HTTP transport
return a clear request-size response. The adapter does not register routes or
depend on Hono.

Storage adapters use a deliberately small asynchronous SQLite boundary:

```ts
import type { SqlDriver } from "@zsh-eng/local-sync/adapters/sqlite";

async function findBook(driver: SqlDriver, id: string) {
  const rows = await driver.all<Book>(
    "select id, title, author from books where id = ?",
    [id],
  );
  return rows[0];
}

await driver.transaction(async (transaction) => {
  await transaction.run("update books set title = ? where id = ?", [
    "Updated",
    "book-1",
  ]);
});
```

Tests can use `FakeSqlDriver` from `/adapters/sqlite/testing` to queue results
and inspect issued statements without depending on a SQLite runtime. The fake
does not parse SQL or emulate database behavior. A separate Bun-only conformance
test exercises this interface against real in-memory SQLite, including
multi-row LWW UPSERT and atomic domain/sidecar transactions; its driver remains
test support rather than a package export.

Web apps can open the published sqlite-wasm adapter:

```ts
import { createSqliteWasmDriver } from "@zsh-eng/local-sync/adapters/sqlite-wasm";

const db = await createSqliteWasmDriver({
  filename: "/ebook-reader.sqlite3",
});
```

The adapter runs SQLite in a dedicated module worker and uses durable OPFS
storage by default. It does not silently fall back to memory when OPFS is
unavailable. Hosts must send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`; call `db.close()` when the app no
longer needs the worker.

Initialize app tables and the shared `sync_meta` and `sync_cursors` sidecars
from the same schema:

```ts
import {
  generateSqliteSchema,
  initializeSqliteSchema,
} from "@zsh-eng/local-sync/adapters/sqlite";

const statements = generateSqliteSchema(schema);
await initializeSqliteSchema(db, schema);
```

`generateSqliteSchema()` returns frozen, inspectable SQL statements. Declared
table and column names are quoted and preserved exactly; there is no implicit
camelCase-to-snake_case conversion. `initializeSqliteSchema()` executes those
statements in one transaction and can be called repeatedly for initialization.
It uses `CREATE ... IF NOT EXISTS`, so it does not migrate an existing table
when a schema definition changes. Applications may use this on each database
open while prototyping. Before a production schema evolves, the generated
initial statements should be frozen as migration 1 and startup should move to
ordered, checked-in migrations tracked by a local migration table. The migration
history and database-side checksums are the initial source of truth; a separate
schema lockfile is only needed later if migration generation becomes automatic.

The package does not intercept raw SQL writes, implement an HTTP transport,
perform client sync orchestration, or manage blob transfers. Those capabilities
will be added as separate, reviewable changes.

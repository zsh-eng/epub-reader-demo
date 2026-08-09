# Sync Architecture and DX RFC

This document records the proposed sync developer experience and the current
epub-reader-demo sync infrastructure. The current proposal is SQLite-first and
does not require Drizzle or Dexie in the sync core.

---

## RFC: SQLite-First Sync DX

**Status**: Draft

**Date**: 2026-07-07

**Goal**: define a small, explicit developer experience for local-first personal
apps that need whole-app bootstrap catch-up, incremental sync, offline reads,
tombstones, and portable local storage across web and Expo/native clients.

### Design Principles

1. **Local reads should be ordinary database reads.**
   The app should query local materialized tables directly through typed helpers
   or a local SQL driver. Reads should not require network access or a sync
   service call.

2. **Local writes must go through sync-aware APIs.**
   The sync layer should own HLC generation, dirty metadata, tombstones, and
   pending push state. We should not rely on storage mutation detection to infer
   whether a write is local or remote.

3. **Remote apply must be explicit.**
   Applying server records should use a separate path from local user writes, so
   batching and conflict handling are predictable.

4. **Bootstrap catch-up should be whole-app by default.**
   A fresh device should pull all non-blob records for an app from cursor `0`,
   then continue with incremental cursor-based catch-up. Lazy network fetch on
   view should not be the primary model.

5. **The server should store sync records as a generic bag of rows.**
   The server should not need an app-specific migration for every client-side
   table. It should index sync records by app, user, table, optional scope, and
   cursor order.

6. **Files and blobs are separate from metadata sync.**
   EPUB files, covers, and extracted reader caches should stay content-addressed
   or local-only rather than being embedded into sync rows.

7. **Stay SQL-first at the storage boundary.**
   The schema DSL exists to derive types, table metadata, and predictable SQL.
   Generated queries and any future migration format should stay close to
   ordinary SQL so changes are easy to inspect.

### Non-Goals

- Real-time multi-user collaboration.
- Field-level merge or CRDT support.
- Tombstone garbage collection in the first version.
- A general-purpose ORM.
- Replacing React Query for UI cache management.
- Supporting every browser storage backend in the first implementation.
- A general Dexie-to-SQLite client migration path for the existing app.

### Proposed Application DX

Application code defines a schema once:

```ts
export const schema = defineSyncSchema({
  books: syncedTable({
    id: text().primaryKey(),
    fileHash: text().notNull().unique(),
    title: text().notNull(),
    author: text().notNull(),
    fileSize: integer().notNull(),
    dateAdded: integer().notNull(),
    lastOpened: integer(),
    coverContentHash: text(),
    metadata: jsonText(),
  }),

  highlights: syncedTable(
    {
      id: text().primaryKey(),
      bookId: text().notNull().index(),
      spineItemId: text().notNull().index(),
      text: text().notNull(),
      color: text().notNull(),
      createdAt: integer().notNull(),
      updatedAt: integer(),
    },
    {
      scopeId: "bookId",
    },
  ),

  readingCheckpoints: syncedTable(
    {
      id: text().primaryKey(),
      bookId: text().notNull().index(),
      deviceId: text().notNull().index(),
      currentSpineIndex: integer().notNull(),
      scrollProgress: real().notNull(),
      lastRead: integer().notNull(),
    },
    {
      scopeId: "bookId",
    },
  ),
});
```

The schema should generate or derive:

- local `CREATE TABLE` SQL
- local indexes
- TypeScript row types
- sync table metadata
- payload serializers and parsers
- typed query helper stubs
- optional migration metadata later

The generated output should be boring and reviewable. The sync package should
not hide complex behavior in an opaque runtime.

The first schema DSL should support a deliberately small subset:

- `text`, `integer`, `real`, and JSON-validated `text`
- primary keys
- required and nullable fields
- single-column indexes
- single-column unique indexes
- separate `table()` and `syncedTable()` declarations
- optional synced-table `scopeId` and payload `schemaVersion`

`table()` declares local-only data. `syncedTable()` requires a non-null text
primary key and derives it as `recordId`; normalized metadata fixes conflict
handling to whole-row `lww` and defaults payload `schemaVersion` to `1`.
`jsonText()` deliberately infers a string because reads go through native SQLite
and no query codec exists yet. Integer primary keys remain available for
local-only tables. A configured scope is a non-null text field used for pull
partitioning, not a relational foreign key.

Compound indexes, foreign keys, custom constraints, generated columns, and raw
SQL schema extensions should wait until a concrete app query needs them.

### Local Query DX

Reads should use typed local helpers over SQLite:

```ts
const book = await db.books.get(bookId);
const highlights = await db.highlights.listByBook(bookId);
const checkpoint = await db.readingCheckpoints.getByBookAndDevice(
  bookId,
  deviceId,
);
```

These helpers should compile down to straightforward SQL:

```sql
select * from highlights
where book_id = ?
order by created_at;
```

The first version should not expose a raw SQL escape hatch through the sync
library. The app can still own internal SQL helpers, but the package DX should
start with generated or handwritten typed helpers for known query patterns.

### Local Write DX

Writes should be sync-aware and explicit:

```ts
await sync.books.put(book);
await sync.highlights.put(highlight);
await sync.highlights.delete(highlightId);

await sync.transaction(async (tx) => {
  await tx.highlights.put(highlight);
  await tx.notes.put(note);
});
```

A local write should update the domain table and sync metadata in the same local
transaction. A delete should leave the domain row and its payload in place,
mark its sidecar metadata as deleted, and make normal query helpers hide it.

### Remote Apply DX

Remote sync should use a separate code path:

```ts
const batch = await transport.pullApp({ appName: "ebook-reader", since });
const applied = await sync.applyRemote(batch.records);
await sync.setCursor(batch.cursor);
```

`applyRemote` should:

- validate the incoming table and payload
- compare HLCs per `{ tableName, recordId }`
- update local materialized rows, including retained delete payloads, when the
  remote record wins
- update local sync metadata
- record affected tables and scopes for cache invalidation
- advance the local HLC service after receiving remote HLCs

### React Query DX

React Query should remain the UI cache layer:

```ts
export function useBookHighlights(bookId: string) {
  return useQuery({
    queryKey: ["highlights", bookId],
    queryFn: () => db.highlights.listByBook(bookId),
  });
}

export function useAddHighlight(bookId: string) {
  return useSyncedMutation({
    mutationFn: (highlight: NewHighlight) => sync.highlights.put(highlight),
    invalidate: [["highlights", bookId]],
  });
}
```

After `applyRemote`, the sync layer should return affected table/scope pairs so
the app or React binding can invalidate the correct queries.

### Local Storage Model

The first implementation should be SQLite-first. Each app table should be a real
local table because ebook-reader, flashcards, and budgeting-style apps benefit
from normal indexed queries.

Sync metadata should live in sidecar tables:

```sql
create table sync_meta (
  table_name text not null,
  record_id text not null,
  hlc_wall_time integer not null,
  hlc_counter integer not null,
  device_id text not null,
  last_server_seq integer not null default 0,
  dirty integer not null default 0,
  is_deleted integer not null default 0,
  primary key (table_name, record_id)
);

create table sync_cursors (
  cursor_key text primary key,
  server_seq integer not null
);
```

`generateSqliteSchema(schema)` now emits the app tables, declared single-column
indexes, and these shared sidecars. `initializeSqliteSchema(driver, schema)`
executes the statements in one transaction. Identifiers remain exactly as
declared in the schema and are quoted for SQLite; the first version does not
perform an implicit naming conversion.

The generated statements use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF
NOT EXISTS`. This makes fresh-database initialization idempotent, but it is not
a migration mechanism: changing a schema definition does not alter an existing
table. During package development, applications can call the initializer each
time they open the database.

Before the first production cutover, the local database will gain an ordered
migration runner and a package-owned table such as:

```sql
create table local_sync_migrations (
  version integer primary key,
  name text not null,
  checksum text not null
);
```

Migration 1 will contain a checked-in, immutable copy of the generated initial
schema. Later schema changes will add checked-in SQL migrations rather than
changing old migrations. On database open, the runner will begin an immediate
transaction, read the applied versions, verify their checksums, apply missing
migrations in order, record them, and commit. Fresh databases and upgraded
databases will therefore follow the same migration history.

The migration files and `local_sync_migrations` rows are sufficient as the
initial source of truth; a separate schema lockfile is not required. A generated
schema snapshot can be added later if tooling begins diffing the schema DSL and
generating migrations automatically. Local SQLite migration versions remain
separate from `SyncRecord.schemaVersion`, which describes synced payload
compatibility rather than physical database layout.

Keeping sync metadata in sidecar tables keeps domain tables readable and makes
query helper code easier to review. Normal generated queries should join or
exclude `sync_meta.is_deleted = 1`; administrative and restore flows can read
those retained rows explicitly.

The core record carries HLC as a structured `{ wallTimeMs, counter }` value, and
the local sidecar stores those numbers as integer columns. The client storage
adapter maps fields to columns directly; there is no HLC string parsing or
encoding boundary.

`last_server_seq` is the last server sequence known for this local record
version. It is `0` for a new local record that has never been accepted by the
server. If a previously synced record is edited locally, `dirty` becomes `1` and
`last_server_seq` remains the previous acknowledged sequence until the server
accepts the new version.

`dirty` is local-only state. `dirty = 1` means this device has a local write that
still needs to be pushed. Remote apply should write `dirty = 0`. Successful push
acknowledgement should update `last_server_seq` and set `dirty = 0`.

`sync_cursors.server_seq` uses `0` to mean "this scope has never synced." It is
not per-record state; it tracks app-level or table-level catch-up progress.

### Server Storage Model

The shared core model distinguishes unsequenced client records from records the
server has accepted into its ordered change stream. The server stores the latter
with the authenticated namespace:

```ts
type ServerSyncRecord = SequencedSyncRecord & {
  appName: string;
  userId: string;
};
```

`SyncRecord` is a discriminated union. Both `operation: "put"` and
`operation: "delete"` carry the complete domain payload. The server adapter may
represent the operation as `is_deleted` alongside the payload internally, but
it should not remove payload fields when a row becomes a tombstone.

The new package carries HLC as `{ wallTimeMs, counter }` and keeps `deviceId`
separate. LWW compares the two numeric HLC components first, then `deviceId` as
a deterministic tie-breaker. Encoded HLC strings are not part of the new
contract. `compareSyncVersions()` is the shared implementation of this ordering.
Device IDs are restricted to NanoID/UUID-compatible ASCII letters, digits,
underscores, and hyphens so JavaScript and SQLite use the same lexical ordering.

Put payloads should use canonical schema field names, not local SQLite column
names. For example, the payload should use `bookId`, not `book_id`.

Preferred option:

- Domain/schema field names are the sync payload format.
- SQLite column names are local storage details.
- Serializers map between payload fields and local columns.

Tradeoffs:

- Canonical field names keep the wire format stable across SQLite, Expo,
  sqlite-wasm, and future storage adapters.
- Canonical field names match TypeScript app types and are easier to inspect in
  server JSON.
- Column names would make local SQL dumps simpler, but they leak one storage
  backend's naming convention into the server protocol and make future storage
  changes harder.

Recommended indexes:

```sql
unique (app_name, user_id, table_name, record_id)
(app_name, user_id, server_seq)
(app_name, user_id, table_name, server_seq)
(app_name, user_id, table_name, scope_id, server_seq)
```

The storage adapter must support three ordered pull shapes:

```sql
-- Whole-app bootstrap or catch-up
where app_name = ? and user_id = ? and server_seq > ?
order by server_seq
limit ?

-- One table
where app_name = ? and user_id = ?
  and table_name = ? and server_seq > ?
order by server_seq
limit ?

-- One scope within one table
where app_name = ? and user_id = ?
  and table_name = ? and scope_id = ? and server_seq > ?
order by server_seq
limit ?
```

The logical-key index also supports fetching the current winners after a push.
`SyncServer.pull()` requests one lookahead row, returns at most the caller's
limit, and advances the cursor to the last returned sequence. Whole-app, table,
and scoped streams therefore keep separate cursors.

`serverSeq` is a monotonic sequence for the physical server sync store.
Clients can store cursors with gaps. Gaps are acceptable because each client
only cares that future pulls ask for records where `serverSeq > localCursor`.

`SyncServer` now provides the framework-neutral push and pull behavior. It
validates namespaces, device ownership, batch/page limits, duplicate logical
keys, schema versions, and structured HLC values. By default it rejects HLC wall
times more than five minutes ahead of the server clock; adapters can configure
that policy and inject a clock for tests.

The `ServerSyncStorage` boundary has two semantic operations:

- `applyLww(namespace, records)` atomically chooses the winner for each logical
  row and assigns a fresh global sequence only when the candidate wins.
- `scan(query)` returns latest-state rows after a cursor in ascending sequence
  order, with optional table and scope filters.

Push outcomes always include the current winning record and its `serverSeq`.
`accepted: false` means the candidate did not create a new stream position; the
returned winner lets clients reconcile rejected writes and idempotent retries.
The in-memory adapter under `/server/testing` is the executable reference for
these semantics, not a production store.

The server does not have the client's two-table atomicity problem because the
payload, HLC, device ID, tombstone state, and sequence live in the same generic
row. An adapter must make each LWW decision and sequence assignment atomic, but
the whole push batch need not be all-or-nothing. If an adapter fails after a
partial batch, the client can retry and receive the winners already stored.

The D1 conformance spike proves a one-table implementation with `server_seq
integer primary key autoincrement` and a unique logical-key index. A winning
conflict copies the candidate's generated `excluded.server_seq` into the stored
row in the same UPSERT that replaces its payload and metadata. A rejected
candidate returns no row and leaves the current winner's visible sequence
unchanged.

`excluded` is the statement-local proposed row: the values SQLite would have
inserted if the logical-key conflict had not occurred. Defaults are already
present on that row, so D1 exposes the attempted `AUTOINCREMENT` value as
`excluded.server_seq`. The conflict clause can compare the proposed and stored
HLCs and copy that sequence only when the proposed row wins. Sequence allocation
therefore needs neither a separate counter table nor an application-managed
reservation transaction.

This pattern comes from PostgreSQL, whose `ON CONFLICT DO UPDATE` also exposes a
special `excluded` row and guarantees an atomic insert-or-update outcome.
SQLite explicitly follows PostgreSQL's UPSERT syntax. It is not standard SQL:
MySQL provides the same proposed-row idea through a row alias in `ON DUPLICATE
KEY UPDATE`, and other databases use different UPSERT or `MERGE` forms. The
concept is portable, but the eventual storage adapter should own the dialect.
See the official [PostgreSQL `INSERT` documentation](https://www.postgresql.org/docs/current/sql-insert.html),
[SQLite UPSERT documentation](https://sqlite.org/lang_upsert.html), and
[MySQL `ON DUPLICATE KEY UPDATE` documentation](https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html).

The adapter must not reserve a sequence range in one committed transaction and
publish those rows in a later transaction. For example, if writer A reserves
101-110, writer B reserves and commits 111-120, and a client advances to 120,
writer A cannot later publish 101-110 without those rows being skipped forever.
The proven UPSERT avoids that race because D1 serializes writes and sequence
allocation becomes visible atomically with the winning row.

D1 currently limits one statement to 100 bound parameters. The chosen SQL
therefore binds the complete candidate array as one JSON string, expands it with
`json_each(?)`, and performs one `INSERT ... SELECT ... ON CONFLICT DO UPDATE
... RETURNING` statement. A second statement expands the same JSON value and
reads the current winner for every logical key. Both statements run in one
`D1Database.batch()`, which D1 executes sequentially as a transaction and rolls
back completely if either statement fails. This shape accepted 500 small records
in the local D1 runtime without generating a variable-length parameter list.
The transaction keeps the UPSERT and winner lookup together; it is not used to
reserve or assign sequence numbers in application code.

`RETURNING` includes only inserts and winning updates, and SQLite does not
promise its row order. Accepted keys and winner rows are therefore mapped by
`(table_name, record_id)` rather than array position. Rejected attempts still
advance SQLite's internal `AUTOINCREMENT` allocator, including idempotent
retries, but those unused values never appear as rows. Cursor correctness only
requires visible sequences to increase; gaps are expected.

The JSON batch must have a byte limit in addition to a record-count limit. D1's
current maximum string or row size is 2 MB, so the eventual HTTP adapter should
reject encoded batches comfortably below that boundary. Blob bytes remain
outside this table. See the official [D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
[SQLite UPSERT documentation](https://www.sqlite.org/lang_upsert.html), and
[SQLite RETURNING documentation](https://sqlite.org/lang_returning.html).

The winner lookup must iterate the `json_each` keys first and probe the unique
logical-key index for each one. SQLite otherwise preferred scanning the app's
sequence index and repeatedly scanning the JSON virtual table, which scaled
quadratically. The conformance suite pins the efficient query plan. An initial
server limit of 500 records and 1 MiB of encoded JSON, whichever comes first,
leaves margin below D1's 2 MB boundary; clients can split larger pushes without
changing sync semantics.

The conformance suite also runs `EXPLAIN QUERY PLAN` against D1 and confirms the
whole-app, table, and table-plus-scope pulls use their respective sequence
indexes. It runs inside Cloudflare's recommended [Workers Vitest
integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
with a local workerd/Miniflare D1 binding.

The production `D1ServerSyncStorage` now owns this SQL behind the
`/adapters/d1` package entrypoint. It accepts a structural subset of the D1
binding so importing the package's core or client adapters does not require
Cloudflare types. The package ships an immutable D1 migration for
`local_sync_rows` as a package-relative template. A host copies it into its own
Wrangler migration history using the next application migration number.
Integration tests append the package migration after the ebook migrations and
exercise the adapter through a real local D1 binding. This does not add Hono
routes, modify the ebook backend schema, or cut existing clients over to the new
protocol.

Migration adoption is intentionally documented rather than automated. The
template can be added to a fresh or existing D1 database; legacy sync-row
conversion remains a separate host cutover. It has no auth foreign key because
the package cannot assume an auth provider, parent-table name, shared database,
or account-deletion policy. The eventual HTTP layer must supply `userId` from
authenticated server context. A host that wants database-level referential
integrity can customize its copied migration before applying it. Prefer
`RESTRICT` over an implicit cascade while rows and tombstone payloads are
retained, then make permanent account deletion explicitly purge sync rows and
blob objects. Adding that constraint after table creation requires a SQLite
table-rebuild migration.

These are semantic record contracts, not a mandatory wire encoding. HTTP
transport can infer `userId` from authentication and `appName` from the route,
group records by table, and use ordinary response compression to avoid repeating
namespace fields. New pulls include records from the requesting device. This
keeps bootstrap correct when a device identity is reused and lets every cursor
advance over the same logical stream; transport-level echo suppression is not
part of the first version.

### Bootstrap and Incremental Sync

Bootstrap catch-up:

```ts
await sync.bootstrapApp();
```

Expected behavior:

1. Pull all non-blob sync records for `{ appName, userId }` from cursor `0`.
2. Apply records to local materialized tables.
3. Store the highest observed `serverSeq`.
4. Push any local records created before authentication completed.

Incremental catch-up:

```ts
await sync.pullApp();
await sync.pushPending();
```

Expected behavior:

1. Pull records after the local app cursor.
2. Apply them locally with HLC LWW.
3. Push pending local dirty records in batches.
4. Mark accepted local records clean and store their assigned server sequence in
   `last_server_seq`.

### Tombstones

The first implementation should preserve tombstones and their domain payloads
indefinitely on both clients and the server. Normal queries hide deleted rows,
while retaining them makes an explicit restore possible. A future cleanup job
or user-controlled retention policy is outside the first implementation.

Future tombstone garbage collection would require server-side device watermarks:

```ts
interface DeviceSyncWatermark {
  appName: string;
  userId: string;
  deviceId: string;
  lastSeenServerSeq: number;
  lastActiveAt: number;
}
```

This should not be required for the first implementation.

### SQLite Driver Contract

Storage-specific code should depend on three asynchronous operations:

```ts
interface SqlExecutor {
  run(sql: string, parameters: readonly SqlValue[]): Promise<SqlRunResult>;
  all<Row>(
    sql: string,
    parameters: readonly SqlValue[],
  ): Promise<readonly Row[]>;
}

interface SqlDriver extends SqlExecutor {
  transaction<Result>(
    work: (transaction: SqlExecutor) => Promise<Result>,
  ): Promise<Result>;
}
```

`run` covers DDL and writes, `all` covers reads, and `transaction` guarantees
commit on success or rollback on failure. Parameters are always explicit,
including an empty array for statements without bindings. The interface does
not expose query builders, migrations, nested transactions, or backend-specific
connection objects.

`SqlRunResult` exposes only `rowsAffected`. Synced entities use stable IDs
created by the application, so the portable boundary does not currently expose
a backend-generated last-insert ID.

The package's recording fake queues results and records calls. It deliberately
does not parse SQL or emulate constraints. A Bun-only test driver runs the same
boundary against real in-memory SQLite and verifies parameter binding,
multi-row LWW UPSERT with `RETURNING`, and atomic domain/sidecar rollback. That
driver is test support, not a published production adapter.

### Web SQLite Target

The web adapter uses `@sqlite.org/sqlite-wasm` in a dedicated module worker. It
uses the OO1 database API directly rather than the deprecated Worker1/Promiser
API. OPFS is the default durable storage mode; an explicit in-memory mode exists
for tests and deliberately ephemeral clients.

Most of the adapter code bridges the worker boundary rather than compensating
for different SQLite behavior. The worker maps OO1 `exec()` and `changes()` to
the shared `run` and `all` contract. The main thread sends each operation with a
request ID, then resolves the corresponding Promise when the worker echoes that
ID in its response. Bun's test adapter needs none of this message transport
because it calls SQLite in the same process.

The main-thread driver serializes requests through one queue. A transaction
holds that queue for `BEGIN IMMEDIATE`, every operation issued through the
transaction executor, and `COMMIT` or `ROLLBACK`. This prevents unrelated
driver calls from interleaving between worker messages. Transaction callbacks
must use the executor they receive rather than calling the outer driver.

OPFS does not silently fall back to memory. Opening it fails when the required
browser facilities are unavailable, allowing the app to present an unsupported
browser state instead of appearing durable while losing data. Hosts must send:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

That embedder policy also means cross-origin scripts, images, fonts, and workers
must provide compatible CORS or Cross-Origin-Resource-Policy headers. The app's
deployment and file-serving paths need to preserve those headers.

The browser conformance test builds the published adapter and verifies in both
Chromium and Firefox that parameter binding, affected-row counts, multi-row LWW
UPSERT with `RETURNING`, callback commit/rollback, and OPFS persistence across a
worker restart all work. WebKit/Safari remains unverified locally. The upstream
OPFS VFS documentation requires Safari 17 or newer. Version 1 adopts Safari 17+
as its web baseline and will not add a persistence fallback for older WebKit.

This confirms the main architectural bet: web and Expo/native can share the
same `SqlDriver` and local relational model. Dexie remains the existing app's
fallback during migration, not the new package's target backend.

### Existing App Cutover

The first cutover for an existing app should avoid a full client-side
Dexie-to-SQLite migration. The preferred path is a server-side reseed:

1. Ensure the old app has synced its local pending changes.
2. Freeze or gate old sync writes during the cutover window.
3. Export the current Cloudflare/D1 sync data.
4. Transform it into the new server bag-of-rows format.
5. Seed a new Cloudflare database or sync table.
6. Let new clients bootstrap from cursor `0` into fresh SQLite tables.
7. After verification, clear the old IndexedDB/Dexie contents.

This treats the new client as a fresh device. It does not preserve old unsynced
local-only records, which is acceptable for the initial single-user apps as long
as the data is synced before cutover.

The new server can assign fresh `serverSeq` values during the seed. Existing
clients will bootstrap from `0`, so preserving old cursor values is unnecessary.
The migration should preserve stable domain ids, payload data, HLCs where useful,
and tombstone state.

Keeping deleted rows in the seed is acceptable for personal-scale data because
it keeps the cutover conservative. However, retired tables should be explicitly
excluded from the new schema and from the seed, so deleted or obsolete product
surfaces are not accidentally carried forward.

The broader question of schema migration source-of-truth remains deferred. We do
not need to decide yet whether future migrations are authored as SQL files,
schema DSL changes, generated stubs, or handwritten TypeScript data migrations.

### Query Helper Generation

Query helpers should be generated files in the first version.

The schema DSL should generate boring TypeScript modules such as:

```ts
export const highlightsQueries = {
  get: (db: SqlDriver, id: string) =>
    db.get<Highlight>("select * from highlights where id = ?", [id]),

  listByBook: (db: SqlDriver, bookId: string) =>
    db.all<Highlight>(
      "select * from highlights where book_id = ? order by created_at",
      [bookId],
    ),
};
```

This is preferable to runtime query objects for v1 because generated files are
easy to inspect, test, and edit when the generated shape is insufficient.

For this project, ordinary exported TypeScript types and functions are preferred
over Hono-style deep type inference. Type inference can still derive row and
helper types from the schema, but the generated output should remain simple
enough for humans and agents to patch directly.

A local `SKILL.md` should document how to use the sync library, when schema
changes require regeneration, which generated files should not be hand-edited,
and which app code paths must use sync-aware writes.

Tradeoffs:

- Generated files add a codegen step.
- Runtime helpers avoid generated files, but they hide more behavior and are
  harder to review.
- Handwritten helpers are fine for unusual queries; the generator should cover
  the standard `get`, `listByScope`, and indexed lookup cases first.
- Hono-style type inference can give polished API ergonomics, but it increases
  type-level complexity before the sync model has settled.

### Completed Package PRs

1. Scaffold the package and add the text-only schema DSL.
2. Add shared sync-record, cursor, table-policy, and blob-reference contracts.
3. Add the async SQLite driver boundary and prove it with Bun SQLite and
   sqlite-wasm.
4. Generate app tables, indexes, `sync_meta`, and `sync_cursors` locally.
5. Add framework-neutral server bag-of-rows semantics and an in-memory reference
   adapter.
6. Prove D1 sequence allocation, JSON-batched LWW writes, winner lookup,
   rollback, pagination, and indexed pull plans in Cloudflare's local runtime.
7. Ship the production D1 `ServerSyncStorage` adapter, package-owned migration,
   encoded-byte limit, and D1 integration coverage without route wiring.
8. Complete the v1 schema vocabulary with integer, real, JSON-text, optional
   sync policy metadata, validation, and SQLite generation.

### Next Focused PRs

9. **Platform-neutral client HLC.** Generate and persist the client-owned wall
   time and logical counter with injected clock, device ID, and state storage.
10. **Explicit local writes and remote apply.** Atomically update domain rows and
    `sync_meta`, retain tombstones, apply server winners, and return affected
    table/scope information. Keep reads as ordinary SQLite queries initially.
11. **HTTP wire adapter.** Add framework-neutral request/response validation and
    thin Hono bindings over `SyncServer`, followed by ebook-backend wiring in a
    separate integration PR.
12. Add the client HTTP transport, bootstrap/incremental orchestration, React
    Query invalidation helpers, data reseeding, and one-table-at-a-time ebook
    cutover as later focused PRs.

### Open Questions

1. Which current synced tables are intentionally retired and should not be
   included in the new server seed?
2. What is the long-term source of truth for schema migrations after the
   standalone library is proven?

---

## Existing Dexie Sync Architecture

The remaining sections describe the current implementation and the earlier
Dexie extraction path. They are retained as implementation context, not as the
current RFC direction.

The sync system is a **local-first, bidirectional sync** architecture with:

- **Client storage**: Dexie (IndexedDB) with DBCore middleware for automatic metadata injection
- **Server storage**: A single generic `syncData` table (Cloudflare D1/SQLite) storing all entities as JSON blobs
- **Conflict resolution**: Last-Write-Wins (LWW) via Hybrid Logical Clocks (HLC)
- **File sync**: Separate content-addressed transfer queue (not HLC-based)

### Data Flow

```
Local Write:
  app calls db.table.put(item)
    → Dexie middleware injects _hlc, _deviceId, _serverTimestamp=-1
    → onLocalMutation callback fires
    → SyncService.syncTable() (throttled)
    → SyncEngine: pull remote changes, then push local changes
    → Server returns serverTimestamp, local record updated
    → React Query caches invalidated

Remote Write:
  SyncEngine.pull() fetches from server (since cursor)
    → Server returns items where serverTimestamp > cursor AND deviceId ≠ requester
    → StorageAdapter.applyRemoteChanges() runs LWW (remote _hlc > local _hlc → overwrite)
    → Items wrapped with markAsRemoteWrite() to bypass middleware
    → Sync cursor advanced
    → HLC receive() maintains causality
```

### Layer Diagram

```
┌─────────────────────────────────────────────────────┐
│  App Layer (React hooks, domain logic, queries)     │  ← app-specific
├─────────────────────────────────────────────────────┤
│  SyncService (lifecycle, periodic sync, throttling) │  ← needs refactoring
├─────────────────────────────────────────────────────┤
│  SyncEngine (pull/push orchestration)               │  ← already generic
├──────────────────┬──────────────────────────────────┤
│  StorageAdapter   │  RemoteAdapter                   │  ← interfaces generic,
│  (DexieStorageAd) │  (HonoRemoteAdapter)             │    impls need work
├──────────────────┴──────────────────────────────────┤
│  HLC Service + Dexie Middleware                     │  ← mostly generic
├─────────────────────────────────────────────────────┤
│  Schema Generator (generateDexieStores)             │  ← already generic
└─────────────────────────────────────────────────────┘
```

---

## What's Already Generic

These files could be extracted with zero or minimal changes:

### SyncEngine (`src/lib/sync/sync-engine.ts`)

The core orchestrator. Takes three injected dependencies (`StorageAdapter`, `RemoteAdapter`, `HLCService`) and has no app-specific imports. Handles pull-then-push, cursor management, and conflict counting. **No changes needed.**

### StorageAdapter Interface (`src/lib/sync/storage-adapter.ts`)

The `StorageAdapter` interface and the `SyncItem` wire format are fully generic. The `DexieStorageAdapter` implementation only depends on Dexie types and internal sync module constants. **No changes needed to the interface.**

### RemoteAdapter Interface (`src/lib/sync/remote-adapter.ts`)

The `RemoteAdapter` interface (pull/push/getCurrentTimestamp) is clean and framework-agnostic. **No changes needed to the interface.**

### Schema Generator (`src/lib/sync/hlc/schema.ts`)

`generateDexieStores()`, `SyncTableDef`, `SyncMetadata`, `UNSYNCED_TIMESTAMP`, `SYNC_INDICES` — all fully generic. Handles validation and Dexie schema string generation from a declarative table config. **No changes needed.**

### Dexie Middleware (`src/lib/sync/hlc/middleware.ts`)

The DBCore middleware that auto-injects `_hlc`, `_deviceId`, `_serverTimestamp`, `_isDeleted` on local writes and passes through remote writes untouched. Uses a `Symbol`-based marker (`REMOTE_WRITE`) to distinguish local vs remote writes. Also blocks hard deletes (forces tombstoning). **No changes needed.**

### Server-side push/pull logic (`server/lib/sync.ts`)

The `pullSyncData` and `pushSyncData` functions are generic — they operate on the `syncData` table using table name, user ID, and device ID as parameters. The push uses `INSERT ... ON CONFLICT DO UPDATE ... WHERE incoming_hlc > existing_hlc` for server-side LWW. **No changes needed** (apart from decoupling from Drizzle if supporting other ORMs).

### Server-side `syncData` table design (`server/db/schema.ts`)

The single-table design where all entities are stored as JSON blobs with `(id, tableName, userId)` as composite primary key is already generic. Indices on `(tableName, userId, serverTimestamp)` and `(tableName, userId, entityId, serverTimestamp)` support both full-table and scoped pulls efficiently.

---

## What Needs Minor Changes

### HLC Service (`src/lib/sync/hlc/hlc.ts`)

**Current coupling:**

- Imports `getOrCreateDeviceId` from `@/lib/device` (hardcoded device ID source)
- Hardcoded localStorage key `epub-reader-hlc-state`

**Changes needed:**

- Accept `deviceId` (or a `() => string` factory) as a config parameter
- Accept a `storageKey` string or a generic `{ get(): HLCState | null, set(state: HLCState): void }` persistence interface
- Remove the app-specific import

```ts
// Before
export function createHLCService(): HLCService {
  const deviceId = getOrCreateDeviceId();
  const saved = localStorage.getItem("epub-reader-hlc-state");
  // ...
}

// After
export interface HLCConfig {
  deviceId: string;
  persistence?: { get(): HLCState | null; set(state: HLCState): void };
}

export function createHLCService(config: HLCConfig): HLCService {
  const { deviceId, persistence } = config;
  const saved = persistence?.get();
  // ...
}
```

### DexieStorageAdapter (`src/lib/sync/storage-adapter.ts`)

**Current coupling:**

- Stores sync cursors in `localStorage` with hardcoded key format `sync-cursor:{table}`

**Changes needed:**

- Accept cursor storage strategy as a config option (default to localStorage, allow IndexedDB or custom)
- This is minor because the cursor storage is a small, isolated concern

### HonoRemoteAdapter (`src/lib/sync/remote-adapter.ts`)

**Current coupling:**

- Imports the typed `honoClient` from `@/lib/api`

**Changes needed:**

- Replace with a generic `FetchRemoteAdapter` that accepts:
  - `baseUrl: string`
  - `getHeaders: () => Record<string, string>` (for auth tokens, device ID)
- The Hono-specific adapter could remain as an optional integration package

```ts
// Library ships this
export class FetchRemoteAdapter implements RemoteAdapter {
  constructor(
    private config: {
      baseUrl: string;
      getHeaders: () => HeadersInit;
      // Optional: custom endpoint paths
      paths?: { pull?: string; push?: string; timestamp?: string };
    },
  ) {}

  async pull(table, since, entityId?, limit?) {
    const params = new URLSearchParams({ since: String(since) });
    if (entityId) params.set("entityId", entityId);
    if (limit) params.set("limit", String(limit));
    const res = await fetch(`${this.config.baseUrl}/sync/${table}?${params}`, {
      headers: this.config.getHeaders(),
    });
    return res.json();
  }
  // ...
}
```

---

## What Needs Significant Refactoring

### SyncService (`src/lib/sync-service.ts`)

This is the main orchestration layer and the most app-coupled file. It currently:

1. Imports the `db` singleton directly
2. Imports `SYNC_TABLES` and `SyncTableName` directly
3. Hardcodes React Query invalidation keys (`["books"]`, `["readingProgress"]`, etc.)
4. Imports app-specific `addSyncLogs` for debug logging
5. Is instantiated as a module-level singleton

**Changes needed to make it a library export:**

```ts
// Library API
export interface SyncLibraryConfig<TTables extends string = string> {
  // Required
  db: Dexie;
  tables: Record<TTables, SyncTableDef>;
  remoteAdapter: RemoteAdapter;

  // HLC
  deviceId: string;
  hlcPersistence?: { get(): HLCState | null; set(state: HLCState): void };

  // Lifecycle
  periodicSyncInterval?: number; // default: 30_000
  throttleInterval?: number; // default: 5_000

  // Extension points
  onSyncComplete?: (results: Map<TTables, SyncResult>) => void;
  onConflict?: (table: TTables, local: SyncItem, remote: SyncItem) => void;
  logger?: (entry: SyncLogEntry) => void;
}

export function createSyncLibrary<T extends string>(
  config: SyncLibraryConfig<T>,
) {
  // Returns a SyncService instance wired with the provided config
}
```

The key insight: **query invalidation should not be the library's responsibility**. The library should expose an `onSyncComplete` callback that tells the consumer which tables changed and how many items were pulled/pushed. The consumer (e.g. a React app) can then invalidate whatever caches it needs.

### Table Configuration (`src/lib/sync-tables.ts`)

This file IS the app configuration. In a library, the user would provide their own table definitions using the same `SyncTableDef` type:

```ts
// User's app code
import { createSyncLibrary, type SyncTableDef } from 'local-sync';

const tables = {
  todos: {
    primaryKey: 'id',
    indices: ['listId', 'createdAt'],
    entityKey: 'listId',
  },
  lists: {
    primaryKey: 'id',
    indices: ['name'],
  },
} satisfies Record<string, SyncTableDef>;

const sync = createSyncLibrary({ tables, db, ... });
```

### Database Setup (`src/lib/db.ts`)

The library should export helpers, not a database instance:

- `generateDexieStores(tables)` — already generic
- `WithSyncMetadata<T>` — type helper for TypeScript users
- `createSyncTableSchema(def)` — individual table schema generation
- A `setupDatabase(db, tables)` helper that handles versioning of sync metadata columns

The user owns their Dexie instance, types, and schema migrations.

---

## What Would NOT Be Part of the Library

| Component                                  | Reason                                                              |
| ------------------------------------------ | ------------------------------------------------------------------- |
| React hooks (`use-sync.ts`)                | Framework-specific; provide as optional `@local-sync/react` package |
| Domain types (Book, Highlight, etc.)       | App-specific                                                        |
| File storage system                        | Separate concern (content-addressed blobs ≠ metadata sync)          |
| Transfer queue                             | Separate concern, though could be a companion library               |
| Server framework integration (Hono routes) | Provide reference implementation + docs, not a library              |
| Auth/device management                     | Consumer's responsibility                                           |

---

## Proposed Library Structure

```
@local-sync/core
├── sync-engine.ts          # SyncEngine class (unchanged)
├── storage-adapter.ts      # StorageAdapter interface + DexieStorageAdapter
├── remote-adapter.ts       # RemoteAdapter interface + FetchRemoteAdapter
├── hlc/
│   ├── hlc.ts              # HLC service (configurable device ID + persistence)
│   ├── schema.ts           # SyncTableDef, generateDexieStores, constants
│   └── middleware.ts        # Dexie DBCore middleware (unchanged)
├── sync-service.ts         # Orchestration (configurable, no app imports)
├── types.ts                # SyncItem, SyncResult, SyncOptions, etc.
└── index.ts                # Public API: createSyncLibrary()

@local-sync/server          # Optional companion
├── sync-handlers.ts        # Generic push/pull logic (currently server/lib/sync.ts)
├── schema.ts               # Reference syncData table schema
└── adapters/
    ├── drizzle.ts           # Drizzle ORM adapter
    └── kysely.ts            # Kysely adapter (etc.)

@local-sync/react           # Optional framework bindings
├── use-sync.ts             # Hook wrapping SyncService lifecycle
├── use-sync-status.ts      # Reactive sync state
└── provider.tsx             # Context provider
```

---

## API Surface for the Library

### Initialisation

```ts
import { createSyncLibrary } from "@local-sync/core";

const sync = createSyncLibrary({
  db: myDexieInstance,
  tables: {
    todos: { primaryKey: "id", indices: ["listId"] },
    lists: { primaryKey: "id" },
  },
  remoteAdapter: new FetchRemoteAdapter({
    baseUrl: "https://api.myapp.com",
    getHeaders: () => ({ Authorization: `Bearer ${token}` }),
  }),
  deviceId: getDeviceId(),
  onSyncComplete: (results) => {
    // Invalidate your own caches here
    queryClient.invalidateQueries({ queryKey: ["todos"] });
  },
});

sync.start(); // Begin periodic sync
sync.stop(); // Stop periodic sync
sync.destroy(); // Full cleanup
```

### Manual Sync

```ts
await sync.syncAll(); // Sync all tables
await sync.syncTable("todos"); // Sync one table
await sync.syncTable("todos", { entityId: listId }); // Scoped sync
await sync.pushTable("todos"); // Push only
await sync.pullTable("todos"); // Pull only
```

### Querying (User's Dexie)

```ts
import { isNotDeleted } from "@local-sync/core";

// User queries their own Dexie tables, filtering tombstones
const todos = await db.todos.filter(isNotDeleted).toArray();
```

### Soft Deletes

```ts
import { createTombstone } from "@local-sync/core";

// Library provides the tombstone helper
await db.todos.put(createTombstone(existingTodo));
```

### Server Setup (Reference)

```ts
import { createSyncHandlers } from "@local-sync/server";

const { handlePull, handlePush } = createSyncHandlers({
  getDb: (c) => c.get("db"),
  getUserId: (c) => c.get("user").id,
  getDeviceId: (c) => c.req.header("X-Device-ID"),
});

app.get("/api/sync/:table", handlePull);
app.post("/api/sync/:table", handlePush);
app.get("/api/sync-timestamp", (c) => c.json({ serverTimestamp: Date.now() }));
```

---

## Existing Dexie Design Decisions

These decisions explain the current Dexie-based implementation. The SQLite-first
RFC above supersedes the middleware-specific parts for new work.

1. **Single server table for all entities**: The `syncData` table with `(id, tableName, userId)` composite key and JSON `data` column means zero server migrations when adding new client-side tables. This is a huge DX win for personal apps.

2. **Pull-then-push ordering**: Pulling first ensures the client has the latest state before pushing, reducing unnecessary conflicts.

3. **Server excludes requester's own changes from pull**: The `deviceId != requester` filter prevents echo and reduces bandwidth.

4. **Tombstoning over hard deletes**: The middleware blocks `delete()` operations and forces `put()` with `_isDeleted = 1`. This ensures deletes propagate across devices.

5. **Symbol-based remote write marker**: Using `Symbol('REMOTE_WRITE')` to bypass middleware on remote applies is elegant — it's invisible to serialisation and impossible to accidentally trigger.

6. **Middleware-based metadata injection**: App code never manually sets `_hlc` or `_deviceId`. The Dexie middleware handles it transparently, making the sync system invisible to domain logic.

7. **Legacy HLC encoding**: The current format is
   `timestamp-counter-deviceId`. Its parser preserves dashed device IDs by
   joining all components after the timestamp and counter. The current server's
   raw string comparison can misorder variable-width counters, so the new model
   uses a structured numeric HLC with a separate device-ID tie-breaker instead.

---

## Open Questions From the Existing Dexie Extraction Path

1. **Should the library bundle Dexie or accept any IndexedDB wrapper?** Dexie's DBCore middleware is deeply integrated into the sync approach. Supporting alternatives (e.g. idb, raw IndexedDB) would require reimplementing the middleware layer. Recommendation: **couple to Dexie** — it's the standard and the middleware API is powerful.

2. **Should the server package be framework-agnostic?** The current push/pull logic is essentially raw SQL. Providing a Drizzle adapter is convenient but limits reach. Recommendation: **provide the core logic as plain functions** that accept a database connection, plus optional framework adapters.

3. **Should file/blob sync be included?** The current system has a separate content-addressed file storage with transfer queues. This is a distinct concern from metadata sync. Recommendation: **keep it separate** as an optional companion package (`@local-sync/files`). Many apps won't need it.

4. **Custom conflict resolution?** Currently hard-coded to LWW. Some apps may want field-level merging or custom resolution. Recommendation: **start with LWW only** (covers 90% of personal app use cases), expose a conflict callback for logging/monitoring, and design the `StorageAdapter.applyRemoteChanges` signature to allow future custom resolvers.

5. **Schema migrations?** Dexie handles IndexedDB versioning, but the library should provide guidance on adding/removing synced fields and tables without breaking existing sync state. The single-table server design helps here — adding a new client table requires zero server changes.

6. **Multi-user / shared data?** The current design is single-user (scoped by `userId` on the server). Supporting shared entities (e.g. collaborative lists) would require significant changes to the permission model. Recommendation: **explicitly scope to single-user** for v1.

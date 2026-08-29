# New Sync Implementation Plan

**Status**: In progress

**Last updated**: 2026-08-29

This file is the implementation record. Update the status and completed work
after each slice lands.

## Proposed implementation order

### 1. Freeze the protocol and invariants — Complete

Write the minimal contract before code changes:

- A logical key is an opaque encoded pair such as `JSON.stringify([table, id])`.
- A value is `JSON.stringify(domainObject)`.
- `schemaVersion` starts at `1`.
- Deletes have `isDeleted = true` and retain their serialized value.
- The server stores only the current winner for each `(userId, key)`.
- HLC determines the winner.
- `serverSeq` determines pull order.
- Maximum batch: initially 500 changes.
- Apply explicit key, value, and total-request size limits.
- The push response returns the current winner for every submitted key. It must return winners for accepted and rejected writes.

Bootstrap must include rows from the requesting device. Incremental pulls can
exclude that device.

Use an explicit client state such as `bootstrapped: boolean`. Do not infer bootstrap from `cursor === 0`, because bootstrap can require multiple pages:

```text
bootstrap pages: include own-device rows
bootstrap complete: set bootstrapped = true
incremental pages: exclude own-device rows
```

Also audit which existing sync metadata is real domain information. For example, some reading-history code uses `_deviceId` as meaningful data. Such fields must become ordinary `deviceId` fields before `_deviceId` is removed.

Completed on 2026-08-29:

- Added the executable Zod contract, limits, key and JSON value helpers, HLC
  comparison, and client-state shape in `src/lib/sync-v2/protocol.ts`.
- Fixed pull pagination around a server-supplied high-water `head`.
- Made bootstrap device inclusion explicit across every bootstrap page.
- Put device ID, HLC state, pull cursor, and bootstrap status in `localStorage`.
  Only the compacted outbox will use an internal Dexie table.
- Kept soft-deleted values and added explicit `isDeleted` state so local undo
  can restore a row with a newer HLC.
- Added nine focused protocol tests. The tests, root build, lint, formatting,
  and diff checks passed.
- Accepted one active browser writer as a v1 limitation. Cross-tab HLC locking
  is deferred.

### 2. Add the new server table alongside the old table — Complete

Define the new table in [server/db/schema.ts](/Users/admin/epub-reader-demo/server/db/schema.ts:109) and generate a new Drizzle migration.

A suitable table is:

```text
sync_records
  server_seq        INTEGER PRIMARY KEY AUTOINCREMENT
  user_id           TEXT NOT NULL
  key               TEXT NOT NULL
  value             TEXT NOT NULL
  schema_version    INTEGER NOT NULL
  hlc_wall_time_ms  INTEGER NOT NULL
  hlc_counter       INTEGER NOT NULL
  device_id         TEXT NOT NULL
  is_deleted        INTEGER NOT NULL

  UNIQUE(user_id, key)
  INDEX(user_id, server_seq)
```

Do not drop `sync_data` yet. Do not edit the old migration.

Use Drizzle for the schema and migration history. Use raw D1 SQL inside the endpoints for the batch operations. The sequence-number method is already proven in [sql.ts](/Users/admin/epub-reader-demo/packages/local-sync/src/adapters/d1/sql.ts:3) and documented in [SYNC.md](/Users/admin/epub-reader-demo/SYNC.md:522).

Completed on 2026-08-29:

- Added the `syncRecord` Drizzle schema while retaining the legacy `syncData`
  schema and table.
- Generated additive migration `drizzle/0006_clean_santa_claus.sql` and its
  Drizzle snapshot. No earlier migration was edited.
- Made `server_seq` an `AUTOINCREMENT` primary key and kept every protocol
  field non-null, including the retained soft-deleted value.
- Added the unique `(user_id, key)` index and ordered `(user_id, server_seq)`
  pull index.
- Linked records to the Better Auth user with `ON DELETE CASCADE`.
- Passed the server suite, root build, targeted lint, formatting, and diff
  checks.

### 3. Add the new Hono endpoints — Complete

Add versioned routes in [server/index.ts](/Users/admin/epub-reader-demo/server/index.ts:205), while the old `/api/sync/:table` routes remain active:

```text
POST /api/sync/v2/push
GET  /api/sync/v2/pull?cursor=...&head=...&limit=...&excludeOwnDevice=...
```

The endpoints should use:

- Better Auth session middleware.
- `X-Device-ID`.
- Zod and the Hono validator for the protocol envelope.
- Size validation for keys, values, individual batches, and total request bodies.
- No validation of the JSON value’s application schema.

The push transaction should:

1. Bind the batch once as JSON.
2. Expand it with `json_each(?)`.
3. Run one `INSERT ... SELECT ... ON CONFLICT DO UPDATE`.
4. Assign `server_seq = excluded.server_seq` when the incoming HLC wins.
5. Read the current winner for every requested key.
6. Execute both statements in one `D1Database.batch()` call.
7. Map results by key because SQL `RETURNING` order is not guaranteed.

The pull endpoint should capture a high-water mark at the start:

```text
head = current maximum serverSeq
read rows where cursor < serverSeq <= head
apply device exclusion only when bootstrapped
```

When the page is complete, return `nextCursor = head`. This advances the cursor across skipped own-device rows without losing concurrent writes above `head`.

Use [local-sync-d1-conformance.test.ts](/Users/admin/epub-reader-demo/test/server/local-sync-d1-conformance.test.ts:62) as the reference. Keep its low-level transaction and query-plan checks until Step 9 transfers or removes them. The v2 endpoint suite should test:

- 500-row batches.
- One-megabyte batches.
- LWW acceptance and rejection.
- AUTOINCREMENT gaps.
- Bootstrap device inclusion.
- Incremental device exclusion.
- High-water advancement.
- Pagination while new writes arrive.

Completed on 2026-08-29:

- Added authenticated `POST /api/sync/v2/push` and
  `GET /api/sync/v2/pull` routes directly in `server/index.ts`. The legacy
  routes remain active for cutover.
- Pull uses validated query parameters and returns `Cache-Control: no-store`.
- Added Hono body limits, Zod envelope and size validation, device-ID
  validation, and the five-minute future-HLC limit.
- Implemented one JSON-bound `INSERT ... SELECT ... ON CONFLICT DO UPDATE`
  statement. Winning updates copy the attempted row's fresh AUTOINCREMENT
  sequence into the compacted winner.
- Read every submitted key's current winner in the same `D1Database.batch()`
  transaction and restored results to request order by key.
- Implemented fixed-head pull pagination and incremental own-device exclusion.
  Complete pages advance to the head even when every intervening row was
  omitted.
- Added nine behavior-focused endpoint tests for auth, user isolation, retained
  soft deletes, LWW rejection and retry, sequence renewal, 500-row batching,
  size and clock limits, fixed-head pagination, and own-device advancement.
- Kept the experimental package's low-level D1 transaction and query-plan
  conformance tests active until package retirement.
- Passed all 68 server tests, the root build, targeted lint, formatting, and
  diff checks.

### 4. Create the new client database — Complete

Do not upgrade the existing `"epub-reader-db"` schema in place. Create a new database name, such as `"epub-reader-db-v2"`, with Dexie version 1.

Use the clean domain schemas currently described in [sync-tables.ts](/Users/admin/epub-reader-demo/src/lib/sync-tables.ts:14), but remove:

- `_hlc`
- `_deviceId`
- `_isDeleted`
- `_serverTimestamp`
- Sync-only indexes
- `syncLog`, unless it still has an independent debugging purpose

Keep local-only tables such as EPUB files and caches if they are still useful. A fresh database means these caches initially start empty.

Every synced domain row gets a plain `isDeleted` field. This is application
state used for soft deletion and undo, not one of the old underscored sync
metadata fields. Normal queries exclude soft-deleted rows.

Add only one internal table:

```text
_sync_outbox
  key
  value
  schemaVersion
  HLC fields
  isDeleted
```

The outbox is compacted by logical key. A second local change replaces the first pending change.

Persist device ID, HLC state, pull cursor, and bootstrap status in
`localStorage` under one validated state envelope.

Completed on 2026-08-29:

- Added the isolated `epub-reader-db-v2` Dexie database at version 1. The
  running application still uses the legacy database until the client cutover.
- Defined clean domain tables with only application indexes. Rows use the plain
  `isDeleted` boolean and contain none of the four legacy sync metadata fields.
- Removed `books.lastOpened` and its index. Reading checkpoints own recent
  reading activity, while reading sessions already represent book opens.
- Retained useful local EPUB, file, transfer, text, and reader-source caches.
  Omitted `syncLog` because it only served the old sync implementation.
- Added `_sync_outbox` as the only internal table. It stores the compacted
  protocol change directly and uses its logical key as the primary key.
- Added helpers that create, validate, read, and write one local-storage state
  envelope. Its first initialization accepts the app's existing device ID.
- Added two client-state behavior tests. The focused tests, root build,
  targeted lint, formatting, and diff checks passed.

### 5. Add transparent Dexie mutation interception — Complete

Install one DBCore middleware over the new database.

For every mutation to a registered table:

1. Derive the logical key.
2. Generate the next HLC.
3. Apply the ordinary domain mutation. Convert deletes into soft-deleted puts
   that preserve the current value.
4. Upsert the corresponding outbox entry.
5. Commit both changes in the same IndexedDB transaction.

This must cover:

- `put`, `add`, `update`, `delete`, and bulk operations.
- Existing multi-table transactions.
- Cascading operations such as deleting a book and its related rows.
- Transaction rollback. A failed domain write must not leave an outbox row.

Deletes remain in domain tables with `isDeleted = true`. The middleware writes
the retained value and deletion flag to the outbox. Undo writes
`isDeleted = false` with a newer HLC.

Registration can remain simple:

```ts
installSync(db, [
  "books",
  "readingProgress",
  "readingCheckpoints",
  "readingSessions",
  "highlights",
  "readingSettings",
  "readingState",
  "notes",
]);
```

There is no codec or client schema framework in this version.

Completed on 2026-08-29:

- Added one `installSync(db, tableNames)` DBCore middleware. Read-write
  transactions that touch a registered table automatically include
  `_sync_outbox`, including existing explicit multi-table transactions.
- `add`, `put`, `update`, and bulk writes now store a plain `isDeleted` boolean
  and replace the compacted outbox entry for the row's encoded logical key.
- Direct deletes, bulk deletes, indexed collection deletes, and `clear` now read
  the current value and write a retained soft-deleted row instead.
- Domain writes and their outbox writes share the same IndexedDB transaction.
  Only successful bulk items produce outbox entries, and transaction rollback
  removes both sides.
- Added monotonic batched HLC reservation to the validated local-storage state
  envelope. Clock advancement can survive a failed database transaction;
  unused HLC values are safe gaps.
- Split access into two Dexie connections over the same IndexedDB database.
  The application connection installs mutation interception. The sync
  connection uses the schema directly, so pulled rows and push winners create
  no HLC or outbox entry and require no marker on domain values.
- Kept value encoding at JSON and schema version 1. Oversized values fail
  before either IndexedDB table is changed.
- Added eleven focused Step 5 behaviors covering clock batching, outbox
  compaction, bulk and multi-table writes, all delete shapes, cascades,
  rollback, value limits, and raw sync writes. The focused tests, root build,
  targeted lint, formatting, and diff checks passed.

### 6. Build the client sync loop — Complete

Implement one serialized sync operation:

1. Pull changes.
2. Apply remote winners that do not have a newer local outbox winner.
3. Push the compacted outbox in batches.
4. Reconcile every push result with the returned server winner.
5. Remove an outbox entry only if it still represents the acknowledged mutation.
6. Continue pulling until the server page is complete.
7. Commit remote rows before saving cursor and bootstrap state to
   `localStorage`. A crash between these operations safely replays the page.

Retries must be safe. A crash after the server accepts a push but before the client clears the outbox must only resend the same mutation.

Completed on 2026-08-29:

- Added one `SyncV2Client` that coalesces concurrent full-sync calls and runs
  pull before push. Pull continues over the server's fixed high-water head.
- Added the typed Hono transport. Pull uses the read-only query contract and
  push sends protocol-sized batches of at most 500 compacted changes.
- Added a preprocessing boundary for server data. It checks the common key,
  table, schema-version, object, ID, and deletion invariants, then decodes the
  opaque JSON value into a domain row. It does not validate application fields.
- Remote HLCs advance the local clock outside IndexedDB after preprocessing.
  The remote rows, outbox conflict reads, and remote writes use one IndexedDB
  transaction. The cursor advances only after that transaction commits.
- Pull applies a remote row when no newer local outbox entry exists. A newer
  local entry keeps the local row. A remote winner can replace the domain row
  while the stale outbox remains for the normal push reconciliation path.
- Push snapshots the compacted outbox. It removes an entry only when the live
  entry still equals the sent mutation. A concurrent local edit therefore
  stays pending and its domain row is not overwritten.
- Push uses every returned current winner, including rejected writes. A
  different winner replaces the domain row through the raw sync connection.
  Retried accepted writes are idempotent.
- Added seven sync-loop behavior tests for bootstrap and incremental pull,
  conflict outcomes, stale-outbox reconciliation, concurrent edits, 501-row
  batching, malformed values, and serialized calls. The focused suite, root
  build, lint, formatting, and diff checks passed.
- Kept the running application on its legacy provider and database. Provider
  replacement belongs to the Step 7 application cutover, when every consumer
  can use the clean domain tables in one change.

### 7. Convert the application to clean domain types — Complete

This is the actual table replacement, not a separate IndexedDB migration.

Change the application to:

- Replace `SyncedBook`, `SyncedHighlight`, and similar types with domain types.
- Replace `_isDeleted` with a plain `isDeleted` domain field.
- Update normal queries to exclude `isDeleted` rows.
- Let application code use ordinary Dexie deletes; middleware converts them to
  soft-deleted writes.
- Remove application reads of `_hlc` and `_serverTimestamp`.
- Add explicit domain `deviceId` fields only where the application needs them.
- Make multi-table deletions atomic.
- Move `src/lib/sync/epub-processing.ts` outside the old sync directory before that directory is removed.

At this gate, the application must build and pass its tests against the new database and client engine.

Replace the existing provider and service usage starting at [App.tsx](/Users/admin/epub-reader-demo/src/App.tsx:16). Keep the current public hook shape where this reduces application changes.

Completed on 2026-08-29:

- Switched the running application to the fresh `epub-reader-db-v2` database.
  This is a clean replacement. It does not upgrade or copy the old IndexedDB
  database.
- Replaced active application `Synced*` types with domain types. Removed reads
  and writes of `_hlc`, `_deviceId`, `_isDeleted`, and `_serverTimestamp` from
  the application path.
- Added the ordinary `deviceId` domain field to historical reading progress.
  Reading checkpoints and sessions retain their existing domain device IDs.
- Made normal queries exclude rows whose plain `isDeleted` field is true.
  Ordinary Dexie deletes now rely on the Step 5 middleware to retain values and
  create compacted soft-delete outbox entries.
- Made book deletion one atomic transaction across the book, all book-scoped
  synced rows, and regenerable local caches.
- Removed `books.lastOpened`. Reading checkpoints are now the only source for
  recent-reading order and labels. Reading sessions continue to represent book
  opens as a separate concept.
- Replaced the legacy sync service internals with a small lifecycle wrapper
  around `SyncV2Client`. The existing provider API now starts periodic full
  sync, handles online recovery, and invalidates TanStack Query data after
  changes.
- Moved EPUB extraction from `src/lib/sync/epub-processing.ts` to
  `src/lib/epub-processing.ts`. The old sync directory remains until the later
  retirement and final-cleanup steps.
- Updated the affected client fixtures to use clean rows and whole-database
  test resets. All 616 client tests, the root build, full lint, changed-file
  formatting, and diff checks passed.

### 8. Build and dry-run the migration tool — Complete

Build this before touching production.

The transform from old `sync_data` should:

- Convert `(table_name, id)` to the new opaque key.
- Reconstruct the domain value as `{ id, ...data }`. The old adapter stripped `id` before upload in [storage-adapter.ts](/Users/admin/epub-reader-demo/src/lib/sync/storage-adapter.ts:123).
- Strip any remaining legacy sync metadata.
- Reconstruct and retain deleted row values, set `isDeleted = true` in the
  envelope, and add the plain field to the encoded domain value.
- Parse the old HLC into wall time, counter, and device components.
- Preserve the old `device_id`.
- Set `schemaVersion = 1`.
- Convert meaningful metadata, such as reading-progress origin devices, into real domain fields.

Test the tool against a local copy of the old D1 schema. Verify counts, tombstones, representative values, and deterministic output.

Use a direct one-time D1 seed/import rather than adding a permanent migration HTTP endpoint.

Completed on 2026-08-29:

- Added `bun run sync:migrate-v2` as a local-only CLI. It loads a Wrangler D1
  SQL export into an in-memory SQLite database and reads the compacted
  `sync_data` winners without contacting production.
- Reconstructed each opaque key as `[tableName, id]` and each JSON value as
  `{ id, ...data, isDeleted }`. The transform strips the old sync metadata and
  converts the old reading-progress writer metadata into the ordinary domain
  `deviceId` field.
- Parsed each legacy HLC into numeric wall time and counter components. The new
  row preserves the trusted old `device_id`; the report counts any difference
  between that column and the device component embedded in the HLC.
- Retained deleted values and set both the envelope and encoded domain value to
  `isDeleted = true`. No null tombstone format is introduced.
- Added fail-fast checks for unknown tables, duplicate logical keys, malformed
  JSON and HLCs, invalid device IDs, control line breaks, and the v2 key and
  value limits. The CLI writes no artifact until every source row passes.
- Made dry-run print a count-only report by user and table. Artifact mode emits
  a deterministic SQL seed plus the same JSON report, refuses to replace files
  unless `--force` is explicit, and never modifies the source export.
- Added a Wrangler-style export fixture and four D1-backed tests. They verify
  counts, representative values, tombstones, reading-progress device origin,
  SQL escaping, deterministic output, source validation, and direct insertion
  into `sync_records`.
- The fixture dry-run reported three rows, with two active and one deleted. Two
  separate artifact runs produced identical seed and report files. All 77
  server tests, the migration CLI's strict TypeScript check, the root build,
  full lint, changed-file formatting, and diff checks passed.

### 9. Retire the experimental package

Only remove `packages/local-sync` after:

- The new server owns the proven D1 SQL.
- Equivalent tests exist outside the package.
- The new client no longer imports package concepts.
- `bun run build` and the server tests pass.

Then remove its workspace and lockfile references.

### 10. Deploy the new server path without switching clients

Production deployment order:

1. Back up D1.
2. Apply the new table migration.
3. Deploy the v2 endpoints.
4. Leave old clients on the old endpoints.
5. Run small authenticated push/pull smoke checks against v2.

This gives the new protocol a production validation point before the client cutover.

### 11. Export, transform, and seed production data

Use a short write freeze for the personal app. This is much simpler than designing a delta-capture migration.

During the freeze:

1. Export all old `sync_data`.
2. Record row counts by user and table.
3. Record active and deleted counts.
4. Keep the export immutable.
5. Run the local transform.
6. Seed `sync_records`.
7. Verify logical-key counts, tombstones, JSON decoding, and selected books, highlights, settings, and progress records.

Keep blob storage unchanged. The migrated metadata should continue to reference the existing blobs.

### 12. Deploy the new client and bootstrap

Switch the application to:

- The new IndexedDB name.
- The v2 endpoints.
- Bootstrap mode with own-device inclusion.

Verify:

- Expected record counts.
- Settings and reading positions.
- Highlight contents.
- EPUB and cover retrieval.
- Empty outbox after synchronization.
- Cursor at the server head.
- A new mutation from each of two devices.
- Conflict resolution.
- Delete propagation.
- Offline mutation and reconnect.
- Incremental pulls skipping the requesting device.

### 13. Keep a rollback window

For a short period, retain:

- The old production export.
- The old `sync_data` table.
- The old server endpoints.
- The old IndexedDB database on the client.

Do not allow the old and new clients to write concurrently after the cutover. The retained old path is for rollback, not dual-write operation.

## Final cleanup

After production checks pass:

1. Remove `src/lib/sync/**`, after moving EPUB processing.
2. Remove the old sync service, hooks, table DSL, metadata helpers, and debug calls.
3. Remove all `Synced*` types and old metadata references.
4. Remove the old routes from `server/index.ts`.
5. Delete `server/lib/sync.ts`.
6. Remove `syncData` from the Drizzle schema.
7. Generate a new migration that drops `sync_data`.
8. Remove obsolete tests and dependencies.
9. Replace the large RFC with a short document that describes the actual v2 contract.
10. Delete the old IndexedDB database only after the rollback window.
11. Retain the production export according to a deliberate backup policy.

The implementation uses five review units: server v2, client substrate,
application data-model cutover, migration tool, and final cleanup.

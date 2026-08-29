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

Use Drizzle for the schema and migration history. Use raw D1 SQL inside the endpoints for the batch operations. The experimental package proved the sequence-number method. The production implementation now lives in [server/index.ts](/Users/admin/epub-reader-demo/server/index.ts:41) and is documented in [SYNC.md](/Users/admin/epub-reader-demo/SYNC.md:515).

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

The retired package's D1 conformance suite was the original reference. The production [sync-v2.test.ts](/Users/admin/epub-reader-demo/test/server/sync-v2.test.ts:15) endpoint suite should test:

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
- Kept the deprecated `readingProgress` table local-only until final cleanup.
  It is not registered with sync v2, so dormant legacy writers cannot recreate
  the remote append-only log.
- Added twelve focused Step 5 behaviors covering clock batching, outbox
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
- Exclude the obsolete append-only `readingProgress` log.
- Retain both inferred and native `readingSessions`, but remove the obsolete
  `source` distinction from the new domain value. Retain all compacted
  `readingCheckpoints`.

Test the tool against a local copy of the old D1 schema. Verify counts, tombstones, representative values, and deterministic output.

Use a direct one-time D1 seed/import rather than adding a permanent migration HTTP endpoint.

Completed on 2026-08-29:

- Added `bun run sync:migrate-v2` as a local-only CLI. It loads a Wrangler D1
  SQL export into an in-memory SQLite database or opens a SQLite backup
  read-only, then reads the compacted `sync_data` winners without contacting
  production.
- Reconstructed each opaque key as `[tableName, id]` and each JSON value as
  `{ id, ...data, isDeleted }`. The transform strips the old sync metadata and
  retains only current domain tables.
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
- Added a Wrangler-style export fixture and six D1-backed tests. They verify
  counts, representative values, tombstones, deprecated-history exclusion, SQL
  escaping, deterministic output, source validation, and direct insertion into
  `sync_records`.
- The fixture dry-run reported two retained rows and one excluded deprecated
  progress row. Two separate artifact runs produced identical seed and report
  files. All 77
  server tests, the migration CLI's strict TypeScript check, the root build,
  full lint, changed-file formatting, and diff checks passed.

Production-filter amendment completed on 2026-08-29:

- Added explicit exclusion reporting with source, retained, and excluded row
  counts. Deprecated rows are skipped before HLC, device, and value migration.
- Excluded all 45,017 production `readingProgress` rows. Retained all 32
  checkpoints and all 381 sessions, including the 172 sessions inferred from
  legacy progress and the 209 sessions recorded by the current reader.
- Removed the session `source` field from migrated values and from the current
  client domain model. Inferred-session IDs keep their deterministic prefix so
  the dormant rerunnable backfill can still identify them until cleanup.
- Added a production-shaped test that locks the reduction from 45,975 source
  rows to 958 seed records, plus a focused test that verifies both session
  histories survive without a source label.
- Updated the CLI to accept either a Wrangler SQL export or the verified local
  SQLite backup. A read-only dry-run against the backup produced 958 records:
  941 active and 17 retained soft deletes, with zero HLC-device mismatches.
- Removed `readingProgress` from the v2 synced-table registration. Its Dexie
  table remains local-only for dormant legacy and debug code until final
  cleanup.
- Passed all 74 server tests, all 610 client tests, the root build, full lint,
  strict migration-script TypeScript checking, formatting, and diff checks.

### Production D1 backup checkpoint — Complete

The personal app was treated as write-frozen before the production migration.
The backup was made before applying the v2 D1 migration or deploying the v2
server routes.

Completed on 2026-08-29:

- Confirmed that the `DATABASE` binding points to `reader-db`, database ID
  `b830fea5-d461-4be0-8916-2e01d77c141f`, in the APAC region. D1 reported a
  remote database size of 30,748,672 bytes.
- Tried the official `wrangler d1 export` path first. Cloudflare's export API
  rejected the current Wrangler OAuth session with authentication error 10000,
  while read-only D1 information and query operations remained available. No
  API token was present, and no credential was extracted or printed.
- Added `bun run db:backup-remote` as a read-only logical-backup fallback. It
  reads schema and application tables through Wrangler, pages by SQLite row ID,
  writes through a partial file, refuses overwrites, and never logs row values.
- Copied all 46,085 application-owned rows across `account`, `d1_migrations`,
  `file_storage`, `session`, `sync_data`, `user`, `user_devices`, and
  `verification`. This includes all 45,975 legacy sync winners.
- Excluded only Cloudflare's internal `_cf_KV` table. D1 prohibits direct reads
  of its value column; the table is not application-owned. The manifest records
  this exclusion.
- Stored the read-only SQLite snapshot and manifest under the Git-ignored
  `backups.local/d1/2026-08-29T11-56-54Z/` directory. The SQLite file is
  29,827,072 bytes with SHA-256
  `349659875a53ff304d03f19c85523ccf86d4353f8f6140707147f30132c1e3c5`.
- Reopened the snapshot read-only and confirmed `PRAGMA integrity_check = ok`,
  zero foreign-key violations, and matching counts for every local table. A
  second query against the remote primary returned the same per-table counts
  after the backup completed. The local and remote `sync_data` row count,
  maximum row ID, maximum and summed server timestamps, and payload-byte total
  also matched.

This completes the D1 backup prerequisite in Step 10. It does not apply the v2
migration, deploy either server or client, transform `sync_data`, or seed
`sync_records`.

### 9. Retire the experimental package — Complete

Only remove `packages/local-sync` after:

- The new server owns the proven D1 SQL.
- Equivalent tests exist outside the package.
- The new client no longer imports package concepts.
- `bun run build` and the server tests pass.

Then remove its workspace and lockfile references.

Completed on 2026-08-29:

- Confirmed that the application and new client do not import the experimental
  package. The production server now owns the compacting D1 batch SQL and
  sequence allocation.
- Kept the relevant protocol guarantees in the authenticated v2 endpoint suite:
  LWW acceptance and rejection, tie-breaking, soft-deleted values, retry
  behavior, sequence gaps, 500-change batches, payload limits, fixed pull
  heads, and own-device exclusion.
- Removed the package-specific D1 conformance suite. Its old application,
  table, and scope scan shapes are not part of the simpler v2 protocol. The v2
  SQL names its required indexes, and the endpoint tests execute those paths.
- Removed all 55 tracked `packages/local-sync` files and its generated build,
  dependency, and test-result directories.
- Removed the package Vitest project and stopped loading its migration into the
  server test database.
- Regenerated `bun.lock`. This removed the local-sync workspace entry and its
  now-unused SQLite WASM and Bun type dependencies.
- Removed the stale benchmark link and updated earlier plan references to point
  to the production v2 implementation and tests.
- Passed 67 server tests, 610 client tests, `bun run build`, `bun run lint`, and
  targeted formatting checks. The repository-wide formatting check still
  reports 63 pre-existing files outside this change.

### 10. Deploy the new server path without switching clients — Complete

Production deployment order:

1. Back up D1.
2. Apply the new table migration.
3. Deploy the v2 endpoints.
4. Leave old clients on the old endpoints.
5. Run small authenticated push/pull smoke checks against v2.

This gives the new protocol a production validation point before the client cutover.

Completed on 2026-08-29:

- Checked the freeze immediately before the first production write. One legacy
  sync row had arrived after the earlier snapshot, increasing `sync_data` from
  45,975 to 45,976 rows.
- Made a fresh verified pre-migration backup at
  `backups.local/d1/2026-08-29T15-34-17Z/reader-db.sqlite`. It contains 46,086
  application-owned rows and has SHA-256
  `f0977e9ae6854e26b0946180eaa658857bdffb60090fdc468d5cc4dbd711d0dc`.
- Applied additive migration `0006_clean_santa_claus.sql` to `reader-db`.
  Confirmed that no migration remains pending, `sync_records` exists with both
  required indexes, the table starts empty, and the legacy table is unchanged.
- Preserved the exact client assets from production Worker version
  `a81830b1-d777-4b24-8fb3-f1bf49d04ac7` while deploying the current server
  bundle. Wrangler reported that there were no updated asset files to upload.
- Deployed Worker version `d7130808-a7a7-4ce6-b691-55a40daf38a2` to 100% of
  production traffic. The earlier Worker version remains available for server
  rollback.
- Confirmed that unauthenticated v2 push, v2 pull, and legacy pull requests all
  return `401`, which verifies that all three routes are active behind the
  authentication boundary.
- Used a temporary Better Auth account for the authenticated production smoke
  test. A v2 push was accepted at sequence 1, bootstrap pull returned the row,
  incremental pull excluded the requesting device and advanced to the head,
  and the legacy pull route returned `200`.
- Deleted the exact temporary account after the smoke test. Its account,
  session, and single v2 row cascaded with it. Final verification found zero
  temporary users, zero temporary records, zero total `sync_records`, and all
  45,976 legacy rows intact.
- Fetched the production index again after deployment and confirmed that it is
  byte-for-byte identical to the pre-deployment client index. No v2 seed or
  client cutover occurred.

### 11. Export, transform, and seed production data — Complete

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

Completed on 2026-08-29:

- Confirmed that the freeze held before seeding. Production and the immutable
  backup matched on 45,976 legacy rows, 45,959 active rows, 17 deleted rows,
  maximum server timestamp, payload bytes, and every per-table count. The v2
  table was empty.
- Used the fresh pre-migration snapshot at
  `backups.local/d1/2026-08-29T15-34-17Z/reader-db.sqlite` as the immutable
  source. The one row added after the first backup was a retained
  `readingSessions` row.
- Generated a read-only 959-statement seed at
  `backups.local/d1/2026-08-29T15-34-17Z/sync-v2-seed.sql`, SHA-256
  `89218349e9b43e94af1a1305632f9fd1476df963326d154025cb1e3faf0d0f90`,
  plus a verification report with SHA-256
  `143af8cbdcc91dd896ab18470abaebbfa1c6bb7e06dc9b7e603cc5c3815470f3`.
- Transformed 45,976 source rows into 959 unique v2 records: 942 active and 17
  soft-deleted. Excluded all 45,017 deprecated `readingProgress` log rows and
  retained 27 books, 481 highlights, 32 reading checkpoints, 382 reading
  sessions, and 37 reading-state records.
- Retained every inferred and native reading session while removing the old
  session `source` label. The source contained no `readingSettings` rows;
  retained `readingState` and compacted checkpoints cover reading status and
  progress. No settings record could be seeded because none existed.
- Applied the seed through Wrangler's D1 import path. It processed all 959
  statements successfully at bookmark
  `00000343-000001a0-000050d6-62882a45d9e89f64d1765a183436161e`.
- Verified 959 distinct logical keys, valid JSON keys and values, schema version
  1 on every row, 942 active rows, and 17 tombstones with retained non-null
  values. The records use server sequences 2 through 960; sequence 1 is the
  expected gap from the cleaned-up Step 10 smoke record.
- Joined every retained source row to production and confirmed matching IDs,
  devices, HLC wall times and counters, deletion flags, payload deletion flags,
  and all retained domain fields. Representative values from every migrated
  table decoded correctly.
- Confirmed that all 27 book file hashes and cover hashes still match the
  legacy metadata. The 54 blob metadata rows, all 45,976 legacy sync rows, old
  endpoints, and old client remain unchanged. No client cutover occurred.

### 12. Deploy the new client and bootstrap — Complete

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

Completed on 2026-08-30:

- Rechecked the production freeze before the client rollout. The legacy table
  still contained 45,976 rows, the v2 table still contained 959 records with
  head 960, and blob metadata still contained 54 rows.
- Built committed source `4123e30` in an isolated directory. This excluded the
  four unrelated unstaged Library and book-action files in the main checkout.
- The first isolated build omitted the Git-ignored `.env.production` file and
  compiled the auth client with its localhost fallback. Worker version
  `cf337ff0-049c-4255-85bb-a6763403cf35` was superseded immediately. No
  authenticated client sync occurred and production data did not change.
- Rebuilt the same committed source with the existing production environment
  file. Confirmed that the client contains `https://reader.zsheng.app` and no
  localhost auth URL.
- Deployed corrected Worker version
  `971ac418-ceaf-48f2-a387-8a4daab45ae9`. Production serves
  `assets/index-DjlLnChf.js`, and the production index is byte-for-byte equal
  to the isolated build with SHA-256
  `daffa21a497d682997b08e4476393a6c843894b85297e486ef4837035ff2d32c`.
- Confirmed that the corrected JavaScript asset returns `200`, unauthenticated
  v2 pull still returns `401`, and the v2, legacy, and blob row counts remain
  unchanged.
- After sign-in, the first bootstrap exposed a migration defect: books and
  session totals loaded, but Continue Reading and Highlights were empty. The
  932 entity-scoped legacy rows kept `bookId` in `sync_data.entity_id`, not in
  their JSON payloads. The original migration had omitted that column.
- Updated the migration to restore `bookId` for highlights, checkpoints,
  sessions, reading state, and notes. Added a replacement-seed mode that gives
  repaired winners new server sequences and a synthetic device ID, so every
  existing client can pull the correction without own-device filtering.
- Passed seven migration tests, including the production-shaped row counts,
  required parent IDs, and replacement sequence behavior. Passed all 28
  sync-v2 client tests and the production build.
- Created a fresh immutable pre-repair backup at
  `backups.local/d1/2026-08-29T16-17-22Z/reader-db.sqlite`, SHA-256
  `4e121a0460f9162be5ac3feb18ee7b00ee81100e7e4c8f72a590295a76236fda`.
- Generated and locally applied the 959-statement repair artifact
  `sync-v2-entity-repair.sql`, SHA-256
  `e390acbc82dbe06267dec17f85e870ccb5332aa8134d2bb7c7349a1bd335986b`.
  Local verification found 959 logical records, 932 restored parent IDs, zero
  parent mismatches, and no retained legacy session source fields.
- Applied the repair to production at bookmark
  `00000346-00000199-000050d6-55765bd007af1ed852426b716e428288`.
  Production still has 959 logical records: 942 active and 17 deleted. Their
  replacement stream spans sequences 961 through 1919, and every record uses
  repair device `sync-v2-migration-repair`.
- Verified all 481 highlights, 32 checkpoints, 382 sessions, and 37 reading
  states against the legacy entity IDs with zero mismatches. The legacy table
  remains at 45,976 rows and blob metadata remains at 54 rows.
- Chrome pulled the repair through normal incremental sync. Continue Reading
  returned with the expected recent books, Highlights displayed 465 active
  highlights across 19 books, and the user confirmed the Sessions page still
  reports about 128 hours read this year. Reading-state rows occupy the end of
  the repair stream, so their presence also confirms that the client reached
  head 1919. The unchanged server head after the next sync cycle confirms that
  the client had no pending outbox changes.
- The source contained no `readingSettings` row, so there was no server setting
  to migrate. Client-local appearance and reader defaults remain in effect.
- Retrieved one known cover and one known EPUB directly from production R2.
  Both matched their recorded byte sizes; the cover decoded as JPEG and the
  EPUB passed a complete ZIP integrity check. Production Chrome also rendered
  the migrated book covers without errors.
- Used an isolated temporary production account to exercise two devices. The
  smoke test passed bootstrap, deterministic conflict resolution, a rejected
  stale retry, own-device exclusion with cursor advancement, tombstone
  propagation, and an offline-queued mutation pushed after reconnect. Deleted
  the exact temporary account afterward; its account, session, devices, and
  two compacted records cascaded. Production returned to 959 v2 records with
  head 1919.

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
12. Remove the local-only `readingProgress` table and its dormant writers and
    backfill helpers.

The implementation uses five review units: server v2, client substrate,
application data-model cutover, migration tool, and final cleanup.

### Final cleanup execution — Complete

Completed on 2026-08-30:

- Removed the unused legacy client sync engine, HLC middleware, table schema
  generator, adapters, migration helpers, progress-history utilities, and
  their obsolete tests.
- Preserved `src/lib/sync-service.ts` and `src/hooks/use-sync.ts` because these
  files now provide the active sync v2 lifecycle and UI state.
- Removed the dormant local `readingProgress` model, writers, query helpers,
  checkpoint/session backfills, and migration debug page. Dexie schema version
  2 deletes the physical store while preserving every active v2 table.
- Added an idempotent startup deletion for the pre-v2 `epub-reader-db`
  database.
- Removed the legacy table-scoped server routes and implementation. Removed
  `syncData` from the Drizzle schema and generated migration
  `0007_curved_gauntlet.sql`, which contains only `DROP TABLE sync_data`.
- Removed the completed one-time v2 migration CLI and retained its full source
  and tests in Git history. The immutable production SQLite backups and seed
  artifacts remain outside the repository.
- Replaced the old sync RFC with a short description of the implemented v2
  contract.
- Applied the drop migration to a writable copy of the pre-repair production
  backup. It removed all 45,976 legacy rows, retained all 959 v2 records, and
  produced zero foreign-key violations.
- Passed 502 tests across 74 files, the production build, and lint. Targeted
  formatting for the cleanup files also passed. The repository-wide format
  check still reports unrelated pre-existing files, including an unstaged user
  edit, so it was not used to rewrite the whole checkout.
- Committed the code cleanup as `f0f11eb` and built that exact commit in an
  isolated production worktree. Deployed Worker version
  `e1335f70-29bd-4b00-866d-88f61772a28b`, serving
  `assets/index-9K1wuVKV.js`. The deployed index and JavaScript asset matched
  the isolated build with SHA-256 values
  `cb9f9f0e06630cdd1a12b0458fc4a394e6adbc88142ca1d8a64875a72821150b`
  and
  `90edf3b65b15444097538400d73966d9250bf0fd8ed507620f074a1aad8a140e`.
- Verified the authenticated production client before the database cleanup.
  Library displayed Continue Reading, Highlights displayed 465 active
  highlights across 19 books, and Sessions displayed current reading history.
- Applied `0007_curved_gauntlet.sql` to production. Wrangler captured its own
  pre-migration backup, and the migration removed only `sync_data`.
- Verified the post-migration database: `sync_data` is absent; `sync_records`
  contains 962 compacted records at server head 1930 with 17 tombstones;
  `file_storage` still contains 54 rows; and the foreign-key check returned no
  violations. The increase from the original 959 records and head 1919 was
  normal application activity before final cleanup.
- Reloaded the authenticated Library and Highlights pages after the table drop.
  Continue Reading, book data, the 465-highlight count, and highlight cards
  remained present. The v2 pull endpoint still requires authentication with a
  `401`; both removed legacy endpoints return `404`.
- Retained the immutable production SQLite backup at
  `backups.local/d1/2026-08-29T16-17-22Z/reader-db.sqlite`, SHA-256
  `4e121a0460f9162be5ac3feb18ee7b00ee81100e7e4c8f72a590295a76236fda`.
  Git history retains the old implementation and one-time migration tooling.

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

### 3. Add the new Hono endpoints

Add versioned routes in [server/index.ts](/Users/admin/epub-reader-demo/server/index.ts:205), while the old `/api/sync/:table` routes remain active:

```text
POST /api/sync/v2/push
POST /api/sync/v2/pull
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

Copy the important conformance tests from [local-sync-d1-conformance.test.ts](/Users/admin/epub-reader-demo/test/server/local-sync-d1-conformance.test.ts:62). Test:

- 500-row batches.
- One-megabyte batches.
- LWW acceptance and rejection.
- AUTOINCREMENT gaps.
- Transaction rollback.
- Bootstrap device inclusion.
- Incremental device exclusion.
- High-water advancement.
- Pagination while new writes arrive.

### 4. Create the new client database

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

### 5. Add transparent Dexie mutation interception

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

### 6. Build the client sync loop

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

Replace the existing provider and service usage starting at [App.tsx](/Users/admin/epub-reader-demo/src/App.tsx:16). Keep the current public hook shape where this reduces application changes.

### 7. Convert the application to clean domain types

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

### 8. Build and dry-run the migration tool

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

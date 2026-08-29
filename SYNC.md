# Sync v2

The reader uses a small local-first synchronization protocol. The client owns
the application schema. The server stores opaque keys and values and resolves
last-write-wins conflicts.

The production migration and rollout record is in `NEW_SYNC_PLAN.md`.

## Server record

Cloudflare D1 stores one current winner for each `(user_id, key)` pair in
`sync_records`:

- `server_seq`: Monotonic sequence assigned when the winner changes.
- `user_id`: Authenticated Better Auth user.
- `key`: Opaque client key. The current client encodes `[tableName, recordId]`
  as JSON text.
- `value`: Opaque client value. Schema version 1 uses JSON text.
- `schema_version`: Client value format version.
- `hlc_wall_time_ms` and `hlc_counter`: Hybrid logical clock.
- `device_id`: Trusted device ID from the request header.
- `is_deleted`: Soft-delete state.

The server does not decode application values. It validates only the transport
schema and size limits.

## HTTP contract

Both routes require an authenticated session and `X-Device-ID`.

### Push

`POST /api/sync/v2/push`

```json
{
  "changes": [
    {
      "key": "[\"books\",\"book-id\"]",
      "value": "{\"id\":\"book-id\",\"isDeleted\":false}",
      "schemaVersion": 1,
      "hlc": { "wallTimeMs": 1788022118058, "counter": 0 },
      "isDeleted": false
    }
  ]
}
```

The server compares `(wallTimeMs, counter, deviceId)`. The larger tuple wins.
Each result states whether the candidate was accepted and returns the current
winner. A winning update receives a new `server_seq`.

Limits:

- 500 changes per push.
- 1,024 UTF-8 bytes per key.
- 64 KiB per value.
- 1 MiB encoded request body.
- A client HLC can be at most five minutes in the future.
- A push batch cannot contain duplicate keys.

### Pull

`GET /api/sync/v2/pull?cursor=0&excludeOwnDevice=false`

Optional query parameters are `head` and `limit`. The maximum page size is 500.

The first page fixes a stream head. Later pages use that same head, so a pull
has a stable boundary while new writes continue. A partial page advances the
cursor to its last returned sequence. A complete page advances directly to
the fixed head, including when filtered records produced an empty page.

Bootstrap requests include all devices. Incremental requests can exclude rows
whose winner came from the requesting device. The cursor still advances past
those rows.

## Client persistence

Dexie database `epub-reader-db-v2` stores clean domain rows:

- Synced: books, reading checkpoints, reading sessions, highlights, reading
  settings, reading state, and notes.
- Local only: extracted book files, content-addressed files, transfer tasks,
  text caches, and chapter source caches.
- Internal: `_sync_outbox`, with one compacted pending change per logical key.

The active schema is version 2. Its upgrade removes the deprecated local
`readingProgress` store. Application startup also deletes the pre-v2
`epub-reader-db` database.

Small sync state lives in localStorage under `epub-reader-sync-v2-state`:

- Device ID.
- Last HLC value.
- Pull cursor.
- Bootstrap completion state.

## Local writes

The application Dexie connection installs one mutation middleware for synced
tables. In the same IndexedDB transaction, the middleware:

1. Writes the domain row.
2. Allocates an HLC value.
3. Serializes the row as JSON.
4. Replaces the logical key in `_sync_outbox`.

Deletes become retained rows with `isDeleted: true`. Local-only tables do not
produce outbox entries.

HLC state is persisted outside IndexedDB. A failed transaction can leave an
unused HLC value. This gap is safe because clocks require monotonic order, not
contiguous counters.

## Remote writes and conflicts

The sync engine uses a separate Dexie connection without mutation middleware.
Remote rows therefore do not return to the outbox.

A full run pulls before it pushes:

1. Pull a fixed-head stream page.
2. Decode known client keys and values.
3. Compare each remote winner with any pending local outbox value.
4. Apply eligible remote rows through the raw connection.
5. Advance the pull cursor.
6. Push a snapshot of the compacted outbox in batches.
7. Apply returned winners and remove only unchanged sent outbox entries.

If a local write occurs while a push is in flight, its newer outbox value is
not removed by reconciliation.

## Files

EPUBs and covers are not sync values. They use R2 plus `file_storage` metadata
and are cached locally by content hash. Large values must use this file path,
not `sync_records`.

## Adding a synced table

1. Add the domain interface and Dexie table to `src/lib/sync-v2/db.ts`.
2. Add the table name to `SYNC_V2_SYNCED_TABLES`.
3. Add application query helpers in `src/lib/db.ts`.
4. Add focused middleware and sync tests.

No server schema change is required for a new client table.

## Verification

```sh
bun run test:client
bun run test:server
bun run build
bun run lint
bun run format:check
```

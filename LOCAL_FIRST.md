# Local-first data that stays fast

A reusable guide from the EPUB Reader and Arctic. Read this before designing a
new app's storage or sync. The [architecture guide](docs/ARCHITECTURE.md) defines
this repository's current rules.

## Start with three kinds of data

| Kind | Examples | Storage rule |
| --- | --- | --- |
| User records | Saved items, notes, highlights, reading sessions | Durable local rows; sync changes independently of the UI |
| Files | Original EPUB, cover, saved article HTML | Separate bytes; records hold file references |
| Derived data | Parsed chapters, layout, thumbnails, search projections | Rebuildable caches with clear input identity |

A library row must not require an EPUB or a large HTML body to load. A note edit
must not rewrite all article bodies. Keep secrets, including Jev keys, out of
synced records. A cache can be removed; a user's only local copy cannot.

## Make the local commit the point of success

The web Reader uses [`@zsh-eng/local-sync`](packages/local-sync/README.md):

1. The app writes ordinary domain rows to IndexedDB.
2. Dexie middleware writes those rows and their outbox changes in **one
   transaction**. An outbox keeps the latest pending change for each record.
3. The UI reads committed local state. It does not wait for authentication or
   an upload to finish before showing locally available content.
4. The sync engine sends pending changes to authenticated Hono/D1 routes. The
   server stores opaque values, versions and deletion markers.
5. Pull applies winners through a separate raw database connection, so remote
   changes do not create another upload. The cursor advances only after the
   local write succeeds.

Keep two failure states distinct: **not saved locally** and **saved locally,
waiting to sync**. The second is normal offline operation.

The package owns protocol and reconciliation. The app owns domain validation,
authentication, account identity, migrations, lifecycle and UI invalidation.
Give each independent account its own local database and sync-state namespace.
Cancel old account work before switching owners; checking only the current
screen is insufficient.

## Preserve edits made during a request

Suppose an upload sends note version A, then the user writes version B. When A
is acknowledged, clear only A's submitted version. B must remain queued. The
[Dexie adapter](packages/local-sync/src/dexie/storage.ts) makes this comparison
inside its transaction.

Deletion is a versioned tombstone, not immediate removal from the record log.
Otherwise an offline device can bring the deleted record back. Versions use a
hybrid logical clock: wall time, a counter and device identity determine a
stable order. This is record-level conflict resolution, not a text merge or a
cross-device transaction across several records.

The current protocol has limits: 500 records per batch/page, 64 KiB per value
and 1 MiB per encoded push body. It does not provide server-reset recovery,
tombstone expiry or retained versions for acknowledged local rows. Do not add
cleanup policies that assume these features exist.

## Transfer files separately

[`FilesManager`](src/lib/files/files-manager.ts) stores local bytes and durable
upload intent together. `put()` does not wait for the network. `get()` checks
local bytes, shares an existing download for the same file ID, then downloads
only if needed. The app chooses which file is needed next; the file service
does not need to know what a book or article is.

Keep original source files when the product promises them. Generate compact
covers separately: the web Reader stores a maximum-480 px WebP plus BlurHash;
Arctic uses native image codecs and display-sized derivatives. See
[UI performance](UI_PERFORMANCE.md#keep-four-image-representations-distinct).
A tiny placeholder is optional metadata, not a replacement for the image.

## Prepare the next interaction

Use three priorities: visible content, a small nearby range, then background
completion. Prefetch and visible reads must use the **same cache key and shared
work**. Include the document/source version and layout inputs in derived keys.
Reject a completed task if its owner or source has changed.

Keep reusable data in memory as well as on disk. A disk cache still needs reads,
decode and layout after each open. Cache sorted library projections and ID
indexes until their input revision changes. Do not query the whole database or
sort every item for each row entering the viewport.

Bound each expensive stage separately: network, decode, database writes and UI
publication. Batch small writes; publish changes at a rate the UI can absorb.
Pause optional work during a gesture rather than blocking the gesture. Increasing
HTTP concurrency will not fix a main-thread encoding bottleneck.

For large restores, overlap fetching the next batch with one ordered writer.
The sync package supports optional streaming pull with one-page lookahead and
checks for truncated streams. The web Reader's current transport still uses
paginated pull; a package capability is not proof that an app has enabled it.

## What is active here

| App | Current state |
| --- | --- |
| Web EPUB Reader | IndexedDB domain rows, atomic outbox, shared record-sync engine, separate local files/upload queue |
| Native Arctic | Local article storage and file caches; the staged native sync repository is **not connected to the live ArticleStore** |

Native sync activation remains a separate migration and validation task. Its
current staged JSON journal rewrites a snapshot. A measured one-item edit with
10,000 articles took about 320 ms on a Mac; JSON encoding dominated. Moving
that journal to SQLite is proposed, not implemented. See the
[native measurements and migration boundary](article-reader/Sync/PERFORMANCE.md).
These guides do not authorize that migration.

## Checks worth reusing

Test a local edit offline, restart before upload, edit again during upload,
receive an older remote value, delete on one device, fail a pull write, and
switch accounts with a request in flight. Verify both visible state and stored
rows. Test file upload failure separately from record sync failure.

Start with the [package contract and tests](packages/local-sync/README.md),
[Reader sync tests](test/client/sync-v2-sync.test.ts),
[file tests](test/client/files-manager.test.ts) and
[table definitions](src/lib/sync-v2/tables.ts). Add a new entity through the
existing domain/table/codec boundary; do not add a dedicated server route for
each record type.

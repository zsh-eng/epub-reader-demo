# New Files Implementation Plan

**Status**: Proposed

**Last updated**: 2026-08-30

This file is the implementation record for the new local-first files system and
the EPUB-specific materialization flow. Update the status and completed work
after each slice lands.

## Scope

The application has two different kinds of large data:

- Original EPUB archives are canonical opaque files. They belong in the files
  system and R2.
- Small optimized book covers are application data needed during bootstrap.
  They belong in an explicit synced `bookCovers` table.

Do not automatically redirect a large synchronized value to file storage. The
application must choose whether a value is a synced row or an opaque file.

## Fixed decisions

- `FileId` is opaque to domain code. The files implementation derives it with
  xxHash and uses it for local deduplication and remote identity.
- The first wire form is `xxh64:<16 lowercase hexadecimal characters>`. Only
  the files implementation parses or constructs this value.
- `files.put()` completes after the bytes and upload operation are durable
  locally. It does not wait for the network.
- `files.get()` and `files.ensureLocal()` return local bytes when present and
  otherwise download them.
- Local files are durable. The application does not evict them automatically.
- The cloud is an intermediary that lets devices converge toward a complete
  local copy.
- The download system has no numeric priority scheduler. Callers control order
  by awaiting explicit phases. The files service only deduplicates concurrent
  requests.
- The remote files API supports inventory and explicit deletion. It does not
  prevent deletion when Books still refer to a file.
- An EPUB is already a ZIP archive. Store its original bytes remotely. Do not
  store expanded EPUB entries, normalized HTML, fonts, or reader caches in R2.
- Book covers are resized application derivatives. Store them as base64 in
  separate synchronized rows, not in the generic files system.
- `Book` stores `sourceFileId`. It does not store a content hash,
  `coverContentHash`, or `isDownloaded`.
- EPUB expansion and normalized reader sources are local materializations with
  an explicit recipe version and completion marker.

## Measured cover constraints

The local corpus at `/Users/admin/Desktop/epubs` contains 41 top-level EPUBs.
Forty raster cover images were valid inputs to `cwebp`; one EPUB's fallback
cover manifest entry referred to HTML rather than an image.

The installed encoder is `cwebp 1.6.0`. The following results use quality 80,
method 6, and preserve aspect ratio:

| Maximum width | Median WebP | p90 WebP | Largest WebP | Total for 40 |
| --- | ---: | ---: | ---: | ---: |
| 320 px | 18,483 B | 32,948 B | 50,186 B | 885,588 B |
| 384 px | 26,613 B | 46,878 B | 71,776 B | 1,196,652 B |
| 480 px | 35,488 B | 70,876 B | 108,408 B | 1,684,618 B |

The sync protocol uses JSON. Binary image bytes therefore need base64, which
adds approximately one third to their size. A representative cover row with
base64 data produced these encoded JSON value sizes:

| Maximum width | Median JSON value | p90 JSON value | Largest JSON value | Fits 128 KiB |
| --- | ---: | ---: | ---: | ---: |
| 320 px | 24,742 B | 44,028 B | 67,012 B | 40 of 40 |
| 384 px | 35,582 B | 62,600 B | 95,800 B | 40 of 40 |
| 480 px | 47,414 B | 94,600 B | 144,640 B | 38 of 40 |

Use 384 px and quality 0.8 as the initial cover recipe. Target a maximum
encoded sync value of 112 KiB so every cover retains headroom below the 128 KiB
protocol limit. If a cover exceeds the target, reduce quality and then reduce
width until it fits.

A local Chromium probe successfully used `HTMLCanvasElement.toBlob()` to turn a
916 x 1186 JPEG into a 384 x 497 WebP of 25,334 bytes. The browser reported the
result as `image/webp`. A WASM WebP encoder is therefore not required for the
first implementation.

Requested canvas formats can fall back to PNG when an encoder is unavailable.
The implementation must check the returned Blob's MIME type. Use browser-native
WebP when available and browser-native JPEG as the fallback. Do not add a WASM
dependency unless physical Safari testing shows that both native paths fail the
size or quality requirement.

## Proposed implementation order

### 1. Freeze the public contracts and invariants

Add an opaque TypeScript ID and one small public service:

```ts
declare const fileIdBrand: unique symbol;

export type FileId = string & {
  readonly [fileIdBrand]: true;
};

export interface Files {
  put(blob: Blob, metadata?: FileMetadata): Promise<FileId>;
  get(id: FileId): Promise<Blob>;
  hasLocal(id: FileId): Promise<boolean>;
  ensureLocal(id: FileId): Promise<void>;
  listLocal(): Promise<LocalFile[]>;
  listRemote(): Promise<RemoteFile[]>;
  deleteRemote(id: FileId): Promise<void>;
}
```

Contract details:

- `put()` calculates xxHash internally and returns the same ID for the same
  bytes.
- The server recalculates xxHash for every upload and rejects an ID that does
  not match the uploaded bytes.
- `put()` atomically stores the local Blob and records an upload operation.
- `get()` returns the local Blob or performs one foreground download.
- Concurrent `get()` or `ensureLocal()` calls for one ID share one promise.
- A completed download remains local.
- A remote deletion leaves local bytes untouched.
- A later explicit `put()` can publish previously deleted bytes again.
- Callers can run bounded batches, but the service has no domain priority.

Write focused contract tests before replacing existing call sites.

### 2. Make sync v2 safe for 128 KiB values

Change the maximum **value** size from 64 KiB to 128 KiB. Keep the maximum key
size at 1 KiB. Covers are values; they are not large keys.

The current client divides pushes by record count only. That is insufficient
when one value can be 128 KiB while the total push body remains 1 MiB.

Implement byte-aware batching:

1. Preserve the 500-change count limit.
2. Preserve the 1 MiB push-body limit.
3. Add changes to a batch until the next change would exceed either limit.
4. Always permit one valid record in a batch.
5. Test mixed small rows and near-limit cover rows.

Add a pull-response byte limit as well. Return the largest ordered prefix that
fits the count and response-byte limits. Advance the cursor to the final record
actually returned. Keep the existing fixed-head pagination guarantee.

Test:

- Values at and immediately above 128 KiB.
- Several cover rows that together exceed 1 MiB.
- Push-result reconciliation across byte-sized batches.
- Pull pagination split by bytes rather than count.
- Bootstrap with Books and all covers.
- A single near-limit record making forward progress.

### 3. Add the synchronized Book cover model

Add one application-owned synchronized table:

```ts
export interface BookCover {
  id: string; // Same stable ID as bookId
  bookId: string;
  mediaType: "image/webp" | "image/jpeg";
  width: number;
  height: number;
  dataBase64: string;
}
```

The sync middleware adds the ordinary `isDeleted` field. Use one row per Book,
with `id === bookId`, so the Library can bulk-read covers by Book ID without a
second reference scheme.

Add `bookCovers` to:

- The sync v2 table registry.
- The application and raw sync Dexie connections.
- Book deletion transactions.
- Normal query filtering.
- Sync-loop tests for pull, push, conflict resolution, and deletion.

Do not inline the base64 cover in the Book row. A title or status edit must not
resend or conflict with the image bytes.

### 4. Build the browser cover encoder

Implement an application-level `encodeBookCover()` function. It is not part of
the generic files service.

Initial recipe:

1. Decode the extracted EPUB cover Blob.
2. Preserve aspect ratio and resize to a maximum width of 384 px.
3. Encode WebP at quality 0.8 with canvas.
4. Confirm that the returned MIME type is `image/webp`.
5. If WebP output is unavailable, encode JPEG and confirm `image/jpeg`.
6. Create the complete `BookCover` row and measure `encodeSyncValue(row)` in
   UTF-8 bytes.
7. If it exceeds 112 KiB, lower quality in fixed steps.
8. If it still exceeds 112 KiB, reduce maximum width to 320 px.
9. Fail import with an explicit error if no valid output fits 128 KiB.

Use `OffscreenCanvas` when the runtime supports the complete decode, draw, and
encode path. Keep an `HTMLCanvasElement` fallback. First implement and measure
the simple browser-native path; move it to a Worker only if import profiling
shows visible main-thread blocking.

Add fixtures that cover:

- Large JPEG input.
- PNG input.
- Portrait and landscape input.
- Unsupported WebP output with JPEG fallback.
- Adaptive quality or width reduction.
- Exact encoded JSON size validation.
- Image decode failure.

Do not assert byte-for-byte encoder output because browser encoders can differ.
Assert dimensions, MIME type, successful decode, and the maximum encoded value.

### 5. Replace the local files tables and service

Use a new Dexie schema version. Replace `StoredFile`, `FileType`, and the
priority-based transfer queue with explicit local records:

```ts
export interface LocalFile {
  id: FileId;
  blob: Blob;
  mediaType: string;
  size: number;
  storedAt: number;
  remotePresent: boolean;
}

export interface FileUploadOperation {
  id: FileId;
  createdAt: number;
  retryCount: number;
  lastError?: string;
}
```

Rules:

- The `files` and `fileUploadOperations` tables are local-only.
- `put()` writes the file and upload operation in one transaction.
- If the same ID is already local, retain one Blob.
- If the existing row is known to be remote, do not enqueue another upload.
- A successful upload sets `remotePresent = true` and removes its operation in
  one transaction.
- `get()` downloads directly when the Blob is absent, stores it with
  `remotePresent = true`, and returns it.
- Failed foreground downloads are retried by the next caller. They do not need
  a persistent download queue.
- The upload worker resumes after authentication and reconnect.
- The service does not scan remote inventory and recreate uploads for local
  rows after an explicit remote deletion.

Keep local-size and inventory helpers. Remove last-accessed, pinning, eviction,
and numeric priority concepts.

### 6. Replace the remote files API and catalog

Add a new server table and API alongside the old path during rollout. The
generic catalog should not contain application roles such as `epub` or
`cover`.

Suggested catalog:

```text
files_v2
  id           TEXT NOT NULL
  user_id      TEXT NOT NULL
  r2_key       TEXT NOT NULL
  file_size    INTEGER NOT NULL
  media_type   TEXT NOT NULL
  created_at   INTEGER NOT NULL
  deleted_at   INTEGER

  PRIMARY KEY(user_id, id)
```

Suggested endpoints:

```text
PUT    /api/files/v2/:fileId
GET    /api/files/v2/:fileId
GET    /api/files/v2
DELETE /api/files/v2/:fileId
```

Server rules:

- Authenticate every request.
- Recalculate xxHash during upload and require it to match `fileId`.
- Write the R2 object before inserting the active catalog record.
- Treat the same user and file ID as an idempotent upload.
- Return immutable cache headers for downloads.
- List only the current user's active records.
- Delete without inspecting opaque synchronized Book values.
- A failed D1 insert can leave an unreferenced R2 object. Inventory repair can
  remove such objects later.

Use user-scoped R2 keys. Do not add cross-user deduplication.

### 7. Convert Book and EPUB import

Replace the current Book storage fields:

```text
fileHash         -> sourceFileId
coverContentHash -> remove
isDownloaded     -> remove
```

New import flow:

```text
files.put(original EPUB)
  -> get opaque sourceFileId
  -> find active Book by sourceFileId
  -> return the existing Book when found
  -> parse EPUB metadata when new
  -> encode and store the synced BookCover row
  -> store the Book domain row
  -> materialize the EPUB locally
```

The EPUB import service must not call upload routes, build transfer tasks, or
handle content hashes. `files.put()` owns those actions.

Create the Book and BookCover in one application transaction after parsing and
cover encoding succeed. The original EPUB can remain as an unreferenced local
file if later application work fails; `listLocal()` makes that state visible.

### 8. Add deterministic local EPUB materialization

Add a local-only completion table:

```ts
export interface BookMaterialization {
  bookId: string;
  sourceFileId: FileId;
  recipeVersion: number;
  completedAt: number;
}
```

Expose one EPUB-specific operation:

```ts
ensureBookMaterialized(book: Book): Promise<void>;
```

Algorithm:

1. Read the marker.
2. Return when `sourceFileId` and `recipeVersion` match.
3. Call `files.get(sourceFileId)`.
4. Extract the EPUB.
5. Write deterministic per-path entries and normalized chapter-source data.
6. Write the completion marker last in the same transaction.

A failure leaves no valid marker. The next call replaces partial data and
retries. Do not use “at least one `bookFiles` row exists” as the readiness test.

The first implementation can keep separate physical tables for raw expanded
entries and normalized chapter sources. The caller sees one materialization
operation. Settings-dependent highlights and pagination artifacts remain
runtime reader work.

Do not add remote materialization or remotely expanded EPUB entries. Revisit
random-access ZIP extraction only after measuring the new cold-open path.

### 9. Make bootstrap and background mirroring explicit

The application, not the generic files service, owns sequencing.

Cold-client flow:

1. Complete the initial key-value bootstrap for Books, BookCovers, statuses,
   checkpoints, and other domain rows.
2. Read and decode the cover rows for the initial visible Library group.
3. Reveal the Library atomically.
4. Ensure the most recent Continue Reading EPUB is local and materialized.
5. Ensure remaining Library cover rows are decoded as cards approach the
   viewport.
6. List remote files and ensure other Continue Reading EPUBs are local.
7. Ensure all remaining remote EPUBs are local in bounded batches.

Use direct call order rather than download priorities. A background loop can
process one file or one bounded batch at a time. A user-triggered `get()` starts
immediately and shares any in-flight request for the same ID.

Replace the current unbounded `Promise.all()` prefetch for every Continue
Reading Book. Do not let EPUB download, full extraction, and chapter-source
building for several Books compete with the initial Library reveal.

The steady state is a complete local source-file mirror. Materialize Books when
opened or selected by the application background phase; never evict completed
work automatically.

### 10. Build and dry-run the migration tools

The sync v2 production cutover is complete, so this change needs an explicit
data migration rather than a fresh database assumption.

Local Dexie migration:

- Convert `Book.fileHash` to opaque `sourceFileId` without changing its current
  xxHash identity.
- Remove `coverContentHash` and `isDownloaded` after their replacements exist.
- Convert existing local EPUB file rows to the new `FileId` shape.
- Replace transfer tasks with upload operations only where remote presence is
  not known.
- Create no materialization marker unless all required local outputs are
  complete and current.

Production migration:

1. Back up D1 and record the active legacy file inventory.
2. Create `files_v2` catalog rows for existing EPUB objects without copying R2
   bytes.
3. Read each existing cover, encode the 384 px synchronized derivative, and
   verify its exact JSON value size.
4. Seed one `bookCovers` sync record per valid cover.
5. Rewrite each Book value from `fileHash` to `sourceFileId` and remove
   `coverContentHash` and `isDownloaded`.
6. Give rewritten rows valid newer HLC versions and fresh server sequences.
7. Verify Book-to-source relationships, cover decode, row counts, tombstones,
   and maximum value sizes.

The migration must produce a deterministic report before it writes production.
Do not log EPUB contents or base64 cover data.

### 11. Deploy and cut over

Use a short personal-app write freeze:

1. Back up D1 and the file catalog.
2. Deploy the 128 KiB sync limit, byte-aware batching, and byte-aware pull
   pagination.
3. Apply the additive `files_v2` migration and deploy its endpoints.
4. Run authenticated sync and file API smoke tests.
5. Run and verify the production data migration.
6. Deploy the new client database schema, files service, Book model, cover
   table, and materialization flow together.
7. Bootstrap one clean browser profile.
8. Verify Library reveal, cover decode, Continue Reading preparation, EPUB
   retrieval, offline reading, reconnect upload, and eventual full mirroring.
9. Import the same EPUB twice and verify that one Book and one local source file
   remain.
10. Verify `listRemote()` and one intentional remote deletion.

Do not run old and new file upload workers concurrently after client cutover.

### 12. Keep a rollback window and then clean up

During the rollback window, retain:

- The old `file_storage` catalog.
- Existing R2 object keys.
- Old file endpoints.
- Old local Dexie tables.
- The production migration report.

After verification:

1. Remove `FileManager`, `FileStorage`, `FileRemoteAdapter`, and
   `TransferQueue`.
2. Remove `FileType`, `Priority`, legacy transfer types, and old hooks.
3. Remove `fileHash`, `coverContentHash`, and `isDownloaded` application use.
4. Remove the old file routes and helpers.
5. Remove the old catalog only after the new inventory matches it.
6. Delete legacy standalone cover objects after every synchronized BookCover
   has been decoded and verified.
7. Keep canonical EPUB R2 objects and their existing bytes.
8. Update `NEW_SYNC_PLAN.md`, `ROADMAP.md`, and architecture documentation to
   describe covers as synced application rows and EPUBs as opaque files.

## Review units

Use these review units:

1. Sync size and pagination changes.
2. Synced BookCover model and browser encoder.
3. Local and remote generic files service.
4. Book/import/materialization cutover.
5. Bootstrap orchestration and performance validation.
6. Migration, production cutover, and cleanup.

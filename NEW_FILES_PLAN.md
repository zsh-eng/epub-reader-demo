# New Files Implementation Plan

**Status**: Proposed

**Last updated**: 2026-08-30

This file is the implementation record for the new local-first files system and
the EPUB-specific materialization flow. It supersedes the earlier proposal to
store cover image bytes in synchronized key-value rows.

## Scope

The application has two binary file classes:

- The original EPUB archive is the canonical source file.
- A 480 px WebP cover is a small application-generated derivative.

Both classes use the same generic files API and remote object storage. The sync
system stores only domain metadata, opaque file references, and a small
BlurHash placeholder.

```text
synchronized Book row
  -> sourceFileId --------> files API --------> original EPUB
  -> cover.fileId --------> files API --------> 480 px WebP
  -> cover.blurHash ------> inline placeholder only
```

Do not automatically redirect a large synchronized value to file storage. The
application must explicitly choose whether data is a synchronized value or an
opaque file.

## Fixed decisions

- Keep the sync value limit at 64 KiB and the key limit at 1 KiB.
- Do not store cover image bytes or base64 image data in synchronized values.
- The only inline image-pixel representation is a BlurHash string. The Book
  value also needs the opaque file reference that lets clients fetch the WebP.
- Store each optimized cover as a 480 px WebP through the generic files API.
- Use the existing local `files` table and server `file_storage` catalog as the
  migration targets. Do not create parallel v2 file tables.
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
  store expanded EPUB entries, normalized HTML, fonts, or reader caches in
  remote object storage.
- `Book` stores opaque source and cover file references. It does not expose
  hashes as domain concepts and does not store `isDownloaded`.
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

The 480 px result is small enough for cover downloads and startup decoding. It
also retains more detail than the 320 px and 384 px outputs.

The 1.68 MB total is compressed transfer and storage size, not decoded bitmap
memory. A representative 480 x 700 RGBA bitmap uses about 1.3 MB after decode.
Keep every compressed WebP locally, but let the browser retain decoded pixels
for active cards instead of holding a manual decoded bitmap for every Book.

Base64 would add approximately one third to the image size before the ordinary
JSON row overhead:

| Maximum width | Median JSON value | Largest JSON value | Fits 64 KiB |
| --- | ---: | ---: | ---: |
| 320 px | 24,742 B | 67,012 B | 39 of 40 |
| 384 px | 35,582 B | 95,800 B | 36 of 40 |
| 480 px | 47,414 B | 144,640 B | 27 of 40 |

This confirms that cover bytes do not belong in sync. At 480 px, 13 of the 40
measured covers exceed the existing value limit after base64 and JSON encoding.
The encoded set also grows from 1.68 MB of WebP files to 2.25 MB of JSON values.

Use one fixed cover recipe: a maximum width of 480 px and WebP quality 0.8. Do
not lower quality or dimensions for large outputs. Cover bytes use the files
API and are not constrained by the sync value limit.

A local Chromium probe successfully used `HTMLCanvasElement.toBlob()` to turn a
916 x 1186 JPEG into a 384 x 497 WebP of 25,334 bytes. The browser reported the
result as `image/webp`.

Requested canvas formats can fall back to another format when an encoder is
unavailable. The implementation must check the returned Blob's MIME type. The
stored cover format remains WebP: use native WebP when available and add a
lazy-loaded WebP WASM fallback only if a supported browser cannot encode it.
Do not silently store JPEG or PNG under a WebP file reference.

Use a 4 by 3 component BlurHash. Its encoded value is 28 ASCII characters. It
is small enough to live in the synchronized Book value and is not subject to
the binary cover lifecycle.

## Why the current files tables change

The existing tables are not fundamentally incorrect. The local `files` table
already stores the Blob, MIME type, byte size, and storage time. The server
`file_storage` table already maps user-owned content to an R2 key. Keep those
responsibilities and migrate both logical tables in place.

The current contract has these specific problems:

- Identity is `${fileType}:${contentHash}`. The storage layer therefore knows
  application roles such as `epub` and `cover`, and the same bytes can have
  more than one storage identity.
- Callers calculate and pass both the hash and file type. Hashing and identity
  are exposed throughout Book and reader code instead of remaining inside the
  files API.
- `queueUpload()` stores the Blob and then creates its transfer task in two
  separate IndexedDB transactions. A reload between those writes can leave a
  durable local file with no durable upload intent.
- Foreground `getFile()` downloads directly, while `queueDownload()` uses the
  transfer queue. These paths have separate in-flight and persistence rules.
- The local file row does not record known remote presence. Completed queue
  entries provide this indirectly, but they can be cleared and are not the
  file's durable state.
- `deleteAllForContent()` tries the same content hash with both file types.
  An EPUB and its cover have different hashes, so this is not a valid Book-file
  relationship.
- The server uses a random UUID primary key, but clients address files by
  `fileType + contentHash`. The real external identity and the table identity
  are different.
- The server has upload and download routes, but no user-facing inventory or
  explicit remote deletion contract.
- The server unique constraint includes soft-deleted rows. A future delete and
  re-upload flow must revive the row or change that constraint.

These problems require a contract and schema migration, not a second long-lived
files table. D1 may use a temporary table internally when it changes the
primary key, but the resulting logical table remains `file_storage`.

## Proposed implementation order

### 1. Freeze the public files contract

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

### 2. Keep binary data out of sync

Do not change `MAX_SYNC_VALUE_BYTES`, `MAX_SYNC_KEY_BYTES`, or the server sync
schema for this plan.

Add application serialization tests that require:

- No base64 value or data URL appears anywhere in serialized Book data.
- A representative Book with a file cover stays far below 64 KiB.
- The existing generic sync size checks continue to reject values above their
  current limit.

The files plan must not depend on larger sync batches or larger D1 value rows.
General sync batching work remains part of the sync engine plan.

### 3. Replace Book file fields with explicit references

Use a discriminated cover value so a Book always has an explicit cover state:

```ts
export type BookCoverRef =
  | { kind: "none" }
  | {
      kind: "file";
      fileId: FileId;
      blurHash: string;
      width: number;
      height: number;
      mediaType: "image/webp";
      recipeVersion: 1;
    };

export interface Book {
  id: string;
  sourceFileId: FileId;
  cover: BookCoverRef;
  // Existing Book metadata and sync fields.
}
```

Replace the current fields:

```text
fileHash         -> sourceFileId
coverContentHash -> cover.fileId
isDownloaded     -> remove
```

Do not add a synchronized `bookCovers` table. The Book value contains only the
small reference, dimensions, recipe version, and BlurHash. It never contains
the WebP bytes.

### 4. Build the WebP and BlurHash cover pipeline

Implement an application-level `createBookCover()` function. It is not part of
the generic files service.

Initial recipe:

1. Decode the extracted EPUB cover Blob.
2. Preserve aspect ratio and resize to a maximum width of 480 px.
3. Read a small pixel buffer and encode a 4 by 3 component BlurHash.
4. Encode WebP at quality 0.8.
5. Confirm that the returned MIME type is `image/webp`.
6. Use a WebP WASM encoder only when native WebP encoding is unavailable.
7. Call `files.put(webpBlob)` and receive an opaque `FileId`.
8. Return the complete `BookCoverRef`.

Use the standard BlurHash encoder and decoder package. Do not implement a
project-specific BlurHash codec.

Use `OffscreenCanvas` when the runtime supports the complete decode, draw, and
encode path. Keep an `HTMLCanvasElement` fallback. First profile the native
path. Move it to a Worker only if import work blocks visible interaction.

Add fixtures that cover:

- Large JPEG input.
- PNG input.
- Portrait and landscape input.
- Native WebP success.
- Native WebP MIME mismatch and WASM fallback.
- Fixed 480 px and quality 0.8 recipe for an unusually complex image.
- Deterministic BlurHash shape and successful decode.
- Image decode failure.

Do not assert byte-for-byte WebP output because browser encoders can differ.
Assert dimensions, requested quality, MIME type, BlurHash validity, and
successful image decode.

### 5. Evolve the local files table and replace the transfer queue

Keep the existing `files` object store and migrate its rows in the next Dexie
schema version. Do not create a parallel file store. Replace `StoredFile`,
`FileType`, and the priority-based transfer queue with explicit local records:

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
  lastFailure:
    | { kind: "none" }
    | { kind: "failed"; message: string; failedAt: number };
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
- `deleteRemote()` marks a retained local row as not remote and removes any
  pending upload operation in one local transaction.
- The service does not scan remote inventory and recreate uploads for local
  rows after an explicit remote deletion.

Keep local-size and inventory helpers. Remove last-accessed, pinning, eviction,
and numeric priority concepts.

### 6. Evolve the remote files API and catalog

Migrate the current D1 `file_storage` catalog instead of creating `files_v2`.
The generic catalog must not contain application roles such as `epub` or
`cover`.

Suggested catalog:

```text
file_storage
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
PUT    /api/files/:fileId
GET    /api/files/:fileId
GET    /api/files
DELETE /api/files/:fileId
```

Server rules:

- Authenticate every request.
- Recalculate xxHash during upload and require it to match `fileId`.
- Write the R2 object before inserting the active catalog record.
- Treat the same user and file ID as an idempotent upload.
- Revive and update the existing row when the user explicitly uploads a file
  that they previously deleted remotely.
- Return immutable cache headers for downloads.
- List only the current user's active records.
- Delete without inspecting opaque synchronized Book values.
- A failed D1 insert can leave an unreferenced R2 object. Inventory repair can
  remove such objects later.

Use user-scoped R2 keys. Do not add cross-user deduplication.

### 7. Convert EPUB import

Use this import flow:

```text
files.put(original EPUB)
  -> get opaque sourceFileId
  -> find active Book by sourceFileId
  -> return the existing Book when found
  -> parse EPUB metadata when new
  -> create 480 px WebP, BlurHash, and cover FileId
  -> store the Book domain row
  -> materialize the EPUB locally
```

The EPUB import service must not call upload routes, build transfer tasks, or
handle content hashes. `files.put()` owns those actions.

Create the Book after parsing and cover processing succeed. Both files are
already durable locally at that point. A later Book write failure can leave
unreferenced local files; `listLocal()` makes that state visible.

Reimporting the same EPUB returns the existing Book before it creates another
cover derivative. Re-encoding a cover in a future recipe creates a new
`FileId`, updates the Book reference, and leaves the old file available for
explicit cleanup.

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

### 9. Make Library cover startup explicit

The application, not the generic files service, owns cover sequencing.

Startup flow:

1. Complete the initial key-value bootstrap for Books, statuses, checkpoints,
   and other domain rows.
2. Resolve the cover files for the initial visible Library group.
3. Create object URLs and wait for those WebP images to decode.
4. Reveal the Library after the visible group is ready.
5. Start bounded background downloads for the remaining cover files.
6. Use the BlurHash when a later card becomes visible before its file is ready,
   or when a file is missing or fails to load.
7. Replace the BlurHash with the WebP after download and decode complete.
8. Revoke object URLs when their owning cache entries are released.

On an established client, these operations read small WebP files from
IndexedDB. On a cold client, the visible cover downloads happen before Library
reveal. The remaining measured corpus is about 1.68 MB and can download after
the first group without blocking interaction.

Use direct call order rather than download priorities. A bounded background
loop can process the remaining covers. A user-triggered `get()` starts
immediately and shares any in-flight request for the same ID.

The BlurHash is a fallback for unavoidable missing-file intervals. It does not
replace the initial visible-cover gate.

### 10. Mirror source files in the background

After the Library is usable:

1. Ensure the most recent Continue Reading EPUB is local and materialized.
2. List remote files.
3. Ensure other Continue Reading EPUBs are local.
4. Ensure all remaining remote files are local in bounded batches.
5. Materialize other EPUBs only when opened or selected by an application
   background phase.

Replace the current unbounded `Promise.all()` prefetch for every Continue
Reading Book. Do not let several EPUB downloads and full extractions compete
with the initial Library reveal.

The steady state is a complete local file mirror. Do not evict completed files
or materializations automatically.

### 11. Build and dry-run the migration tools

The sync v2 production cutover is complete, so this change needs an explicit
data migration rather than a fresh database assumption.

Local Dexie migration:

- Convert `Book.fileHash` to an opaque `sourceFileId` while preserving its
  current xxHash identity.
- Convert existing local EPUB rows to the new `FileId` shape.
- Generate or reuse a 480 px WebP for each available cover, store it through
  `files.put()`, and generate its BlurHash.
- Replace `coverContentHash` with the complete `BookCoverRef`.
- Remove `isDownloaded` after the materialization marker replaces it.
- Replace transfer tasks with upload operations only where remote presence is
  not known.
- Create no materialization marker unless all required local outputs are
  complete and current.

Production migration:

1. Back up D1 and record the active legacy file inventory.
2. Rewrite existing `file_storage` rows to the opaque `FileId` identity without
   copying R2 bytes. Merge duplicate type-specific rows only after their bytes
   produce the same xxHash.
3. Read each existing cover and encode the 480 px WebP derivative.
4. Upload each WebP through the new files API and generate its BlurHash.
5. Rewrite each Book value with `sourceFileId` and `BookCoverRef`; remove
   `fileHash`, `coverContentHash`, and `isDownloaded`.
6. Give rewritten rows valid newer HLC versions and fresh server sequences.
7. Verify every file reference, WebP MIME type, BlurHash decode, row count,
   tombstone, and Book value size.

Use `cwebp` for the production migration so its output is repeatable. Browser
imports can use the browser encoder because the compressed bytes remain behind
the opaque `FileId`.

The migration must produce a deterministic report before it writes production.
Do not log EPUB contents, image bytes, or user-specific metadata beyond the
identifiers needed for verification.

### 12. Deploy, verify, and clean up

Use a short personal-app write freeze:

1. Back up D1 and the file catalog.
2. Migrate `file_storage` and replace the type-specific endpoints during the
   coordinated write freeze.
3. Run authenticated file API smoke tests.
4. Run and verify the production data migration.
5. Deploy the new client database schema, files service, Book model, WebP cover
   pipeline, BlurHash rendering, and materialization flow together.
6. Bootstrap one clean browser profile without changing the sync size limits.
7. Verify the atomic Library reveal, local and remote cover loading, BlurHash
   fallback, Continue Reading preparation, offline reading, reconnect upload,
   and eventual full mirroring.
8. Import the same EPUB twice and verify that one Book, one source file, and one
   cover derivative remain.
9. Verify `listRemote()` and one intentional remote deletion.

Retain the D1 backup, R2 object keys, and production migration report during the
rollback window. This personal-app cutover does not keep parallel file tables
or old and new endpoints live at the same time.

After verification:

1. Remove `FileManager`, `FileStorage`, `FileRemoteAdapter`, and
   `TransferQueue`.
2. Remove `FileType`, `Priority`, legacy transfer types, and old hooks.
3. Remove `fileHash`, `coverContentHash`, and `isDownloaded` application use.
4. Remove the old type-specific file routes and helpers.
5. Remove obsolete `file_storage` columns and indexes after the migrated
   inventory is verified.
6. Delete legacy cover objects only after every new WebP file and Book
   reference has been verified.
7. Keep canonical EPUB R2 objects and their existing bytes.
8. Update `NEW_SYNC_PLAN.md`, `ROADMAP.md`, and architecture documentation to
   describe EPUBs and WebP covers as opaque files and BlurHash as synchronized
   metadata.

## Review units

Use these review units:

1. Public files contract and unchanged sync limits.
2. Book file references, WebP encoder, and BlurHash generation.
3. Local and remote generic files service.
4. EPUB import and materialization cutover.
5. Library cover startup and background mirroring.
6. Migration, production cutover, and cleanup.

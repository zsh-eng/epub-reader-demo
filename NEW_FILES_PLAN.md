# New Files Implementation Plan

**Status**: In progress — steps 1 through 4 complete

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
| ------------- | ----------: | -------: | -----------: | -----------: |
| 320 px        |    18,483 B | 32,948 B |     50,186 B |    885,588 B |
| 384 px        |    26,613 B | 46,878 B |     71,776 B |  1,196,652 B |
| 480 px        |    35,488 B | 70,876 B |    108,408 B |  1,684,618 B |

The 480 px result is small enough for cover downloads and startup decoding. It
also retains more detail than the 320 px and 384 px outputs.

The 1.68 MB total is compressed transfer and storage size, not decoded bitmap
memory. A representative 480 x 700 RGBA bitmap uses about 1.3 MB after decode.
Keep every compressed WebP locally, but let the browser retain decoded pixels
for active cards instead of holding a manual decoded bitmap for every Book.

Base64 would add approximately one third to the image size before the ordinary
JSON row overhead:

| Maximum width | Median JSON value | Largest JSON value | Fits 64 KiB |
| ------------- | ----------------: | -----------------: | ----------: |
| 320 px        |          24,742 B |           67,012 B |    39 of 40 |
| 384 px        |          35,582 B |           95,800 B |    36 of 40 |
| 480 px        |          47,414 B |          144,640 B |    27 of 40 |

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

## System boundary

The generic files system knows only about opaque binary files:

- Calculate and validate `FileId` values.
- Store bytes locally.
- Upload and download bytes.
- List local and remote files.
- Delete a remote file when explicitly requested.
- Deduplicate concurrent work for the same `FileId`.

The EPUB application owns all domain behavior:

- Decide that an EPUB and a generated cover are files.
- Store file references in a Book.
- Unzip an EPUB and build its local materialization.
- Generate the 480 px WebP and BlurHash.
- Decide which covers or EPUBs to fetch first.
- Build reader caches.

The files system must not know about Books, EPUBs, covers, BlurHash,
materialization, Continue Reading, or Library visibility.

## Implementation plan

### 1. Add server migrations and generic endpoints

**Implementation status**: Complete.

Migrate the existing D1 `file_storage` table in place. Do not add a long-lived
`files_v2` table. Remove `fileType` from file identity and use one opaque ID:

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

Add these generic routes:

```text
PUT    /api/files/:fileId
GET    /api/files/:fileId
GET    /api/files
DELETE /api/files/:fileId
```

Keep a thin compatibility bridge for the current client until steps 2 and 3
move all call sites to opaque `FileId` values. The bridge maps the old digest
to `xxh64:<digest>` and does not persist `fileType`. Remove it in step 5.

Server requirements:

- Authenticate every request.
- Recalculate xxHash during upload and require it to match `fileId`.
- Use user-scoped R2 keys. Do not deduplicate across users.
- Make repeated uploads of the same file idempotent.
- Revive a soft-deleted row when the user uploads the file again.
- List only the current user's active files.
- Delete a file without inspecting synchronized Book values.
- Return immutable cache headers for downloaded bytes.

The migration must preserve existing R2 objects. It can rewrite catalog rows
without copying file bytes. Merge legacy type-specific rows only when their
bytes have the same xxHash.

Add integration tests for upload, hash rejection, idempotent upload, download,
inventory, deletion, re-upload, and user isolation.

### 2. Add the client files API and replace the manager

**Implementation status**: Complete.

Add one generic client contract:

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

`put()` is a local operation. It calculates xxHash, stores the Blob, records
upload intent, and resolves without waiting for the network. Store the Blob and
upload intent in one Dexie transaction.

Migrate the existing local `files` table in place. Add only the local state
that the new implementation needs:

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

Manager behavior:

- `get()` returns local bytes or downloads and stores them.
- `ensureLocal()` uses the same download path as `get()`.
- Concurrent work for one `FileId` shares one promise.
- A successful upload sets `remotePresent = true` and removes its upload
  operation in one transaction.
- Failed foreground downloads retry when the next caller requests the file.
- The upload worker resumes after authentication or reconnect.
- Remote deletion does not delete local bytes.
- There is no persistent download queue, numeric priority, pinning, eviction,
  or last-access policy.
- Callers choose order by awaiting `ensureLocal()` or `get()`.

Write contract tests for local `put()`, deduplication, reload-safe upload
intent, local-first `get()`, concurrent download sharing, reconnect upload,
inventory, and remote deletion.

### 3. Migrate Book logic to the files API

**Implementation status**: Complete.

Replace file hashes and download state with opaque references:

```ts
export interface BookCoverRef {
  fileId: FileId;
  blurHash: string | null;
}

export interface Book {
  id: string;
  sourceFileId: FileId;
  cover: BookCoverRef | null;
  // Existing Book metadata and sync fields.
}
```

`cover` is null when the EPUB has no cover. `cover.blurHash` is null when cover
bytes exist but the current client has not generated the derived placeholder.
The Book card uses its ordinary placeholder until the BlurHash exists.

Replace the current fields:

```text
fileHash         -> sourceFileId
coverContentHash -> cover.fileId
isDownloaded     -> remove
```

Do not add a synchronized `bookCovers` table. A Book contains the source file
reference and the small cover description. It never contains EPUB bytes, WebP
bytes, base64, or a data URL.

Update Book operations to use the new API:

- Deduplicate an import by `sourceFileId`.
- Read cover bytes with `files.get(book.cover.fileId)`.
- Read source bytes with `files.get(book.sourceFileId)`.
- Treat a missing file as a file-fetch concern, not as synchronized Book state.
- Remove all Book and reader knowledge of hashes, file types, upload tasks, and
  download tasks.

Convert existing local and synchronized Book file fields to opaque references.
Preserve each existing xxHash value as a `FileId`, and set the migrated cover's
BlurHash to null. The ordinary artifact workflow can generate missing derived
data later. Discard incompatible local reader caches instead of translating
their old schema. Do not change the 64 KiB sync value limit or the 1 KiB key
limit.

Add serialization tests that reject base64 or data URLs in Book values and
confirm that a representative Book remains far below the value limit.

### 4. Update EPUB import, materialization, covers, and loading

**Implementation status**: Complete.

Keep one deterministic application flow. Do not persist a multi-stage status
machine. Derive the next action from the Book, local file, materialization
marker, and reader cache that exist.

Do not add a separate migration workflow. On startup, a client can run the same
operation for a locally present EPUB whose derived data is incomplete. A new
client runs that operation after it downloads the EPUB. Each operation checks
its durable outputs and only builds what is absent or uses an older recipe.

#### New EPUB import

```text
files.put(original EPUB)
  -> receive sourceFileId
  -> return the existing Book when sourceFileId already exists
  -> parse and unzip the EPUB
  -> create the 480 px WebP and 4 by 3 BlurHash
  -> files.put(WebP) and receive cover fileId
  -> write the synchronized Book, extracted entries, and completion marker
```

The cover recipe is fixed:

1. Decode the EPUB cover.
2. Preserve aspect ratio and resize to a maximum width of 480 px.
3. Generate a 4 by 3 component BlurHash from a small pixel buffer.
4. Encode WebP at quality 0.8.
5. Require the result MIME type to be `image/webp`.
6. Use a lazy WebP WASM fallback only when native encoding is unavailable.

`createBookCover()` is application code. It calls `files.put()` for the final
WebP but the generic files API does not know that the Blob is a cover.

Do not require byte-identical WebP output in tests. Test the dimensions,
quality request, MIME type, BlurHash validity, successful decode, and native
encoder fallback.

#### Open a Book on any client

Use this derived sequence:

```text
1. Source file absent locally     -> files.get(sourceFileId)
2. Materialization marker absent  -> unzip and materialize
3. Reader cache absent            -> build the first-open cache
4. Required local facts present   -> open the Book
```

Expose the first two steps through `prepareBook(book)`. The setting-dependent
Reader source cache remains the separate first-open step. Its caller does not
manage extraction states.

In the normal import path, write the optimized cover file, BlurHash, and Book
metadata together before the Book can sync. Older Book values can have a null
BlurHash. Their cards show the ordinary placeholder until `prepareBook()`
derives the current cover data and updates the Book.

The materialization marker is local-only:

```ts
export interface BookMaterialization {
  bookId: string;
  sourceFileId: FileId;
  recipeVersion: number;
  completedAt: number;
}
```

Write extracted entries deterministically. Write the completion marker last, in
the same transaction as the final extracted rows. A failure leaves no valid
marker, and the next call replaces partial output. Do not infer completion from
the presence of one extracted row. Build the normalized Reader source cache
separately on first open because its contents depend on Reader settings.

Expanded EPUB entries, normalized HTML, fonts, and reader caches remain local.
Do not upload them through the files API.

#### Load the Library

The application controls file request order:

1. Complete the initial Book metadata sync.
2. Fetch and decode covers for the initial visible Library group.
3. Reveal the Library when that group is ready.
4. Fetch remaining covers in a bounded background loop.
5. Show the BlurHash only during an unavoidable missing-file or failure
   interval.

After the Library is usable, prepare the most recent Continue Reading Book,
then other Continue Reading Books. The application can then mirror other remote
files in bounded batches. Do not use numeric download priorities or an
unbounded `Promise.all()`.

Local files and materializations are durable. Do not evict them automatically.

### 5. Cut over and remove old code

Use one coordinated personal-app cutover:

1. Back up D1 and record the active file inventory.
2. Dry-run the server catalog and Book data migrations and inspect their
   deterministic reports.
3. Migrate `file_storage` and deploy the new server endpoints.
4. Deploy the local schema, files API, Book model, and EPUB application flow.
5. Migrate existing covers to 480 px WebP and generate their BlurHashes.
6. Bootstrap a clean browser profile and verify local-first and cold-client
   behavior.

Verify:

- The same EPUB imported twice produces one Book and one source file.
- `files.put()` succeeds offline and uploads after reconnect.
- A cold client downloads visible covers before Library reveal.
- A cold Book open follows download, materialization, cache, and open order.
- An established client opens from its local file and materialization.
- Cover failure shows BlurHash and later replaces it with the WebP.
- Remote inventory and explicit deletion work.
- Offline reading still works after remote deletion.
- Sync limits remain unchanged.

After verification, remove:

- `FileManager`, `FileStorage`, `FileRemoteAdapter`, and `TransferQueue`.
- `FileType`, `Priority`, legacy transfer types, and obsolete file hooks.
- `fileHash`, `coverContentHash`, and `isDownloaded` application use.
- Type-specific server routes, helpers, columns, and indexes.
- Legacy cover objects after every new WebP reference is verified.

Keep the canonical EPUB R2 objects and their bytes. Keep the D1 backup, R2
object keys, and migration reports through the rollback window. Update
`NEW_SYNC_PLAN.md`, `ROADMAP.md`, and architecture documentation after the
cutover.

## Review units

Review the work in this order:

1. Server migration and generic endpoints.
2. Client files API and local schema migration.
3. Book model and Book call-site migration.
4. EPUB import, cover generation, materialization, and loading flow.
5. Production cutover and legacy cleanup.

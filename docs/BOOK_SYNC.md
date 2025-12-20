Evaluation & Detailed Plan for Book Syncing

Your overall design is sound! Here's my analysis with refinements:

### 1. On Using `fileHash` as the Identity Key

**I recommend: Yes, use `fileHash` as the canonical sync identifier.**

Reasoning:

- The same EPUB file should always represent the same logical book
- If User adds the same EPUB on Device A and Device B before syncing, they should auto-merge
- Progress/highlights are tied to book _content_, not an arbitrary ID
- xxhash64 collision probability (~1 in 10¹⁸) is effectively zero

**However**, I suggest a hybrid approach:

- **Client**: Keep `id` (UUID) as the Dexie primary key for internal relations, but use `fileHash` as the sync key
- **Server**: Use `(userId, fileHash)` as the unique constraint, with an auto-generated `id` as the PK

This allows the client to have fast local lookups while still merging correctly on sync.

### 2. Server Schema Design

```epub-reader-demo/server/db/schema.ts#L1-35
import { relations, sql } from "drizzle-orm";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

// Re-export auth tables from auto-generated schema
export * from "./auth-schema";

// Add your custom tables below this line

/**
 * Tracks devices that have accessed the app.
 * A device is identified by a client-generated UUID stored in localStorage.
 * This is separate from sessions - devices persist across logins/logouts.
 */
export const userDevice = sqliteTable(
  "user_devices",
  {
    id: text("id").primaryKey(), // UUID generated server-side
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(), // The device ID from localStorage
    deviceName: text("device_name"), // Friendly name like "Chrome on macOS"
    browser: text("browser"),
    os: text("os"),
    deviceType: text("device_type"), // mobile, tablet, or desktop
    lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [unique("user_client_unique").on(t.userId, t.clientId)],
);
```

Here's the proposed `books` table to add:

```/dev/null/proposed-server-schema.ts#L1-42
export const book = sqliteTable(
  "books",
  {
    id: text("id").primaryKey(), // UUID generated server-side
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileHash: text("file_hash").notNull(), // xxhash64 hex - the sync key

    // Book metadata
    title: text("title").notNull(),
    author: text("author").notNull(),
    fileSize: integer("file_size").notNull(),

    // R2 references (null until uploaded)
    epubR2Key: text("epub_r2_key"),
    coverR2Key: text("cover_r2_key"),

    // Additional metadata (JSON blob for flexibility)
    metadata: text("metadata", { mode: "json" }), // publisher, language, isbn, etc.

    // Timestamps for sync
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    createdByClientId: text("created_by_client_id").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedByClientId: text("updated_by_client_id").notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }), // soft delete
    deletedByClientId: text("deleted_by_client_id").notNull(),
  },
  (t) => [
    // Prevent duplicates per user - this is the merge key
    unique("user_file_hash_unique").on(t.userId, t.fileHash),
    // Index for efficient sync queries
    index("idx_books_user_updated", t.userId, t.updatedAt),
  ],
);
```

### 3. R2 Storage Structure

Add R2 binding to `wrangler.jsonc`:

```/dev/null/wrangler-addition.jsonc#L1-6
"r2_buckets": [
  {
    "binding": "BOOK_STORAGE",
    "bucket_name": "epub-reader-books"
  }
]
```

**R2 Key Structure:**

- EPUBs: `epubs/{userId}/{fileHash}.epub`
- Covers: `covers/{userId}/{fileHash}.{ext}`

User-scoped paths for privacy and simple deletion (no reference counting needed).

### 4. Client-Side Sync State Tracking

Add a new table to Dexie for tracking sync state:

```/dev/null/client-sync-tables.ts#L1-38
// Add to db.ts

export interface BookSyncState {
  fileHash: string;           // PK, matches Book.fileHash
  status: 'pending_upload' | 'uploading' | 'synced' | 'error';
  lastSyncedAt?: Date;        // When we last successfully synced
  lastServerTimestamp?: Date; // Server's updatedAt when we last synced
  epubUploaded: boolean;      // Whether the EPUB file is on R2
  errorMessage?: string;
  retryCount: number;
}

export interface SyncLog {
  id: string;                 // UUID
  timestamp: Date;
  direction: 'push' | 'pull';
  entityType: 'book' | 'progress' | 'highlight';
  entityId: string;           // fileHash for books
  action: 'create' | 'update' | 'delete';
  status: 'success' | 'failure';
  errorMessage?: string;
  durationMs?: number;
}

export interface SyncCursor {
  id: string;                 // 'books' | 'progress' | etc.
  lastServerTimestamp: number; // The sequence number for pagination
}

// Update Dexie schema (version 4):
this.version(4).stores({
  books: "id, &fileHash, title, author, dateAdded, lastOpened",
  bookFiles: "id, bookId, path",
  readingProgress: "id, bookId, lastRead",
  readingSettings: "id",
  highlights: "id, bookId, spineItemId, createdAt",
  // New sync tables
  bookSyncState: "fileHash, status",
  syncLog: "id, timestamp, entityType, status",
  syncCursor: "id",
});
```

### 5. Sync Protocol Details

#### Pull Flow (Server → Client)

```/dev/null/sync-protocol.md#L1-42
## Pull: GET /api/sync/books?since={timestamp}

Request:
- `since`: Last server timestamp (0 for initial sync)

Response:
{
  books: [
    {
      id: "uuid-1",
      fileHash: "abc123...",
      title: "Book Title",
      author: "Author Name",
      fileSize: 1234567,
      metadata: { publisher: "...", language: "en", ... },
      coverUrl: "https://signed-r2-url...",  // Presigned, expires in 1hr
      epubUrl: "https://signed-r2-url...",   // For downloading
      updatedAt: 1234567890123,
      deletedAt: null,  // or timestamp if soft-deleted
    },
    // ...more books
  ],
  serverTimestamp: 1234567890124,  // Save this for next pull
  hasMore: false,  // For pagination if needed
}

Client Processing:
1. For each book in response:
   a. If deletedAt is set:
      - Hard delete from local DB (books + bookFiles + related)
   b. Else if exists locally (by fileHash):
      - Update metadata if server is newer
   c. Else (new book):
      - Create local book record
      - Mark as needing EPUB download
      - Queue download of EPUB from epubUrl

2. Save serverTimestamp to syncCursor table
```

#### Push Flow (Client → Server)

```/dev/null/push-protocol.md#L1-50
## Push: POST /api/sync/books

Two-phase process:
1. Push metadata → get upload URLs
2. Upload EPUB files to R2

Phase 1 - Metadata:
POST /api/sync/books
{
  books: [
    {
      fileHash: "abc123...",
      title: "Book Title",
      author: "Author Name",
      fileSize: 1234567,
      metadata: { ... },
      localCreatedAt: 1234567890123,
    }
  ]
}

Response:
{
  results: [
    {
      fileHash: "abc123...",
      status: "created" | "updated" | "exists" | "conflict",
      serverId: "uuid-1",  // The server's ID for this book
      epubUploadUrl: "https://presigned-r2-put-url...",  // null if exists
      coverUploadUrl: "https://presigned-r2-put-url...",
    }
  ]
}

Phase 2 - File Upload:
PUT {epubUploadUrl}
Content-Type: application/epub+zip
Body: <EPUB binary>

Then:
POST /api/sync/books/{fileHash}/upload-complete
{ type: "epub" }
```

### 6. Conflict Handling

Since `fileHash` is the identity, conflicts are minimal:

| Scenario                                 | Resolution                                                     |
| ---------------------------------------- | -------------------------------------------------------------- |
| Same book added on 2 devices before sync | First creates server record, second gets "exists" → auto-merge |
| Book deleted on A, reading on B          | **Deletion wins** (simpler) or LWW by timestamp (configurable) |
| Metadata edited on 2 devices             | LWW by `updatedAt` timestamp                                   |

For deletions, I recommend "**deletion wins with grace period**":

- Soft-deleted books are included in sync responses for 30 days
- After 30 days, CRON hard-deletes from D1 and R2

### 7. Upload Timing Strategy

For the question "EPUB sent together or later?":

**I recommend: Metadata first, EPUB later** (your Option 2)

```/dev/null/upload-flow.md#L1-20
## Upload Flow

1. User adds book locally
   → Book appears immediately in UI
   → bookSyncState.status = 'pending_upload'
   → bookSyncState.epubUploaded = false

2. SyncService runs (immediately or periodically)
   → POST metadata to server
   → Get presigned upload URL
   → bookSyncState.status = 'uploading'

3. Upload EPUB to R2 (can be chunked for large files)
   → On success: POST /upload-complete
   → bookSyncState.status = 'synced'
   → bookSyncState.epubUploaded = true

4. Other devices pull
   → See book metadata
   → Download EPUB from epubUrl if they want to read it
```

This allows books to appear in the library view across devices even before the full EPUB is uploaded.

### 8. SyncLog Table for Debugging

```/dev/null/sync-log-usage.ts#L1-25
// Example sync log entries:

await db.syncLog.add({
  id: crypto.randomUUID(),
  timestamp: new Date(),
  direction: 'push',
  entityType: 'book',
  entityId: book.fileHash,
  action: 'create',
  status: 'success',
  durationMs: 234,
});

// Debug page can query:
const recentLogs = await db.syncLog
  .orderBy('timestamp')
  .reverse()
  .limit(100)
  .toArray();

const failedSyncs = await db.syncLog
  .where('status')
  .equals('failure')
  .toArray();
```

### 9. Summary of Client-Side Properties

| Property              | Location        | Purpose                 |
| --------------------- | --------------- | ----------------------- |
| `fileHash`            | `Book` table    | Canonical sync ID       |
| `status`              | `BookSyncState` | Upload/sync state       |
| `epubUploaded`        | `BookSyncState` | Whether R2 has the file |
| `lastSyncedAt`        | `BookSyncState` | Last successful sync    |
| `lastServerTimestamp` | `SyncCursor`    | Pull pagination cursor  |

### 10. Questions to Confirm

1. **Deletion strategy**: Should deletions always win, or use LWW timestamps?
Deletion should win, in general, but just mark it as a soft deletion.

2. **EPUB storage on client after sync**: If Device B pulls a book from server, should we download the EPUB immediately (needed to read) or lazily (on first open)?
The EPUB should be pulled lazily, and the library should have some kind of indicator showing that the ebook is not downloaded yet (maybe the cloud icon with dotted border).

3. **Cover image handling**: Upload cover separately to R2, or extract from EPUB on-demand?
We should upload the cover separately to R2.
For clients, it either reads the cover image from their own database, or just links
to the R2 URL if it's not downloaded yet.

4. **Offline-first for existing books**: If a user is offline and opens an existing book, the local EPUB should work—no server dependency.
Yes, that's true.

Would you like me to start implementing any part of this? I'd suggest starting with:

1. Server schema migration (D1 + R2 binding)
2. Client Dexie schema update
3. Basic sync endpoints

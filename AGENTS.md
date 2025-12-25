# Agent Guidelines

This repository uses **bun** as the package manager and for running scripts.

## General Coding Practices

- After you finish editing code, provide a brief summary in the conversation rather than generating a separate document
- Prefer early returns / guard clauses to avoid nested conditionals
- Use `bun run build` for type-checking the project

## Styling & UI

- **Colours**: Avoid introducing new colours. Use existing CSS variables from `index.css`. Refactor any hardcoded colours to use theme variables. Clarify with user before adding new colours
- **Animations**: Use the `motion` library for complex animations (simpler than verbose CSS)
- **Data Fetching**: Use TanStack React Query for data fetching and caching

---

## Backend Structure

- **Framework**: Hono with Cloudflare Workers
- **Database**: D1 Database with Drizzle ORM
- **Auth**: BetterAuth for authentication
- **Database Schema**: Auth tables in `server/db/auth-schema.ts`, custom tables in `server/db/schema.ts`
- **API Logic**: Main logic lives in `server/lib/`. Route handlers in `server/index.ts` should only parse params and return responses
- **API Client**: Use the typed Hono client from `src/lib/api.ts`:
  ```ts
  const res = await honoClient.posts.$get({ query: { id: '123' } })
  ```
- **Protected Routes**: See `server/index.ts` for examples using `c.get('user')`

### Testing

- Integration tests preferred (with database)
- See `test/hello.test.ts` for example
- Run tests: `bun run test test/me.test.ts`

---

## Sync Architecture

The app uses a local-first architecture with bidirectional sync. Data is stored locally (IndexedDB via Dexie) and synced with the server (Cloudflare D1).

### Hybrid Logical Clock (HLC)

**Location**: `src/lib/sync/hlc/hlc.ts`

HLC provides ordering for distributed events. Format: `<timestamp>-<counter>-<deviceId>`

- **Monotonically increasing**: Even if system clock goes backwards
- **Causality tracking**: Ensures events can be totally ordered
- **Conflict resolution**: Last-Write-Wins using HLC comparison

The HLC service is a singleton (`getHLCService()`) to ensure consistency across the app.

### Sync Tables

**Location**: `src/lib/sync-tables.ts`

Defines which entities are synced vs local-only:

**Synced tables** (metadata synced to server) - non-exhaustive list:
- `books` - Book metadata (title, author, fileHash, etc.)
- `readingProgress` - Per-book reading position (scoped by bookId)
- `highlights` - User annotations (scoped by bookId)
- `readingSettings` - Global user preferences

**Local-only tables** (never synced) - non-exhaustive list:
- `bookFiles` - Extracted EPUB contents for rendering
- `files` - Generic file storage (content-addressed)
- `transferQueue` - Upload/download queue management
- `syncLog` - Debug logging

Each synced table has sync metadata fields: `_hlc`, `_deviceId`, `_isDeleted`, `_serverTimestamp`.

### Adapters

The sync system uses adapters to abstract storage and network operations:

**StorageAdapter** (`src/lib/sync/storage-adapter.ts`):
- Abstracts local IndexedDB operations
- `getPendingChanges()` - Get items with `_serverTimestamp = UNSYNCED_TIMESTAMP`
- `applyRemoteChanges()` - Apply server changes with conflict resolution
- `getSyncCursor()` / `setSyncCursor()` - Track sync progress per table

**RemoteAdapter** (`src/lib/sync/remote-adapter.ts`):
- Abstracts server API calls
- `pull(table, since, entityId?, limit?)` - Fetch changes since timestamp
- `push(table, items)` - Send local changes to server
- `getCurrentTimestamp()` - Get server time for cursor initialization

### Sync Engine

**Location**: `src/lib/sync/sync-engine.ts`

Orchestrates bidirectional sync:

1. **Pull**: Fetch server changes → compare HLCs → apply newer changes locally
2. **Push**: Get pending local changes → send to server → update `_serverTimestamp`
3. **Sync**: Pull then push (ensures local changes are persisted before potential overwrites)

Conflict resolution uses **Last-Write-Wins** based on HLC comparison.

### Sync Service

**Location**: `src/lib/sync-service.ts`

High-level lifecycle management:

- **Periodic sync**: Every 30 seconds (configurable)
- **Online/offline handling**: Auto-syncs when coming online
- **Throttling**: Min 5 seconds between syncs for same table
- **Middleware integration**: Triggers sync after local mutations
- **Query invalidation**: Invalidates TanStack Query caches after sync

---

## File Storage System

Files (EPUBs, covers) are stored separately from metadata and use a content-addressed system.

### Architecture

**FileStorage** (`src/lib/files/file-storage.ts`):
- Low-level IndexedDB wrapper for blob storage
- Content-addressed by `fileType:contentHash` (e.g., `epub:abc123`)
- Stores: blob, mediaType, size, storedAt

**FileManager** (`src/lib/files/file-manager.ts`):
- High-level facade for file access
- **Cache-first**: Check local IndexedDB before fetching from server
- **Deduplication**: Prevents duplicate in-flight requests
- **Auto-caching**: Fetched files are stored locally
- Server endpoint pattern: `/api/files/{fileType}/{contentHash}`

### File Types - non-exhaustive list

- `epub` - The EPUB file itself
- `cover` - Book cover image

### Usage Pattern

```ts
// Get file (checks local, fetches from server if needed)
const result = await fileManager.getFile(contentHash, 'epub');

// Get object URL for rendering
const url = await fileManager.getFileUrl(contentHash, 'cover');
// Remember to URL.revokeObjectURL() when done!

// Check if locally available
const hasLocal = await fileManager.hasLocal(contentHash, 'epub');

// Queue for background download
await fileManager.queueDownload(contentHash, 'epub', { priority: 'high' });
```

---

## Adding New Synced Entities

To add a new entity type that syncs:

1. **Define table** in `src/lib/sync-tables.ts`:
   ```ts
   newEntity: {
     primaryKey: 'id',
     indices: ['someField'],
     entityKey: 'parentId', // Optional: for scoped sync
   } satisfies SyncTableDef,
   ```

2. **Add Dexie schema** in `src/lib/db.ts` using `createSyncTableSchema()`

3. **Add server schema** in `server/db/schema.ts` with matching columns + sync metadata

4. **Implement server sync endpoint** if needed (generic `/api/sync/:table` may suffice)

5. **Add query invalidation** in `SyncService.invalidateQueries()` if using React Query

### Sync Metadata Fields

Every synced record must have:
- `id` - Unique identifier (typically UUID)
- `_hlc` - Hybrid Logical Clock timestamp
- `_deviceId` - Device that made the change
- `_isDeleted` - Soft delete flag (0 or 1)
- `_serverTimestamp` - Server timestamp when accepted (or `UNSYNCED_TIMESTAMP` if pending)

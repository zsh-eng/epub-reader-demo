# Sync Architecture and DX RFC

This document records the proposed sync developer experience and the current
epub-reader-demo sync infrastructure. The current proposal is SQLite-first and
does not require Drizzle or Dexie in the sync core.

---

## RFC: SQLite-First Sync DX

**Status**: Draft

**Date**: 2026-07-07

**Goal**: define a small, explicit developer experience for local-first personal
apps that need whole-app bootstrap catch-up, incremental sync, offline reads,
tombstones, and portable local storage across web and Expo/native clients.

### Design Principles

1. **Local reads should be ordinary database reads.**
   The app should query local materialized tables directly through typed helpers
   or a local SQL driver. Reads should not require network access or a sync
   service call.

2. **Local writes must go through sync-aware APIs.**
   The sync layer should own HLC generation, dirty metadata, tombstones, and
   pending push state. We should not rely on storage mutation detection to infer
   whether a write is local or remote.

3. **Remote apply must be explicit.**
   Applying server records should use a separate path from local user writes, so
   batching and conflict handling are predictable.

4. **Bootstrap catch-up should be whole-app by default.**
   A fresh device should pull all non-blob records for an app from cursor `0`,
   then continue with incremental cursor-based catch-up. Lazy network fetch on
   view should not be the primary model.

5. **The server should store sync records as a generic bag of rows.**
   The server should not need an app-specific migration for every client-side
   table. It should index sync records by app, user, table, optional scope, and
   cursor order.

6. **Files and blobs are separate from metadata sync.**
   EPUB files, covers, and extracted reader caches should stay content-addressed
   or local-only rather than being embedded into sync rows.

7. **Stay SQL-first at the storage boundary.**
   The schema DSL exists to derive types, table metadata, and predictable SQL.
   Generated queries and any future migration format should stay close to
   ordinary SQL so changes are easy to inspect.

### Non-Goals

- Real-time multi-user collaboration.
- Field-level merge or CRDT support.
- Tombstone garbage collection in the first version.
- A general-purpose ORM.
- Replacing React Query for UI cache management.
- Supporting every browser storage backend in the first implementation.
- A general Dexie-to-SQLite client migration path for the existing app.

### Proposed Application DX

Application code defines a schema once:

```ts
export const schema = defineSyncSchema({
  books: table({
    id: text().primaryKey(),
    fileHash: text().notNull().unique(),
    title: text().notNull(),
    author: text().notNull(),
    fileSize: integer().notNull(),
    dateAdded: integer().notNull(),
    lastOpened: integer().nullable(),
    coverContentHash: text().nullable(),
  }).sync({
    recordId: "id",
    conflict: "lww",
  }),

  highlights: table({
    id: text().primaryKey(),
    bookId: text().notNull().index(),
    spineItemId: text().notNull().index(),
    text: text().notNull(),
    color: text().notNull(),
    createdAt: integer().notNull(),
    updatedAt: integer().nullable(),
  }).sync({
    recordId: "id",
    scopeId: "bookId",
    conflict: "lww",
  }),

  readingCheckpoints: table({
    id: text().primaryKey(),
    bookId: text().notNull().index(),
    deviceId: text().notNull().index(),
    currentSpineIndex: integer().notNull(),
    scrollProgress: real().notNull(),
    lastRead: integer().notNull(),
  }).sync({
    recordId: "id",
    scopeId: "bookId",
    conflict: "lww",
  }),
});
```

The schema should generate or derive:

- local `CREATE TABLE` SQL
- local indexes
- TypeScript row types
- sync table metadata
- payload serializers and parsers
- typed query helper stubs
- optional migration metadata later

The generated output should be boring and reviewable. The sync package should
not hide complex behavior in an opaque runtime.

The first schema DSL should support a deliberately small subset:

- `text`, `integer`, `real`, and JSON-encoded `text`
- primary keys
- required and nullable fields
- single-column indexes
- single-column unique indexes
- table-level sync metadata: `recordId`, optional `scopeId`, and `conflict`

Compound indexes, foreign keys, custom constraints, generated columns, and raw
SQL schema extensions should wait until a concrete app query needs them.

### Local Query DX

Reads should use typed local helpers over SQLite:

```ts
const book = await db.books.get(bookId);
const highlights = await db.highlights.listByBook(bookId);
const checkpoint = await db.readingCheckpoints.getByBookAndDevice(
  bookId,
  deviceId,
);
```

These helpers should compile down to straightforward SQL:

```sql
select * from highlights
where book_id = ?
order by created_at;
```

The first version should not expose a raw SQL escape hatch through the sync
library. The app can still own internal SQL helpers, but the package DX should
start with generated or handwritten typed helpers for known query patterns.

### Local Write DX

Writes should be sync-aware and explicit:

```ts
await sync.books.put(book);
await sync.highlights.put(highlight);
await sync.highlights.delete(highlightId);

await sync.transaction(async (tx) => {
  await tx.highlights.put(highlight);
  await tx.notes.put(note);
});
```

A local write should update the domain table and sync metadata in the same local
transaction. A delete should create or update a tombstone, not hard-delete the
server-visible sync record.

### Remote Apply DX

Remote sync should use a separate code path:

```ts
const batch = await transport.pullApp({ appName: "ebook-reader", since });
const applied = await sync.applyRemote(batch.records);
await sync.setCursor(batch.cursor);
```

`applyRemote` should:

- validate the incoming table and payload
- compare HLCs per `{ tableName, recordId }`
- update local materialized rows when the remote record wins
- update local sync metadata
- record affected tables and scopes for cache invalidation
- advance the local HLC service after receiving remote HLCs

### React Query DX

React Query should remain the UI cache layer:

```ts
export function useBookHighlights(bookId: string) {
  return useQuery({
    queryKey: ["highlights", bookId],
    queryFn: () => db.highlights.listByBook(bookId),
  });
}

export function useAddHighlight(bookId: string) {
  return useSyncedMutation({
    mutationFn: (highlight: NewHighlight) => sync.highlights.put(highlight),
    invalidate: [["highlights", bookId]],
  });
}
```

After `applyRemote`, the sync layer should return affected table/scope pairs so
the app or React binding can invalidate the correct queries.

### Local Storage Model

The first implementation should be SQLite-first. Each app table should be a real
local table because ebook-reader, flashcards, and budgeting-style apps benefit
from normal indexed queries.

Sync metadata should live in sidecar tables:

```sql
create table sync_meta (
  table_name text not null,
  record_id text not null,
  hlc text not null,
  device_id text not null,
  last_server_seq integer not null default 0,
  dirty integer not null default 0,
  is_deleted integer not null default 0,
  primary key (table_name, record_id)
);

create table sync_cursors (
  cursor_key text primary key,
  server_seq integer not null
);
```

Keeping sync metadata in sidecar tables keeps domain tables readable and makes
query helper code easier to review.

`last_server_seq` is the last server sequence known for this local record
version. It is `0` for a new local record that has never been accepted by the
server. If a previously synced record is edited locally, `dirty` becomes `1` and
`last_server_seq` remains the previous acknowledged sequence until the server
accepts the new version.

`dirty` is local-only state. `dirty = 1` means this device has a local write that
still needs to be pushed. Remote apply should write `dirty = 0`. Successful push
acknowledgement should update `last_server_seq` and set `dirty = 0`.

`sync_cursors.server_seq` uses `0` to mean "this scope has never synced." It is
not per-record state; it tracks app-level or table-level catch-up progress.

### Server Storage Model

The server stores generic sync records:

```ts
interface ServerSyncRecord {
  appName: string;
  userId: string;
  tableName: string;
  recordId: string;
  scopeId?: string;
  serverSeq: number;
  hlc: string;
  deviceId: string;
  schemaVersion: number;
  isDeleted: boolean;
  payload: Record<string, unknown>;
}
```

`payload` should use canonical schema field names, not local SQLite column
names. For example, the wire payload should use `bookId`, not `book_id`.

Preferred option:

- Domain/schema field names are the sync payload format.
- SQLite column names are local storage details.
- Serializers map between payload fields and local columns.

Tradeoffs:

- Canonical field names keep the wire format stable across SQLite, Expo,
  sqlite-wasm, and future storage adapters.
- Canonical field names match TypeScript app types and are easier to inspect in
  server JSON.
- Column names would make local SQL dumps simpler, but they leak one storage
  backend's naming convention into the server protocol and make future storage
  changes harder.

Recommended indexes:

```sql
(app_name, user_id, server_seq)
(app_name, user_id, table_name, server_seq)
(app_name, user_id, table_name, scope_id, server_seq)
```

`serverSeq` should be a monotonic sequence for the physical server sync table.
Clients can store cursors with gaps. Gaps are acceptable because each client only
cares that future pulls ask for records where `serverSeq > localCursor`.

### Bootstrap and Incremental Sync

Bootstrap catch-up:

```ts
await sync.bootstrapApp();
```

Expected behavior:

1. Pull all non-blob sync records for `{ appName, userId }` from cursor `0`.
2. Apply records to local materialized tables.
3. Store the highest observed `serverSeq`.
4. Push any local records created before authentication completed.

Incremental catch-up:

```ts
await sync.pullApp();
await sync.pushPending();
```

Expected behavior:

1. Pull records after the local app cursor.
2. Apply them locally with HLC LWW.
3. Push pending local dirty records in batches.
4. Mark accepted local records clean and store their assigned server sequence in
   `last_server_seq`.

### Tombstones

The first implementation should keep tombstones indefinitely. This is simpler
and correct for personal-scale apps.

Future tombstone garbage collection would require server-side device watermarks:

```ts
interface DeviceSyncWatermark {
  appName: string;
  userId: string;
  deviceId: string;
  lastSeenServerSeq: number;
  lastActiveAt: number;
}
```

This should not be required for the first implementation.

### Web SQLite Target

The web implementation should focus on sqlite-wasm first. The preferred shape is
one `SqlDriver` interface with adapters for sqlite-wasm on web and Expo SQLite
on native.

The sqlite-wasm adapter should be the first web spike because it tests the main
architectural bet: one SQLite-first local storage model across web and native.
Dexie should be treated as a fallback for the existing app, not as the new sync
package's target backend.

### Existing App Cutover

The first cutover for an existing app should avoid a full client-side
Dexie-to-SQLite migration. The preferred path is a server-side reseed:

1. Ensure the old app has synced its local pending changes.
2. Freeze or gate old sync writes during the cutover window.
3. Export the current Cloudflare/D1 sync data.
4. Transform it into the new server bag-of-rows format.
5. Seed a new Cloudflare database or sync table.
6. Let new clients bootstrap from cursor `0` into fresh SQLite tables.
7. After verification, clear the old IndexedDB/Dexie contents.

This treats the new client as a fresh device. It does not preserve old unsynced
local-only records, which is acceptable for the initial single-user apps as long
as the data is synced before cutover.

The new server can assign fresh `serverSeq` values during the seed. Existing
clients will bootstrap from `0`, so preserving old cursor values is unnecessary.
The migration should preserve stable domain ids, payload data, HLCs where useful,
and tombstone state.

Keeping deleted rows in the seed is acceptable for personal-scale data because
it keeps the cutover conservative. However, retired tables should be explicitly
excluded from the new schema and from the seed, so deleted or obsolete product
surfaces are not accidentally carried forward.

The broader question of schema migration source-of-truth remains deferred. We do
not need to decide yet whether future migrations are authored as SQL files,
schema DSL changes, generated stubs, or handwritten TypeScript data migrations.

### Query Helper Generation

Query helpers should be generated files in the first version.

The schema DSL should generate boring TypeScript modules such as:

```ts
export const highlightsQueries = {
  get: (db: SqlDriver, id: string) =>
    db.get<Highlight>("select * from highlights where id = ?", [id]),

  listByBook: (db: SqlDriver, bookId: string) =>
    db.all<Highlight>(
      "select * from highlights where book_id = ? order by created_at",
      [bookId],
    ),
};
```

This is preferable to runtime query objects for v1 because generated files are
easy to inspect, test, and edit when the generated shape is insufficient.

For this project, ordinary exported TypeScript types and functions are preferred
over Hono-style deep type inference. Type inference can still derive row and
helper types from the schema, but the generated output should remain simple
enough for humans and agents to patch directly.

A local `SKILL.md` should document how to use the sync library, when schema
changes require regeneration, which generated files should not be hand-edited,
and which app code paths must use sync-aware writes.

Tradeoffs:

- Generated files add a codegen step.
- Runtime helpers avoid generated files, but they hide more behavior and are
  harder to review.
- Handwritten helpers are fine for unusual queries; the generator should cover
  the standard `get`, `listByScope`, and indexed lookup cases first.
- Hono-style type inference can give polished API ergonomics, but it increases
  type-level complexity before the sync model has settled.

### Initial PR Breakdown

1. Document this RFC in `SYNC.md`.
2. Add a schema DSL prototype with table metadata extraction only.
3. Add a minimal async SQLite driver interface and fake test driver.
4. Add a sqlite-wasm web driver spike behind the SQLite driver interface.
5. Add `sync_meta` and `sync_cursors` local tables.
6. Generate local `CREATE TABLE` SQL and indexes from the schema subset.
7. Add typed local query helper stubs for current ebook-reader entities.
8. Implement explicit sync-aware local writes.
9. Extract platform-neutral HLC with injected device ID and persistence.
10. Add server sync v2 storage and HTTP push/pull endpoints.
11. Add client HTTP transport.
12. Add bootstrap and incremental sync engine.
13. Add React Query invalidation helpers.
14. Add an agent-facing `SKILL.md` for schema edits and generated file workflow.
15. Add a server-side export, transform, and seed script for the existing ebook
    reader data.
16. Cut over the ebook reader by bootstrapping the new client from the seeded
    server data.

### Open Questions

1. Which sqlite-wasm persistence mode should we use for durable web storage?
2. Which current synced tables are intentionally retired and should not be
   included in the new server seed?
3. What is the long-term source of truth for schema migrations after the
   standalone library is proven?

---

## Existing Dexie Sync Architecture

The remaining sections describe the current implementation and the earlier
Dexie extraction path. They are retained as implementation context, not as the
current RFC direction.

The sync system is a **local-first, bidirectional sync** architecture with:

- **Client storage**: Dexie (IndexedDB) with DBCore middleware for automatic metadata injection
- **Server storage**: A single generic `syncData` table (Cloudflare D1/SQLite) storing all entities as JSON blobs
- **Conflict resolution**: Last-Write-Wins (LWW) via Hybrid Logical Clocks (HLC)
- **File sync**: Separate content-addressed transfer queue (not HLC-based)

### Data Flow

```
Local Write:
  app calls db.table.put(item)
    → Dexie middleware injects _hlc, _deviceId, _serverTimestamp=-1
    → onLocalMutation callback fires
    → SyncService.syncTable() (throttled)
    → SyncEngine: pull remote changes, then push local changes
    → Server returns serverTimestamp, local record updated
    → React Query caches invalidated

Remote Write:
  SyncEngine.pull() fetches from server (since cursor)
    → Server returns items where serverTimestamp > cursor AND deviceId ≠ requester
    → StorageAdapter.applyRemoteChanges() runs LWW (remote _hlc > local _hlc → overwrite)
    → Items wrapped with markAsRemoteWrite() to bypass middleware
    → Sync cursor advanced
    → HLC receive() maintains causality
```

### Layer Diagram

```
┌─────────────────────────────────────────────────────┐
│  App Layer (React hooks, domain logic, queries)     │  ← app-specific
├─────────────────────────────────────────────────────┤
│  SyncService (lifecycle, periodic sync, throttling) │  ← needs refactoring
├─────────────────────────────────────────────────────┤
│  SyncEngine (pull/push orchestration)               │  ← already generic
├──────────────────┬──────────────────────────────────┤
│  StorageAdapter   │  RemoteAdapter                   │  ← interfaces generic,
│  (DexieStorageAd) │  (HonoRemoteAdapter)             │    impls need work
├──────────────────┴──────────────────────────────────┤
│  HLC Service + Dexie Middleware                     │  ← mostly generic
├─────────────────────────────────────────────────────┤
│  Schema Generator (generateDexieStores)             │  ← already generic
└─────────────────────────────────────────────────────┘
```

---

## What's Already Generic

These files could be extracted with zero or minimal changes:

### SyncEngine (`src/lib/sync/sync-engine.ts`)

The core orchestrator. Takes three injected dependencies (`StorageAdapter`, `RemoteAdapter`, `HLCService`) and has no app-specific imports. Handles pull-then-push, cursor management, and conflict counting. **No changes needed.**

### StorageAdapter Interface (`src/lib/sync/storage-adapter.ts`)

The `StorageAdapter` interface and the `SyncItem` wire format are fully generic. The `DexieStorageAdapter` implementation only depends on Dexie types and internal sync module constants. **No changes needed to the interface.**

### RemoteAdapter Interface (`src/lib/sync/remote-adapter.ts`)

The `RemoteAdapter` interface (pull/push/getCurrentTimestamp) is clean and framework-agnostic. **No changes needed to the interface.**

### Schema Generator (`src/lib/sync/hlc/schema.ts`)

`generateDexieStores()`, `SyncTableDef`, `SyncMetadata`, `UNSYNCED_TIMESTAMP`, `SYNC_INDICES` — all fully generic. Handles validation and Dexie schema string generation from a declarative table config. **No changes needed.**

### Dexie Middleware (`src/lib/sync/hlc/middleware.ts`)

The DBCore middleware that auto-injects `_hlc`, `_deviceId`, `_serverTimestamp`, `_isDeleted` on local writes and passes through remote writes untouched. Uses a `Symbol`-based marker (`REMOTE_WRITE`) to distinguish local vs remote writes. Also blocks hard deletes (forces tombstoning). **No changes needed.**

### Server-side push/pull logic (`server/lib/sync.ts`)

The `pullSyncData` and `pushSyncData` functions are generic — they operate on the `syncData` table using table name, user ID, and device ID as parameters. The push uses `INSERT ... ON CONFLICT DO UPDATE ... WHERE incoming_hlc > existing_hlc` for server-side LWW. **No changes needed** (apart from decoupling from Drizzle if supporting other ORMs).

### Server-side `syncData` table design (`server/db/schema.ts`)

The single-table design where all entities are stored as JSON blobs with `(id, tableName, userId)` as composite primary key is already generic. Indices on `(tableName, userId, serverTimestamp)` and `(tableName, userId, entityId, serverTimestamp)` support both full-table and scoped pulls efficiently.

---

## What Needs Minor Changes

### HLC Service (`src/lib/sync/hlc/hlc.ts`)

**Current coupling:**

- Imports `getOrCreateDeviceId` from `@/lib/device` (hardcoded device ID source)
- Hardcoded localStorage key `epub-reader-hlc-state`

**Changes needed:**

- Accept `deviceId` (or a `() => string` factory) as a config parameter
- Accept a `storageKey` string or a generic `{ get(): HLCState | null, set(state: HLCState): void }` persistence interface
- Remove the app-specific import

```ts
// Before
export function createHLCService(): HLCService {
  const deviceId = getOrCreateDeviceId();
  const saved = localStorage.getItem("epub-reader-hlc-state");
  // ...
}

// After
export interface HLCConfig {
  deviceId: string;
  persistence?: { get(): HLCState | null; set(state: HLCState): void };
}

export function createHLCService(config: HLCConfig): HLCService {
  const { deviceId, persistence } = config;
  const saved = persistence?.get();
  // ...
}
```

### DexieStorageAdapter (`src/lib/sync/storage-adapter.ts`)

**Current coupling:**

- Stores sync cursors in `localStorage` with hardcoded key format `sync-cursor:{table}`

**Changes needed:**

- Accept cursor storage strategy as a config option (default to localStorage, allow IndexedDB or custom)
- This is minor because the cursor storage is a small, isolated concern

### HonoRemoteAdapter (`src/lib/sync/remote-adapter.ts`)

**Current coupling:**

- Imports the typed `honoClient` from `@/lib/api`

**Changes needed:**

- Replace with a generic `FetchRemoteAdapter` that accepts:
  - `baseUrl: string`
  - `getHeaders: () => Record<string, string>` (for auth tokens, device ID)
- The Hono-specific adapter could remain as an optional integration package

```ts
// Library ships this
export class FetchRemoteAdapter implements RemoteAdapter {
  constructor(
    private config: {
      baseUrl: string;
      getHeaders: () => HeadersInit;
      // Optional: custom endpoint paths
      paths?: { pull?: string; push?: string; timestamp?: string };
    },
  ) {}

  async pull(table, since, entityId?, limit?) {
    const params = new URLSearchParams({ since: String(since) });
    if (entityId) params.set("entityId", entityId);
    if (limit) params.set("limit", String(limit));
    const res = await fetch(`${this.config.baseUrl}/sync/${table}?${params}`, {
      headers: this.config.getHeaders(),
    });
    return res.json();
  }
  // ...
}
```

---

## What Needs Significant Refactoring

### SyncService (`src/lib/sync-service.ts`)

This is the main orchestration layer and the most app-coupled file. It currently:

1. Imports the `db` singleton directly
2. Imports `SYNC_TABLES` and `SyncTableName` directly
3. Hardcodes React Query invalidation keys (`["books"]`, `["readingProgress"]`, etc.)
4. Imports app-specific `addSyncLogs` for debug logging
5. Is instantiated as a module-level singleton

**Changes needed to make it a library export:**

```ts
// Library API
export interface SyncLibraryConfig<TTables extends string = string> {
  // Required
  db: Dexie;
  tables: Record<TTables, SyncTableDef>;
  remoteAdapter: RemoteAdapter;

  // HLC
  deviceId: string;
  hlcPersistence?: { get(): HLCState | null; set(state: HLCState): void };

  // Lifecycle
  periodicSyncInterval?: number; // default: 30_000
  throttleInterval?: number; // default: 5_000

  // Extension points
  onSyncComplete?: (results: Map<TTables, SyncResult>) => void;
  onConflict?: (table: TTables, local: SyncItem, remote: SyncItem) => void;
  logger?: (entry: SyncLogEntry) => void;
}

export function createSyncLibrary<T extends string>(
  config: SyncLibraryConfig<T>,
) {
  // Returns a SyncService instance wired with the provided config
}
```

The key insight: **query invalidation should not be the library's responsibility**. The library should expose an `onSyncComplete` callback that tells the consumer which tables changed and how many items were pulled/pushed. The consumer (e.g. a React app) can then invalidate whatever caches it needs.

### Table Configuration (`src/lib/sync-tables.ts`)

This file IS the app configuration. In a library, the user would provide their own table definitions using the same `SyncTableDef` type:

```ts
// User's app code
import { createSyncLibrary, type SyncTableDef } from 'local-sync';

const tables = {
  todos: {
    primaryKey: 'id',
    indices: ['listId', 'createdAt'],
    entityKey: 'listId',
  },
  lists: {
    primaryKey: 'id',
    indices: ['name'],
  },
} satisfies Record<string, SyncTableDef>;

const sync = createSyncLibrary({ tables, db, ... });
```

### Database Setup (`src/lib/db.ts`)

The library should export helpers, not a database instance:

- `generateDexieStores(tables)` — already generic
- `WithSyncMetadata<T>` — type helper for TypeScript users
- `createSyncTableSchema(def)` — individual table schema generation
- A `setupDatabase(db, tables)` helper that handles versioning of sync metadata columns

The user owns their Dexie instance, types, and schema migrations.

---

## What Would NOT Be Part of the Library

| Component                                  | Reason                                                              |
| ------------------------------------------ | ------------------------------------------------------------------- |
| React hooks (`use-sync.ts`)                | Framework-specific; provide as optional `@local-sync/react` package |
| Domain types (Book, Highlight, etc.)       | App-specific                                                        |
| File storage system                        | Separate concern (content-addressed blobs ≠ metadata sync)          |
| Transfer queue                             | Separate concern, though could be a companion library               |
| Server framework integration (Hono routes) | Provide reference implementation + docs, not a library              |
| Auth/device management                     | Consumer's responsibility                                           |

---

## Proposed Library Structure

```
@local-sync/core
├── sync-engine.ts          # SyncEngine class (unchanged)
├── storage-adapter.ts      # StorageAdapter interface + DexieStorageAdapter
├── remote-adapter.ts       # RemoteAdapter interface + FetchRemoteAdapter
├── hlc/
│   ├── hlc.ts              # HLC service (configurable device ID + persistence)
│   ├── schema.ts           # SyncTableDef, generateDexieStores, constants
│   └── middleware.ts        # Dexie DBCore middleware (unchanged)
├── sync-service.ts         # Orchestration (configurable, no app imports)
├── types.ts                # SyncItem, SyncResult, SyncOptions, etc.
└── index.ts                # Public API: createSyncLibrary()

@local-sync/server          # Optional companion
├── sync-handlers.ts        # Generic push/pull logic (currently server/lib/sync.ts)
├── schema.ts               # Reference syncData table schema
└── adapters/
    ├── drizzle.ts           # Drizzle ORM adapter
    └── kysely.ts            # Kysely adapter (etc.)

@local-sync/react           # Optional framework bindings
├── use-sync.ts             # Hook wrapping SyncService lifecycle
├── use-sync-status.ts      # Reactive sync state
└── provider.tsx             # Context provider
```

---

## API Surface for the Library

### Initialisation

```ts
import { createSyncLibrary } from "@local-sync/core";

const sync = createSyncLibrary({
  db: myDexieInstance,
  tables: {
    todos: { primaryKey: "id", indices: ["listId"] },
    lists: { primaryKey: "id" },
  },
  remoteAdapter: new FetchRemoteAdapter({
    baseUrl: "https://api.myapp.com",
    getHeaders: () => ({ Authorization: `Bearer ${token}` }),
  }),
  deviceId: getDeviceId(),
  onSyncComplete: (results) => {
    // Invalidate your own caches here
    queryClient.invalidateQueries({ queryKey: ["todos"] });
  },
});

sync.start(); // Begin periodic sync
sync.stop(); // Stop periodic sync
sync.destroy(); // Full cleanup
```

### Manual Sync

```ts
await sync.syncAll(); // Sync all tables
await sync.syncTable("todos"); // Sync one table
await sync.syncTable("todos", { entityId: listId }); // Scoped sync
await sync.pushTable("todos"); // Push only
await sync.pullTable("todos"); // Pull only
```

### Querying (User's Dexie)

```ts
import { isNotDeleted } from "@local-sync/core";

// User queries their own Dexie tables, filtering tombstones
const todos = await db.todos.filter(isNotDeleted).toArray();
```

### Soft Deletes

```ts
import { createTombstone } from "@local-sync/core";

// Library provides the tombstone helper
await db.todos.put(createTombstone(existingTodo));
```

### Server Setup (Reference)

```ts
import { createSyncHandlers } from "@local-sync/server";

const { handlePull, handlePush } = createSyncHandlers({
  getDb: (c) => c.get("db"),
  getUserId: (c) => c.get("user").id,
  getDeviceId: (c) => c.req.header("X-Device-ID"),
});

app.get("/api/sync/:table", handlePull);
app.post("/api/sync/:table", handlePush);
app.get("/api/sync-timestamp", (c) => c.json({ serverTimestamp: Date.now() }));
```

---

## Existing Dexie Design Decisions

These decisions explain the current Dexie-based implementation. The SQLite-first
RFC above supersedes the middleware-specific parts for new work.

1. **Single server table for all entities**: The `syncData` table with `(id, tableName, userId)` composite key and JSON `data` column means zero server migrations when adding new client-side tables. This is a huge DX win for personal apps.

2. **Pull-then-push ordering**: Pulling first ensures the client has the latest state before pushing, reducing unnecessary conflicts.

3. **Server excludes requester's own changes from pull**: The `deviceId != requester` filter prevents echo and reduces bandwidth.

4. **Tombstoning over hard deletes**: The middleware blocks `delete()` operations and forces `put()` with `_isDeleted = 1`. This ensures deletes propagate across devices.

5. **Symbol-based remote write marker**: Using `Symbol('REMOTE_WRITE')` to bypass middleware on remote applies is elegant — it's invisible to serialisation and impossible to accidentally trigger.

6. **Middleware-based metadata injection**: App code never manually sets `_hlc` or `_deviceId`. The Dexie middleware handles it transparently, making the sync system invisible to domain logic.

7. **HLC string comparison for server-side LWW**: The HLC format (`timestamp-counter-deviceId`) allows SQLite string comparison (`>`) to work directly for ordering, avoiding parsing on the server.

---

## Open Questions From the Existing Dexie Extraction Path

1. **Should the library bundle Dexie or accept any IndexedDB wrapper?** Dexie's DBCore middleware is deeply integrated into the sync approach. Supporting alternatives (e.g. idb, raw IndexedDB) would require reimplementing the middleware layer. Recommendation: **couple to Dexie** — it's the standard and the middleware API is powerful.

2. **Should the server package be framework-agnostic?** The current push/pull logic is essentially raw SQL. Providing a Drizzle adapter is convenient but limits reach. Recommendation: **provide the core logic as plain functions** that accept a database connection, plus optional framework adapters.

3. **Should file/blob sync be included?** The current system has a separate content-addressed file storage with transfer queues. This is a distinct concern from metadata sync. Recommendation: **keep it separate** as an optional companion package (`@local-sync/files`). Many apps won't need it.

4. **Custom conflict resolution?** Currently hard-coded to LWW. Some apps may want field-level merging or custom resolution. Recommendation: **start with LWW only** (covers 90% of personal app use cases), expose a conflict callback for logging/monitoring, and design the `StorageAdapter.applyRemoteChanges` signature to allow future custom resolvers.

5. **Schema migrations?** Dexie handles IndexedDB versioning, but the library should provide guidance on adding/removing synced fields and tables without breaking existing sync state. The single-table server design helps here — adding a new client table requires zero server changes.

6. **Multi-user / shared data?** The current design is single-user (scoped by `userId` on the server). Supporting shared entities (e.g. collaborative lists) would require significant changes to the permission model. Recommendation: **explicitly scope to single-user** for v1.

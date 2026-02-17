# Extracting a General-Purpose Local-First Sync Library

This document analyses the epub-reader-demo sync infrastructure and proposes what changes are needed to turn it into a standalone, reusable local-first sync library for personal apps.

---

## Current Architecture Overview

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
  const saved = localStorage.getItem('epub-reader-hlc-state');
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
  constructor(private config: {
    baseUrl: string;
    getHeaders: () => HeadersInit;
    // Optional: custom endpoint paths
    paths?: { pull?: string; push?: string; timestamp?: string };
  }) {}

  async pull(table, since, entityId?, limit?) {
    const params = new URLSearchParams({ since: String(since) });
    if (entityId) params.set('entityId', entityId);
    if (limit) params.set('limit', String(limit));
    const res = await fetch(
      `${this.config.baseUrl}/sync/${table}?${params}`,
      { headers: this.config.getHeaders() }
    );
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
  periodicSyncInterval?: number;    // default: 30_000
  throttleInterval?: number;         // default: 5_000

  // Extension points
  onSyncComplete?: (results: Map<TTables, SyncResult>) => void;
  onConflict?: (table: TTables, local: SyncItem, remote: SyncItem) => void;
  logger?: (entry: SyncLogEntry) => void;
}

export function createSyncLibrary<T extends string>(config: SyncLibraryConfig<T>) {
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

| Component | Reason |
|---|---|
| React hooks (`use-sync.ts`) | Framework-specific; provide as optional `@local-sync/react` package |
| Domain types (Book, Highlight, etc.) | App-specific |
| File storage system | Separate concern (content-addressed blobs ≠ metadata sync) |
| Transfer queue | Separate concern, though could be a companion library |
| Server framework integration (Hono routes) | Provide reference implementation + docs, not a library |
| Auth/device management | Consumer's responsibility |

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
import { createSyncLibrary } from '@local-sync/core';

const sync = createSyncLibrary({
  db: myDexieInstance,
  tables: {
    todos: { primaryKey: 'id', indices: ['listId'] },
    lists: { primaryKey: 'id' },
  },
  remoteAdapter: new FetchRemoteAdapter({
    baseUrl: 'https://api.myapp.com',
    getHeaders: () => ({ Authorization: `Bearer ${token}` }),
  }),
  deviceId: getDeviceId(),
  onSyncComplete: (results) => {
    // Invalidate your own caches here
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  },
});

sync.start();   // Begin periodic sync
sync.stop();    // Stop periodic sync
sync.destroy(); // Full cleanup
```

### Manual Sync

```ts
await sync.syncAll();                          // Sync all tables
await sync.syncTable('todos');                 // Sync one table
await sync.syncTable('todos', { entityId: listId }); // Scoped sync
await sync.pushTable('todos');                 // Push only
await sync.pullTable('todos');                 // Pull only
```

### Querying (User's Dexie)

```ts
import { isNotDeleted } from '@local-sync/core';

// User queries their own Dexie tables, filtering tombstones
const todos = await db.todos.filter(isNotDeleted).toArray();
```

### Soft Deletes

```ts
import { createTombstone } from '@local-sync/core';

// Library provides the tombstone helper
await db.todos.put(createTombstone(existingTodo));
```

### Server Setup (Reference)

```ts
import { createSyncHandlers } from '@local-sync/server';

const { handlePull, handlePush } = createSyncHandlers({
  getDb: (c) => c.get('db'),
  getUserId: (c) => c.get('user').id,
  getDeviceId: (c) => c.req.header('X-Device-ID'),
});

app.get('/api/sync/:table', handlePull);
app.post('/api/sync/:table', handlePush);
app.get('/api/sync-timestamp', (c) => c.json({ serverTimestamp: Date.now() }));
```

---

## Key Design Decisions to Preserve

1. **Single server table for all entities**: The `syncData` table with `(id, tableName, userId)` composite key and JSON `data` column means zero server migrations when adding new client-side tables. This is a huge DX win for personal apps.

2. **Pull-then-push ordering**: Pulling first ensures the client has the latest state before pushing, reducing unnecessary conflicts.

3. **Server excludes requester's own changes from pull**: The `deviceId != requester` filter prevents echo and reduces bandwidth.

4. **Tombstoning over hard deletes**: The middleware blocks `delete()` operations and forces `put()` with `_isDeleted = 1`. This ensures deletes propagate across devices.

5. **Symbol-based remote write marker**: Using `Symbol('REMOTE_WRITE')` to bypass middleware on remote applies is elegant — it's invisible to serialisation and impossible to accidentally trigger.

6. **Middleware-based metadata injection**: App code never manually sets `_hlc` or `_deviceId`. The Dexie middleware handles it transparently, making the sync system invisible to domain logic.

7. **HLC string comparison for server-side LWW**: The HLC format (`timestamp-counter-deviceId`) allows SQLite string comparison (`>`) to work directly for ordering, avoiding parsing on the server.

---

## Open Questions for Library Design

1. **Should the library bundle Dexie or accept any IndexedDB wrapper?** Dexie's DBCore middleware is deeply integrated into the sync approach. Supporting alternatives (e.g. idb, raw IndexedDB) would require reimplementing the middleware layer. Recommendation: **couple to Dexie** — it's the standard and the middleware API is powerful.

2. **Should the server package be framework-agnostic?** The current push/pull logic is essentially raw SQL. Providing a Drizzle adapter is convenient but limits reach. Recommendation: **provide the core logic as plain functions** that accept a database connection, plus optional framework adapters.

3. **Should file/blob sync be included?** The current system has a separate content-addressed file storage with transfer queues. This is a distinct concern from metadata sync. Recommendation: **keep it separate** as an optional companion package (`@local-sync/files`). Many apps won't need it.

4. **Custom conflict resolution?** Currently hard-coded to LWW. Some apps may want field-level merging or custom resolution. Recommendation: **start with LWW only** (covers 90% of personal app use cases), expose a conflict callback for logging/monitoring, and design the `StorageAdapter.applyRemoteChanges` signature to allow future custom resolvers.

5. **Schema migrations?** Dexie handles IndexedDB versioning, but the library should provide guidance on adding/removing synced fields and tables without breaking existing sync state. The single-table server design helps here — adding a new client table requires zero server changes.

6. **Multi-user / shared data?** The current design is single-user (scoped by `userId` on the server). Supporting shared entities (e.g. collaborative lists) would require significant changes to the permission model. Recommendation: **explicitly scope to single-user** for v1.

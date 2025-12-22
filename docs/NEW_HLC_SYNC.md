# HLC-Based Sync Architecture

This document outlines the implementation plan for a reusable, HLC-based sync engine using DexieJS DBCore middleware.

## Core Concepts

### 1. Two Data Patterns (Same Underlying Mechanism)

| Pattern | Description | Example |
|---------|-------------|---------|
| **Last-Write-Wins (LWW)** | Single row per entity, latest HLC wins | Highlights, Book Metadata |
| **Append-Only Log** | Each entry has unique UUID, effectively always "new" | Reading Progress Timeline |

Both patterns use the same sync mechanism — the only difference is semantic (how you model your data). Append-only can skip the read-before-write since UUIDs are unique.

### 2. Hybrid Logical Clock (HLC)

Format: `{timestamp}:{counter}:{deviceId}`

Example: `1703000000000:0001:device-abc`

- **timestamp**: Wall clock in milliseconds
- **counter**: Monotonic counter for same-millisecond operations
- **deviceId**: Unique identifier for this device/client

HLC is **global per device** — shared across all synced tables.

### 3. Sync Metadata Fields

Every synced row includes:

| Field | Type | Description |
|-------|------|-------------|
| `_hlc` | `string` | Hybrid Logical Clock value |
| `_deviceId` | `string` | Device that made this change (extracted from HLC for indexing) |
| `_serverTimestamp` | `number \| null` | Server-assigned timestamp when synced; `null` = local-only change |
| `_isDeleted` | `boolean` | Tombstone flag for soft deletes |

### 4. Determining What to Sync

**Local changes to push:** `_deviceId === thisDevice AND _serverTimestamp === null`

**Remote changes to apply:** Compare HLC — if remote HLC > local HLC, apply the change.

**Sync cursor:** Each table tracks `lastPulledServerTimestamp` to know where to resume pulling.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        SyncEngine                            │
│  - Maintains HLC state (global per device)                   │
│  - Tracks sync cursors per table                             │
│  - Coordinates pull/push operations                          │
│  - Emits change events for query invalidation                │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    DBCore Middleware                         │
│  - Intercepts all DexieJS mutations                          │
│  - Augments local writes with HLC + sync metadata            │
│  - Passes through remote writes (has _serverTimestamp)       │
│  - Filters tombstones from query results                     │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                      DexieJS / IndexedDB                     │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                     Server (Schema-less)                     │
│  - Single sync_data table for all entities                   │
│  - Stores: tableName, entityId, hlc, serverTimestamp, data   │
│  - Generic pull/push endpoints                               │
└──────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Core HLC Service

**File:** `src/lib/sync/hlc.ts`

```ts
interface HLCState {
  timestamp: number;
  counter: number;
  deviceId: string;
}

interface HLCService {
  // Generate next HLC for local operation
  next(): string;
  
  // Update HLC when receiving remote timestamp (ensures monotonicity)
  receive(remoteHlc: string): void;
  
  // Compare two HLCs: -1 (a < b), 0 (a == b), 1 (a > b)
  compare(a: string, b: string): number;
  
  // Parse HLC string into components
  parse(hlc: string): HLCState;
  
  // Get current device ID
  getDeviceId(): string;
}
```

**Implementation notes:**
- Store HLC state in localStorage/IndexedDB for persistence across sessions
- Device ID generated once and persisted (UUID v4)
- `next()` increments counter if timestamp hasn't changed, resets to 0 if timestamp advanced
- `receive()` updates local timestamp if remote is ahead (maintains causality)

---

### Phase 2: Schema Generator

**File:** `src/lib/sync/schema.ts`

```ts
interface SyncTableDef {
  primaryKey: string;
  autoIncrement?: boolean;
  indices?: string[];
  uniqueIndices?: string[];
  compoundIndices?: string[][];
  
  // For scoped server pulls (e.g., fetch progress by bookId)
  entityKey?: string;
  
  // Skip read-before-write optimization for append-only tables
  appendOnly?: boolean;
}

// Sync metadata indices added automatically
const SYNC_INDICES = ['_hlc', '_deviceId', '_serverTimestamp', '_isDeleted'];

function generateDexieStores(
  tables: Record<string, SyncTableDef>
): Record<string, string>;

// Example output:
// { highlights: 'id, bookId, _hlc, _deviceId, _serverTimestamp, _isDeleted' }
```

---

### Phase 3: DBCore Middleware

**File:** `src/lib/sync/middleware.ts`

```ts
interface SyncMiddlewareOptions {
  hlc: HLCService;
  syncedTables: Set<string>;
  onMutation?: (event: MutationEvent) => void;
}

interface MutationEvent {
  table: string;
  type: 'create' | 'update' | 'delete';
  key: string;
  value: unknown;
}

function createSyncMiddleware(options: SyncMiddlewareOptions): DexieMiddleware;
```

**Middleware behavior:**

| Operation | Has `_serverTimestamp`? | Action |
|-----------|------------------------|--------|
| `put`/`add` | No (local write) | Add `_hlc`, `_deviceId`, set `_serverTimestamp = null`, `_isDeleted = false` |
| `put`/`add` | Yes (remote apply) | Pass through unchanged (preserve remote metadata) |
| `delete` | N/A | **Blocked** — users must set `_isDeleted = true` via `put` |

**Query behavior:**
- Intercept query results to filter out `_isDeleted === true` by default
- Provide option to include tombstones for sync operations

**Key insight:** The presence of `_serverTimestamp` distinguishes local vs remote writes. No special flags needed.

---

### Phase 4: Sync Engine

**File:** `src/lib/sync/engine.ts`

```ts
interface SyncEngineConfig {
  db: Dexie;
  hlc: HLCService;
  tables: Record<string, SyncTableDef>;
  remote: RemoteAdapter;
}

interface SyncEngine {
  // Manual sync triggers
  pull(table?: string, entityId?: string): Promise<void>;
  // We push everything, not just those matching the entity ID
  push(table?: string): Promise<void>;
  sync(table?: string, entityId?: string): Promise<void>;  // pull then push
  
  // Change observation (for TanStack Query invalidation)
  onChange(
    table: string,
    callback: (events: MutationEvent[]) => void
  ): () => void;  // returns unsubscribe
  
  // Sync state
  getSyncStatus(table: string): SyncStatus;
  getLastSyncTime(table: string): Date | null;
}

interface SyncStatus {
  table: string;
  pendingPush: number;   // count where _serverTimestamp === null

  lastPulledAt: Date | null;  // when pull happened (for UI only)
  lastPushedAt: Date | null;  // when push happened (for UI only)
  isSyncing: boolean;
}
```

**Pull flow:**
1. Fetch from server: `GET /sync/:table?since={lastPulledServerTimestamp}&entityId={optional}`
2. For each remote item:
   - Read local item by primary key
   - If local doesn't exist OR `compareHLC(remote._hlc, local._hlc) > 0` → apply
3. Use DexieJS `bulkPut` with `_serverTimestamp` set (middleware passes through)
4. Update `lastPulledServerTimestamp` cursor

**Push flow:**
1. Query local items where `_deviceId === thisDevice AND _serverTimestamp === null`
2. Send to server: `POST /sync/:table` with items
3. Server responds with assigned `serverTimestamp` for each item
4. Update local items with `serverTimestamp` (marks as synced)

---

### Phase 5: Remote Adapter (Server API)

**File:** `src/lib/sync/remote.ts`

```ts
interface RemoteAdapter {
  pull(request: PullRequest): Promise<PullResponse>;
  push(request: PushRequest): Promise<PushResponse>;
}

interface PullRequest {
  table: string;
  since: number;        // serverTimestamp cursor
  entityId?: string;    // optional scoping (e.g., bookId)
  limit?: number;
}

interface PullResponse {
  items: SyncItem[];
  serverTimestamp: number;  // new cursor value
  hasMore: boolean;
}

interface PushRequest {
  table: string;
  items: SyncItem[];
}

interface PushResponse {
  results: Array<{
    id: string;
    serverTimestamp: number;
    accepted: boolean;
  }>;
}

interface SyncItem {
  id: string;
  _hlc: string;
  _deviceId: string;
  _isDeleted: boolean;
  entityId?: string;
  data: Record<string, unknown>;  // user fields as JSON
}
```

---

### Phase 6: Server Implementation

**File:** `server/lib/sync.ts`

**Database schema (single table for all sync data):**

```sql
CREATE TABLE sync_data (
  id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  entity_id TEXT,
  hlc TEXT NOT NULL,
  device_id TEXT NOT NULL,
  is_deleted INTEGER DEFAULT 0,
  server_timestamp INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  data TEXT NOT NULL,
  
  PRIMARY KEY (table_name, user_id, id)
);

-- Index for pulling changes
CREATE INDEX idx_sync_pull 
  ON sync_data(table_name, user_id, server_timestamp);

-- Index for entity-scoped pulls
CREATE INDEX idx_sync_entity 
  ON sync_data(table_name, user_id, entity_id, server_timestamp);
```

**Server endpoints:**

```ts
// Pull changes
app.get('/api/sync/:table', async (c) => {
  const { table } = c.req.param();
  const { since, entityId, limit = 100 } = c.req.query();
  const userId = c.get('user').id;
  
  const items = await db
    .select()
    .from(syncData)
    .where(
      and(
        eq(syncData.tableName, table),
        eq(syncData.userId, userId),
        gt(syncData.serverTimestamp, since),
        entityId ? eq(syncData.entityId, entityId) : undefined
      )
    )
    .orderBy(syncData.serverTimestamp)
    .limit(limit + 1);
  
  const hasMore = items.length > limit;
  const results = items.slice(0, limit);
  
  return c.json({
    items: results.map(formatSyncItem),
    serverTimestamp: results.at(-1)?.serverTimestamp ?? since,
    hasMore,
  });
});

// Push changes
app.post('/api/sync/:table', async (c) => {
  const { table } = c.req.param();
  const userId = c.get('user').id;
  const { items } = await c.req.json();
  
  // TODO: this needs to change to use D1 batched updates + also check that the setWhere clause is added where hlc is greater.
  const results = await Promise.all(
    items.map(async (item) => {
      const serverTimestamp = Date.now();
      
      await db
        .insert(syncData)
        .values({
          id: item.id,
          tableName: table,
          userId,
          entityId: item.entityId,
          hlc: item._hlc,
          deviceId: item._deviceId,
          isDeleted: item._isDeleted,
          serverTimestamp,
          data: JSON.stringify(item.data),
        })
        .onConflictDoUpdate({
          target: [syncData.tableName, syncData.userId, syncData.id],
          set: {
            hlc: item._hlc,
            deviceId: item._deviceId,
            isDeleted: item._isDeleted,
            serverTimestamp,
            data: JSON.stringify(item.data),
          },
        });
      
      return { id: item.id, serverTimestamp, accepted: true };
    })
  );
  
  return c.json({ results });
});
```

**Note:** Server doesn't compare HLCs — it just stores everything. Client does LWW comparison when applying.

---

### Phase 7: Sync Cursor Persistence

**File:** `src/lib/sync/cursors.ts`

Store sync cursors in a dedicated DexieJS table (not synced):

```ts
interface SyncCursor {
  table: string;
  entityId?: string;  // for per-entity cursors (e.g., per-book progress)
  lastPulledServerTimestamp: number;
}

// Table schema
db.version(1).stores({
  _syncCursors: '[table+entityId]',  // compound primary key
});
```

---

### Phase 8: React Integration

**File:** `src/lib/sync/hooks.ts`

```ts
// Context provider
function SyncProvider({ children, config }: SyncProviderProps);

// Access sync engine
function useSyncEngine(): SyncEngine;

// Subscribe to changes (integrates with TanStack Query)
function useSyncSubscription(
  table: string,
  options?: {
    queryKey?: unknown[];
    onChanges?: (events: MutationEvent[]) => void;
  }
): void;

// Example usage
function HighlightsPage({ bookId }: { bookId: string }) {
  const queryClient = useQueryClient();
  
  // Auto-invalidate when highlights change
  useSyncSubscription('highlights', {
    queryKey: ['highlights', bookId],
  });
  
  // Normal TanStack Query - reads directly from DexieJS
  const { data: highlights } = useQuery({
    queryKey: ['highlights', bookId],
    queryFn: () => db.highlights.where('bookId').equals(bookId).toArray(),
  });
  
  // Normal DexieJS write - middleware handles sync metadata
  const addHighlight = async (highlight: Highlight) => {
    await db.highlights.put(highlight);
    // Middleware adds _hlc, _deviceId, etc.
    // SyncEngine emits change event
    // useSyncSubscription invalidates query
  };
}
```

---

## File Structure

```
src/lib/sync/
├── index.ts           # Public exports
├── hlc.ts             # HLC service
├── schema.ts          # Schema generator
├── middleware.ts      # DBCore middleware
├── engine.ts          # Sync engine
├── remote.ts          # Remote adapter interface + implementation
├── cursors.ts         # Sync cursor persistence
├── hooks.ts           # React hooks
└── types.ts           # Shared types

server/lib/
└── sync.ts            # Server-side sync handlers
```

---

## Implementation Order

1. **HLC Service** — Foundation for everything else
2. **Schema Generator** — Needed to set up DexieJS
3. **DBCore Middleware** — Core interception logic
4. **Sync Cursors** — Persistence for sync state
5. **Remote Adapter** — Server communication interface
6. **Server Endpoints** — Backend implementation
7. **Sync Engine** — Orchestrates pull/push
8. **React Hooks** — Developer ergonomics

---

## Usage Example

```ts
// 1. Define your domain types
interface Highlight {
  id: string;
  bookId: string;
  cfiRange: string;
  color: string;
  text: string;
}

// 2. Configure sync engine
const syncConfig = {
  tables: {
    highlights: {
      primaryKey: 'id',
      indices: ['bookId'],
      entityKey: 'bookId',
    },
    readingProgress: {
      primaryKey: 'id',
      indices: ['bookId'],
      entityKey: 'bookId',
      appendOnly: true,
    },
  },
};

// 3. Initialize DexieJS with generated schema
const db = new Dexie('MyApp');
db.version(1).stores(generateDexieStores(syncConfig.tables));

// 4. Create and apply middleware
const hlcService = createHLCService({ deviceId: getOrCreateDeviceId() });
db.use(createSyncMiddleware({ hlc: hlcService, syncedTables: new Set(Object.keys(syncConfig.tables)) }));

// 5. Create sync engine
const syncEngine = createSyncEngine({
  db,
  hlc: hlcService,
  tables: syncConfig.tables,
  remote: createRemoteAdapter({ baseUrl: '/api' }),
});

// 6. Use normally!
await db.highlights.put({
  id: 'h1',
  bookId: 'book-123',
  cfiRange: 'epubcfi(...)',
  color: 'yellow',
  text: 'Important quote',
});
// ✅ Middleware adds _hlc, _deviceId, _serverTimestamp=null, _isDeleted=false

// 7. Sync when ready
await syncEngine.sync('highlights');
```

---

## Edge Cases & Considerations

### Tombstone Garbage Collection
- Not implemented initially
- Future: Server cron job to delete tombstones older than X days
- Requires all clients to sync within X days

### Conflict Resolution
- Pure LWW based on HLC comparison
- No merge strategies — last write wins entirely
- For append-only tables, conflicts don't exist (each entry is unique)

### Offline Support
- Local writes work offline (middleware adds metadata)
- Sync when back online
- No special handling needed — just call `sync()` when connectivity restored

### Large Data Sets
- Per-entity cursors for tables like `readingProgress`
- Pagination in pull responses (`hasMore` flag)
- Consider chunking push requests for large batches

### Schema Migrations
- Client-side: Normal DexieJS versioning
- Server-side: Schema-less, so no migrations needed
- The `data` JSON blob absorbs schema changes

---

## Testing Strategy

### Unit Tests
- HLC service: generation, comparison, receive logic
- Schema generator: correct DexieJS schema strings
- Middleware: correct metadata injection, passthrough for remote writes

### Integration Tests
- Full sync cycle: local write → push → pull on another client
- Conflict resolution: concurrent writes, verify LWW behavior
- Tombstone handling: delete → sync → verify tombstone propagates

### Test Utilities
```ts
// Create isolated test environment
function createTestSyncEnv() {
  const db = new Dexie('TestDB', { indexedDB: fakeIndexedDB });
  const hlc = createHLCService({ deviceId: 'test-device' });
  // ... setup middleware and engine
  return { db, hlc, syncEngine };
}
```

---

## Future Extensions

1. **Operational Transforms** — For collaborative editing (beyond LWW)
2. **Selective Sync** — Only sync certain entities (e.g., recently opened books)
3. **Real-time Sync** — WebSocket-based push notifications
4. **SQLite Adapter** — For desktop apps (same middleware pattern)
5. **Sync Compression** — Delta encoding for large payloads

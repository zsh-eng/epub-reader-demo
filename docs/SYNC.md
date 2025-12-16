Based on my exploration of your codebase, I can see you have a solid foundation with Dexie/IndexedDB for local storage, React Query for data management, and a well-structured EPUB parser. Let me help you think through the sync architecture.

## Architecture Overview

Here's how I'd structure the synchronization system:

### 1. Book Deduplication Strategy

Your current ID generation is time-based (`${Date.now()}-${randomString()}`), which won't detect duplicates. I'd recommend a **content-based hash**:

```epub-reader-demo/dev/null/content-hash.ts#L1-20
// Generate a deterministic book ID from content
async function generateBookContentHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// For faster duplicate detection during import:
function generateQuickHash(book: { title: string; author: string; fileSize: number }): string {
  const identifier = `${book.title}|${book.author}|${book.fileSize}`;
  // Simple hash for quick local dedup, full hash for sync
  return btoa(identifier);
}
```

**Benefits:**

- Same file = same hash across all devices
- Upload once to R2, reference by content hash
- Local dedup: check quick hash first, then full hash
- Cross-device: server can check if `books/{contentHash}.epub` already exists in R2

### 2. Server-Side Schema (D1)

```epub-reader-demo/dev/null/schema.sql#L1-65
-- Better Auth manages users/sessions tables

-- Device registry for session management
CREATE TABLE user_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL, -- Generated on first visit, stored locally
  device_name TEXT, -- "Chrome on MacBook Pro"
  ua_string TEXT,
  device_type TEXT, -- "desktop", "mobile", "tablet"
  browser TEXT,
  os TEXT,
  last_active_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, client_id)
);

-- Books (content-addressed)
CREATE TABLE books (
  content_hash TEXT PRIMARY KEY, -- SHA-256 of EPUB file
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  cover_r2_key TEXT, -- covers/{hash}.jpg
  epub_r2_key TEXT NOT NULL, -- books/{hash}.epub
  file_size INTEGER,
  metadata JSON, -- publisher, language, etc.
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User's library (junction table)
CREATE TABLE user_books (
  user_id TEXT NOT NULL REFERENCES users(id),
  book_hash TEXT NOT NULL REFERENCES books(content_hash),
  date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, book_hash)
);

-- Reading progress (append-only for history, with "current" view)
CREATE TABLE reading_progress_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  book_hash TEXT NOT NULL,
  device_id TEXT NOT NULL,
  spine_index INTEGER NOT NULL,
  scroll_progress REAL NOT NULL, -- 0.0 to 1.0
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id, book_hash) REFERENCES user_books(user_id, book_hash)
);

-- Highlights (sync-able)
CREATE TABLE highlights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_hash TEXT NOT NULL,
  spine_item_id TEXT NOT NULL,
  start_offset INTEGER,
  end_offset INTEGER,
  selected_text TEXT,
  text_before TEXT,
  text_after TEXT,
  color TEXT,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME,
  deleted_at DATETIME, -- Soft delete for sync
  FOREIGN KEY (user_id, book_hash) REFERENCES user_books(user_id, book_hash)
);
```

### 3. Reading Progress: Append-Only Log

Your idea about storing all positions is good! Here's the strategy:

```epub-reader-demo/dev/null/progress-sync.ts#L1-45
// Server-side: Get current reading position with conflict info
interface ProgressResponse {
  current: {
    spineIndex: number;
    scrollProgress: number;
    deviceId: string;
    deviceName: string;
    recordedAt: Date;
  };
  // If another device has more recent progress
  conflict?: {
    spineIndex: number;
    scrollProgress: number;
    deviceId: string;
    deviceName: string;
    recordedAt: Date;
  };
}

// Client-side: On opening a book
async function reconcileProgress(bookId: string, localProgress: ReadingProgress) {
  const serverProgress = await api.getProgress(bookId);

  // No server data, use local
  if (!serverProgress.current) return localProgress;

  // Server is from same device, use latest
  if (serverProgress.current.deviceId === deviceId) {
    return serverProgress.current.recordedAt > localProgress.lastRead
      ? serverProgress.current
      : localProgress;
  }

  // Different device - check if server is significantly ahead
  const serverIsAhead = serverProgress.current.spineIndex > localProgress.currentSpineIndex
    || (serverProgress.current.spineIndex === localProgress.currentSpineIndex
        && serverProgress.current.scrollProgress > localProgress.scrollProgress + 0.1);

  if (serverIsAhead) {
    // Show UI: "Continue from Chapter X on your MacBook?"
    return promptUserForChoice(localProgress, serverProgress.current);
  }

  return localProgress;
}
```

**Reading History Benefits:**

- Track reading sessions over time
- Calculate reading speed/time per book
- Show "last read on [device]" in UI
- Eventually: reading statistics dashboard

### 4. Sync Queue for Offline-First

Add to your Dexie schema:

```epub-reader-demo/dev/null/sync-schema.ts#L1-40
// New tables for sync support
interface SyncQueueItem {
  id: string;
  operation: 'create' | 'update' | 'delete';
  entityType: 'progress' | 'highlight' | 'book';
  entityId: string;
  payload: unknown;
  createdAt: Date;
  retryCount: number;
}

interface SyncMeta {
  entityType: string;
  entityId: string;
  localVersion: number;
  serverVersion: number;
  lastSyncedAt: Date;
}

// Extend your DB class
class EPUBReaderDB extends Dexie {
  // ... existing tables
  syncQueue!: Table<SyncQueueItem, string>;
  syncMeta!: Table<SyncMeta, [string, string]>;

  constructor() {
    super("epub-reader-db");

    this.version(3).stores({
      // ... existing stores
      syncQueue: "id, entityType, createdAt",
      syncMeta: "[entityType+entityId], lastSyncedAt",
    });
  }
}
```

### 5. Session/Device Management

```epub-reader-demo/dev/null/device-service.ts#L1-50
// On first visit, generate and store device identity
async function getOrCreateDeviceId(): Promise<string> {
  let deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem('deviceId', deviceId);
  }
  return deviceId;
}

// Parse UA for device info (consider using ua-parser-js library)
function getDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent;
  // Use ua-parser-js or similar
  const parser = new UAParser(ua);
  const result = parser.getResult();

  return {
    deviceType: result.device.type || 'desktop',
    browser: `${result.browser.name} ${result.browser.major}`,
    os: `${result.os.name} ${result.os.version}`,
    deviceName: generateDeviceName(result), // "Chrome on MacBook Pro"
  };
}

// On login, register this device
async function registerDevice(accessToken: string) {
  const deviceId = await getOrCreateDeviceId();
  const deviceInfo = getDeviceInfo();

  await fetch('/api/auth/devices', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientId: deviceId,
      ...deviceInfo,
    }),
  });
}
```

### 6. API Design

```epub-reader-demo/dev/null/api-routes.md#L1-35
## Auth (Better Auth)
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/session
GET    /api/auth/devices          - List user's devices
DELETE /api/auth/devices/:id      - Revoke device/session

## Books
GET    /api/books                 - List user's library
POST   /api/books                 - Upload book (checks content hash first)
GET    /api/books/:hash           - Get book metadata
DELETE /api/books/:hash           - Remove from library
GET    /api/books/:hash/download  - Get presigned R2 URL

## Progress
GET    /api/books/:hash/progress  - Get current + conflict info
POST   /api/books/:hash/progress  - Record new position
GET    /api/books/:hash/progress/history?days=30 - Reading history

## Highlights
GET    /api/books/:hash/highlights
POST   /api/books/:hash/highlights
PATCH  /api/books/:hash/highlights/:id
DELETE /api/books/:hash/highlights/:id

## Sync (batch operations for offline recovery)
POST   /api/sync                  - Push queued changes, get updates
```

### 7. Data Flow Diagram

```epub-reader-demo/dev/null/flow.md#L1-25
┌─────────────────────────────────────────────────────────────┐
│                      User Action                             │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              IndexedDB (Dexie) - Source of Truth             │
│  • Immediate optimistic update                               │
│  • Add to syncQueue if logged in                            │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              React Query - UI State                          │
│  • Invalidate/update cache                                   │
│  • Optimistic UI                                            │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│         Service Worker - Background Sync                     │
│  • Process syncQueue when online                            │
│  • Retry failed requests                                    │
│  • Handle conflicts                                         │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│         Cloudflare Workers + D1 + R2                        │
└─────────────────────────────────────────────────────────────┘
```

### Key Questions to Decide

1. **Book deduplication granularity**: Full file SHA-256 is most accurate but slow. Want quick hash for UX + full hash for sync?

2. **Progress conflict resolution**: Auto-pick latest? Or show "Resume from Chapter X on MacBook?" dialog?

3. **Sync frequency**: Your current 3-second debounce for local saves is good. For server sync, I'd suggest:
   - Immediate on chapter change
   - Debounced (5-10s) for scroll progress
   - Batch sync on app open/close

4. **Offline book retention**: Keep all books offline forever, or prune books not accessed in X days?

5. **Highlight sync strategy**: Merge all highlights, or show conflicts for overlapping ranges?

Want me to dive deeper into any of these areas, or shall I create a more detailed spec document you can work from?

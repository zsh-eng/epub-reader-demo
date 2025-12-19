1. Soft Deletes

You're absolutely right - soft deletes are essential for sync. Without them, we can't propagate deletions to other devices. Here's the pattern I'd suggest:

```epub-reader-demo/dev/null/soft-delete-pattern.ts#L1-25
// Server schema pattern for all sync-able entities
interface SyncableEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null; // null = active, timestamp = soft deleted
}

// Sync protocol includes deleted items
interface SyncResponse<T> {
  items: T[];           // Includes items where deletedAt is set
  deletedIds: string[]; // Convenience: just IDs of deleted items
  serverTimestamp: Date;
}

// Client handling
function applySyncResponse<T extends { id: string; deletedAt?: Date }>(
  items: T[],
  localTable: Table<T, string>
) {
  for (const item of items) {
    if (item.deletedAt) {
      await localTable.delete(item.id); // Hard delete locally
    } else {
      await localTable.put(item);
    }
  }
}
```

For R2 cleanup, I'd suggest a scheduled Cloudflare Worker (cron trigger) that:
1. Finds books where ALL user_books references are soft-deleted (orphaned books)
2. Waits 30 days past the last deletion
3. Removes from R2 and hard-deletes the book record

## 2. LWW with Client Timestamps

I agree with your pragmatic assessment. For single-user, multi-device scenarios with disjoint reading sessions, LWW works well. The edge cases where it fails (device with wrong clock, simultaneous reading) are rare and non-catastrophic.

A few refinements to make it more robust:

```epub-reader-demo/dev/null/lww-refinements.ts#L1-40
// Use monotonic "logical clocks" alongside wall clocks
interface ReadingProgressEntry {
  userId: string;
  bookHash: string;
  deviceId: string;
  
  spineIndex: number;
  scrollProgress: number;
  
  // Timestamps
  clientTimestamp: Date;    // Client's wall clock (for LWW)
  serverTimestamp?: Date;   // Set by server on receipt
  
  // For debugging clock issues
  clientMonotonicMs?: number; // performance.now() or similar
}

// Server-side: Accept client timestamp but also record server time
// This lets us detect egregiously wrong client clocks
function recordProgress(entry: ReadingProgressEntry) {
  const serverNow = new Date();
  const drift = serverNow.getTime() - entry.clientTimestamp.getTime();
  
  // If client clock is >1 hour off, log a warning but still accept
  // We use client time for LWW, server time for audit trail
  if (Math.abs(drift) > 3600000) {
    console.warn(`Large clock drift detected: ${drift}ms for device ${entry.deviceId}`);
  }
  
  return db.readingProgressLog.insert({
    ...entry,
    serverTimestamp: serverNow,
  });
}

// For the "current position" view, we still use client timestamp for LWW
// but could fall back to server timestamp if we detect bad clocks
```

The append-only log approach you mentioned in the SYNC.md doc is great for history/analytics. For conflict resolution, we just care about "most recent by client timestamp."

## 3. Device ID (Separate from Sessions)

You're correct to separate these. Here's my suggested implementation:

```epub-reader-demo/dev/null/device-id.ts#L1-50
// src/lib/device.ts
const DEVICE_ID_KEY = 'epub-reader-device-id';

export function getOrCreateDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

// Parsed device info for display purposes
export function getDeviceInfo(): DeviceInfo {
  // Using ua-parser-js would be cleaner, but this works
  const ua = navigator.userAgent;
  return {
    browser: detectBrowser(ua),
    os: detectOS(ua),
    deviceType: detectDeviceType(ua),
    name: generateFriendlyName(), // "Chrome on macOS"
  };
}

// Include device ID in API requests
// Option 1: Header (cleaner)
export const honoClient = hono.client<AppType>(getBaseUrl(), {
  headers: () => ({
    'X-Device-ID': getOrCreateDeviceId(),
  }),
});

// Option 2: Middleware that adds to request context
// In your API client wrapper
```

For the server-side device registry:

```epub-reader-demo/dev/null/device-schema.ts#L1-30
// server/db/schema.ts
export const userDevices = sqliteTable("user_devices", {
  id: text("id").primaryKey(), // UUID
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(), // The localStorage UUID
  deviceName: text("device_name"),
  browser: text("browser"),
  os: text("os"),
  deviceType: text("device_type"),
  lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
}, (table) => ({
  userClientUnique: unique().on(table.userId, table.clientId),
}));
```

The key insight is:
- **Session** = authentication token, rotates on login/logout
- **Device ID** = stable identifier for "this browser instance", persists forever

## 4. Service Worker for Background Sync

This is the most architecturally interesting question. You're already using `vite-plugin-pwa` with Workbox. To add custom sync logic, you'd switch to `injectManifest` mode:

```epub-reader-demo/dev/null/vite-sw-config.ts#L1-20
// vite.config.ts - modified PWA config
VitePWA({
  strategies: 'injectManifest',  // Instead of 'generateSW'
  srcDir: 'src',
  filename: 'sw.ts',
  registerType: 'autoUpdate',
  injectManifest: {
    injectionPoint: undefined, // or specify where to inject precache manifest
  },
  // ... rest of config
})
```

However, I'd suggest a **hybrid approach** rather than pure service worker sync:

### Architecture Proposal

```epub-reader-demo/dev/null/sync-architecture.md#L1-60
## Sync Architecture

### Layers:
1. **Local Database (Dexie/IndexedDB)** - Source of truth for offline-first
2. **Sync Queue Table** - Pending operations waiting to sync
3. **Sync Service (Main Thread)** - Coordinates sync, handles conflicts
4. **Background Sync (Service Worker)** - Opportunistic sync when offline->online

### Why Hybrid?

Pure SW sync has issues:
- Limited browser support for Background Sync API (mainly Chromium)
- Debugging is harder
- Complex coordination with main thread state

### Proposed Flow:

**On User Action (e.g., change reading position):**
1. Write to local `readingProgress` table immediately
2. Add entry to `syncQueue` table
3. If online, trigger sync from main thread
4. If offline, let service worker handle it via Background Sync

**Sync Service (Main Thread):**
```
class SyncService {
  private syncInProgress = false;
  
  async triggerSync() {
    if (this.syncInProgress || !navigator.onLine) return;
    this.syncInProgress = true;
    
    try {
      const queue = await db.syncQueue.toArray();
      if (queue.length === 0) return;
      
      const response = await honoClient.sync.$post({
        json: { operations: queue, deviceId: getDeviceId() }
      });
      
      // Apply remote changes, clear processed queue items
      await this.applyServerResponse(response);
    } finally {
      this.syncInProgress = false;
    }
  }
}
```

**Service Worker (Fallback):**
- Register for Background Sync
- On `sync` event, do same logic as SyncService
- Use BroadcastChannel to notify main thread of completed sync
```

### For the "Jump to Position" Notification

```epub-reader-demo/dev/null/sync-prompt.ts#L1-45
// Local storage for dismissed prompts
interface DismissedSyncPrompt {
  bookId: string;
  dismissedAt: Date;
  remoteTimestamp: Date; // The remote progress timestamp we dismissed
}

// On opening a book
async function checkForSyncPrompt(bookId: string, localProgress: ReadingProgress) {
  // 1. Fetch latest progress from server
  const remoteProgress = await fetchLatestProgress(bookId);
  if (!remoteProgress || remoteProgress.deviceId === getDeviceId()) {
    return null; // No remote progress, or it's from this device
  }
  
  // 2. Check if we already dismissed this
  const dismissed = await db.dismissedSyncPrompts.get(bookId);
  if (dismissed && dismissed.remoteTimestamp >= remoteProgress.recordedAt) {
    return null; // Already dismissed this or newer
  }
  
  // 3. Check if remote is meaningfully different
  const isAhead = 
    remoteProgress.spineIndex > localProgress.currentSpineIndex ||
    (remoteProgress.spineIndex === localProgress.currentSpineIndex &&
     remoteProgress.scrollProgress > localProgress.scrollProgress + 0.05);
  
  if (!isAhead) return null;
  
  // 4. Return prompt data
  return {
    remoteProgress,
    onAccept: async () => {
      await applyRemoteProgress(bookId, remoteProgress);
    },
    onDismiss: async () => {
      await db.dismissedSyncPrompts.put({
        bookId,
        dismissedAt: new Date(),
        remoteTimestamp: remoteProgress.recordedAt,
      });
    },
  };
}
```

### Avoiding Race Conditions

The main concern is the service worker and main thread both accessing IndexedDB. Solutions:

1. **Locking via `navigator.locks` API** (good browser support):
```epub-reader-demo/dev/null/sync-lock.ts#L1-12
async function performSync() {
  await navigator.locks.request('epub-sync', async () => {
    // Only one context (main or SW) can hold this lock
    const queue = await db.syncQueue.toArray();
    // ... sync logic
  });
}
```

2. **Optimistic versioning** - Each record has a local version number, compare before overwrite

3. **Message passing** - SW sends message to main thread, main thread does all DB writes

---

**My Recommendation:** Start with main-thread sync only (simpler to debug), add service worker Background Sync as an enhancement later. The user experience difference is minimal - the main thread can sync on:
- `online` event
- Visibility change (tab becomes active)
- Explicit user action
- Periodic interval when online

Would you like me to draft the actual schema additions and sync service implementation, or do you want to discuss any of these points further first?

/**
 * Sync Engine Tests
 *
 * Tests the sync engine with mock storage and remote adapters.
 * Covers push, pull, conflict resolution, and full sync cycles.
 */

import { createHLCService } from "@/lib/sync/hlc/hlc";
import type { SyncItem } from "@/lib/sync/storage-adapter";
import { createSyncEngine, type SyncEngine } from "@/lib/sync/sync-engine";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createMockRemoteAdapter,
  createMockStorageAdapter,
  type MockRemoteAdapter,
  type MockStorageAdapter,
} from "./mocks/sync-adapters";

describe("Sync Engine", () => {
  let storage: MockStorageAdapter;
  let remote: MockRemoteAdapter;
  let hlc: ReturnType<typeof createHLCService>;
  let engine: SyncEngine;

  beforeEach(() => {
    storage = createMockStorageAdapter();
    remote = createMockRemoteAdapter();
    hlc = createHLCService("device-1");
    engine = createSyncEngine(storage, remote, hlc);
  });

  describe("Push", () => {
    it("should push pending local changes to server", async () => {
      // Setup: Create local items that need syncing
      const items: SyncItem[] = [
        {
          id: "item-1",
          entityId: "book-1",
          _hlc: hlc.next(),
          _deviceId: "device-1",
          _isDeleted: false,
          _serverTimestamp: null, // Pending sync
          data: { text: "Highlight 1", color: "yellow" },
        },
        {
          id: "item-2",
          entityId: "book-1",
          _hlc: hlc.next(),
          _deviceId: "device-1",
          _isDeleted: false,
          _serverTimestamp: null, // Pending sync
          data: { text: "Highlight 2", color: "blue" },
        },
      ];

      storage.setItems("highlights", items);

      // Execute push
      const result = await engine.push("highlights");

      // Verify results
      expect(result.pushed).toBe(2);
      expect(result.errors).toHaveLength(0);

      // Verify items are on the server
      const serverItems = remote.getServerItems("highlights");
      expect(serverItems).toHaveLength(2);
      expect(serverItems[0]._serverTimestamp).not.toBeNull();
      expect(serverItems[1]._serverTimestamp).not.toBeNull();

      // Verify local items are marked as synced
      const localItems = storage.getAllItems("highlights");
      expect(localItems[0]._serverTimestamp).not.toBeNull();
      expect(localItems[1]._serverTimestamp).not.toBeNull();
    });

    it("should ignore entityId for push", async () => {
      const items: SyncItem[] = [
        {
          id: "item-1",
          entityId: "book-1",
          _hlc: hlc.next(),
          _deviceId: "device-1",
          _isDeleted: false,
          _serverTimestamp: null,
          data: { text: "Book 1 highlight" },
        },
        {
          id: "item-2",
          entityId: "book-2",
          _hlc: hlc.next(),
          _deviceId: "device-1",
          _isDeleted: false,
          _serverTimestamp: null,
          data: { text: "Book 2 highlight" },
        },
      ];

      storage.setItems("highlights", items);
      const result = await engine.push("highlights", { entityId: "book-1" });

      expect(result.pushed).toBe(2);
      const serverItems = remote.getServerItems("highlights");
      expect(serverItems).toHaveLength(2);
      expect(serverItems[0].entityId).toBe("book-1");
    });

    it("should respect push limit", async () => {
      const items: SyncItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        entityId: "book-1",
        _hlc: hlc.next(),
        _deviceId: "device-1",
        _isDeleted: false,
        _serverTimestamp: null,
        data: { text: `Highlight ${i}` },
      }));

      storage.setItems("highlights", items);

      // Push only 5 items
      const result = await engine.push("highlights", { pushLimit: 5 });

      expect(result.pushed).toBe(5);

      const serverItems = remote.getServerItems("highlights");
      expect(serverItems).toHaveLength(5);
    });

    it("should handle deleted items", async () => {
      const items: SyncItem[] = [
        {
          id: "item-1",
          entityId: "book-1",
          _hlc: hlc.next(),
          _deviceId: "device-1",
          _isDeleted: true, // Tombstone
          _serverTimestamp: null,
          data: { text: "Deleted highlight" },
        },
      ];

      storage.setItems("highlights", items);

      const result = await engine.push("highlights");

      expect(result.pushed).toBe(1);

      const serverItems = remote.getServerItems("highlights");
      expect(serverItems[0]._isDeleted).toBe(true);
    });

    it("should handle empty pending changes", async () => {
      // No pending items
      const result = await engine.push("highlights");

      expect(result.pushed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Pull", () => {
    it("should pull remote changes and apply to local storage", async () => {
      // Setup: Items on server
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      const serverItems: SyncItem[] = [
        {
          id: "item-1",
          entityId: "book-1",
          _hlc: "1704067200000-0-device-2",
          _deviceId: "device-2",
          _isDeleted: false,
          _serverTimestamp: serverTime,
          data: { text: "Remote highlight 1" },
        },
        {
          id: "item-2",
          entityId: "book-1",
          _hlc: "1704067200001-0-device-2",
          _deviceId: "device-2",
          _isDeleted: false,
          _serverTimestamp: serverTime,
          data: { text: "Remote highlight 2" },
        },
      ];

      remote.setServerItems("highlights", serverItems);

      // Execute pull
      const result = await engine.pull("highlights");

      // Verify results
      expect(result.pulled).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(result.hasMore).toBe(false);

      // Verify items are in local storage
      const localItems = storage.getAllItems("highlights");
      expect(localItems).toHaveLength(2);
      expect(localItems[0].data.text).toBe("Remote highlight 1");
      expect(localItems[1].data.text).toBe("Remote highlight 2");

      // Verify cursor was updated
      const cursor = await storage.getSyncCursor("highlights");
      expect(cursor).toBe(serverTime);
    });

    it("should only pull items since last cursor", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Set initial cursor
      await storage.setSyncCursor("highlights", serverTime - 1000);

      const serverItems: SyncItem[] = [
        {
          id: "item-old",
          entityId: "book-1",
          _hlc: "1704067200000-0-device-2",
          _deviceId: "device-2",
          _isDeleted: false,
          _serverTimestamp: serverTime - 2000, // Before cursor
          data: { text: "Old highlight" },
        },
        {
          id: "item-new",
          entityId: "book-1",
          _hlc: "1704067200001-0-device-2",
          _deviceId: "device-2",
          _isDeleted: false,
          _serverTimestamp: serverTime, // After cursor
          data: { text: "New highlight" },
        },
      ];

      remote.setServerItems("highlights", serverItems);

      const result = await engine.pull("highlights");

      // Should only pull the new item
      expect(result.pulled).toBe(1);

      const localItems = storage.getAllItems("highlights");
      expect(localItems).toHaveLength(1);
      expect(localItems[0].id).toBe("item-new");
    });

    it("should filter by entityId when provided", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      const serverItems: SyncItem[] = [
        {
          id: "item-1",
          entityId: "book-1",
          _hlc: "1704067200000-0-device-2",
          _deviceId: "device-2",
          _isDeleted: false,
          _serverTimestamp: serverTime,
          data: { text: "Book 1 highlight" },
        },
        {
          id: "item-2",
          entityId: "book-2",
          _hlc: "1704067200001-0-device-2",
          _deviceId: "device-2",
          _isDeleted: false,
          _serverTimestamp: serverTime,
          data: { text: "Book 2 highlight" },
        },
      ];

      remote.setServerItems("highlights", serverItems);

      // Pull only book-1 items
      const result = await engine.pull("highlights", { entityId: "book-1" });

      expect(result.pulled).toBe(1);

      const localItems = storage.getAllItems("highlights");
      expect(localItems).toHaveLength(1);
      expect(localItems[0].entityId).toBe("book-1");
    });

    it("should respect pull limit and report hasMore", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      const serverItems: SyncItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        entityId: "book-1",
        _hlc: `${1704067200000 + i}-0-device-2`,
        _deviceId: "device-2",
        _isDeleted: false,
        _serverTimestamp: serverTime + i,
        data: { text: `Highlight ${i}` },
      }));

      remote.setServerItems("highlights", serverItems);

      // Pull only 5 items
      const result = await engine.pull("highlights", { pullLimit: 5 });

      expect(result.pulled).toBe(5);
      expect(result.hasMore).toBe(true);

      const localItems = storage.getAllItems("highlights");
      expect(localItems).toHaveLength(5);
    });

    it("should handle empty pull result", async () => {
      const result = await engine.pull("highlights");

      expect(result.pulled).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });
  });

  describe("Conflict Resolution", () => {
    it("should resolve conflicts using Last-Write-Wins (remote wins)", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Local item with older HLC
      const localItem: SyncItem = {
        id: "item-1",
        entityId: "book-1",
        _hlc: "1704067200000-0-device-1",
        _deviceId: "device-1",
        _isDeleted: false,
        _serverTimestamp: serverTime - 1000,
        data: { text: "Local version", version: 1 },
      };

      storage.setItems("highlights", [localItem]);

      // Remote item with newer HLC
      const remoteItem: SyncItem = {
        id: "item-1",
        entityId: "book-1",
        _hlc: "1704067300000-0-device-2", // Newer timestamp
        _deviceId: "device-2",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: { text: "Remote version", version: 2 },
      };

      remote.setServerItems("highlights", [remoteItem]);

      // Pull should detect and resolve conflict
      const result = await engine.pull("highlights");

      expect(result.pulled).toBe(1);
      expect(result.conflicts).toBe(0); // Remote won, no conflict (item was applied)

      // Remote version should win
      const localItems = storage.getAllItems("highlights");
      expect(localItems[0].data.text).toBe("Remote version");
      expect(localItems[0].data.version).toBe(2);
      expect(localItems[0]._hlc).toBe(remoteItem._hlc);
    });

    it("should resolve conflicts using Last-Write-Wins (local wins)", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Local item with newer HLC
      const localItem: SyncItem = {
        id: "item-1",
        entityId: "book-1",
        _hlc: "1704067300000-0-device-1", // Newer timestamp
        _deviceId: "device-1",
        _isDeleted: false,
        _serverTimestamp: null, // Not yet synced
        data: { text: "Local version", version: 2 },
      };

      storage.setItems("highlights", [localItem]);

      // Remote item with older HLC
      const remoteItem: SyncItem = {
        id: "item-1",
        entityId: "book-1",
        _hlc: "1704067200000-0-device-2", // Older timestamp
        _deviceId: "device-2",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: { text: "Remote version", version: 1 },
      };

      remote.setServerItems("highlights", [remoteItem]);

      // Pull should detect conflict
      const result = await engine.pull("highlights");

      expect(result.pulled).toBe(0); // Nothing pulled (local won)
      expect(result.conflicts).toBe(1); // Conflict detected (remote was skipped)

      // Local version should win (newer HLC)
      const localItems = storage.getAllItems("highlights");
      expect(localItems[0].data.text).toBe("Local version");
      expect(localItems[0].data.version).toBe(2);
      expect(localItems[0]._hlc).toBe(localItem._hlc);
    });

    it("should handle same HLC (server wins ties)", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      const sameHlc = "1704067200000-0-device-1";

      // Local item
      const localItem: SyncItem = {
        id: "item-1",
        entityId: "book-1",
        _hlc: sameHlc,
        _deviceId: "device-1",
        _isDeleted: false,
        _serverTimestamp: null,
        data: { text: "Local version" },
      };

      storage.setItems("highlights", [localItem]);

      // Remote item with same HLC (shouldn't happen but test the edge case)
      const remoteItem: SyncItem = {
        id: "item-1",
        entityId: "book-1",
        _hlc: sameHlc,
        _deviceId: "device-1",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: { text: "Remote version" },
      };

      remote.setServerItems("highlights", [remoteItem]);

      const result = await engine.pull("highlights");

      expect(result.pulled).toBe(1);

      // Server should win ties
      const localItems = storage.getAllItems("highlights");
      expect(localItems[0].data.text).toBe("Remote version");
    });

    it("should update HLC clock when receiving remote timestamps", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Remote item with a specific HLC
      const remoteHlc = "1704067300000-5-device-2";
      const remoteItem: SyncItem = {
        id: "item-1",
        entityId: "book-1",
        _hlc: remoteHlc,
        _deviceId: "device-2",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: { text: "Remote highlight" },
      };

      remote.setServerItems("highlights", [remoteItem]);

      // Pull the item
      const result = await engine.pull("highlights");

      // Verify the item was pulled
      expect(result.pulled).toBe(1);

      // Verify the item is in local storage with remote HLC
      const localItems = storage.getAllItems("highlights");
      expect(localItems[0]._hlc).toBe(remoteHlc);
    });
  });

  describe("Full Sync", () => {
    it("should perform push then pull in correct order", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Local pending item
      const localItem: SyncItem = {
        id: "local-1",
        entityId: "book-1",
        _hlc: hlc.next(),
        _deviceId: "device-1",
        _isDeleted: false,
        _serverTimestamp: null,
        data: { text: "Local highlight" },
      };

      storage.setItems("highlights", [localItem]);

      // Remote item
      const remoteItem: SyncItem = {
        id: "remote-1",
        entityId: "book-1",
        _hlc: "1704067200000-0-device-2",
        _deviceId: "device-2",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: { text: "Remote highlight" },
      };

      remote.setServerItems("highlights", [remoteItem]);

      // Execute full sync
      const result = await engine.sync("highlights");

      // Verify both push and pull happened
      expect(result.pushed).toBe(1);
      expect(result.pulled).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify final state
      const localItems = storage.getAllItems("highlights");
      expect(localItems).toHaveLength(2);

      const serverItems = remote.getServerItems("highlights");
      expect(serverItems).toHaveLength(2);
    });

    it("should sync multiple items with conflicts", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Local items (some pending, some conflicting)
      const localItems: SyncItem[] = [
        {
          id: "item-1",
          entityId: "book-1",
          _hlc: "1704067300000-0-device-1", // Newer
          _deviceId: "device-1",
          _isDeleted: false,
          _serverTimestamp: null,
          data: { text: "Local wins", version: 2 },
        },
        {
          id: "item-2",
          entityId: "book-1",
          _hlc: hlc.next(),
          _deviceId: "device-1",
          _isDeleted: false,
          _serverTimestamp: null,
          data: { text: "New local item" },
        },
      ];

      storage.setItems("highlights", localItems);

      // Remote items (some overlapping, some new)
      const remoteItems: SyncItem[] = [
        {
          id: "item-1",
          entityId: "book-1",
          _hlc: "1704067200000-0-device-2", // Older
          _deviceId: "device-2",
          _isDeleted: false,
          _serverTimestamp: serverTime,
          data: { text: "Remote loses", version: 1 },
        },
        {
          id: "item-3",
          entityId: "book-1",
          _hlc: "1704067200001-0-device-2",
          _deviceId: "device-2",
          _isDeleted: false,
          _serverTimestamp: serverTime,
          data: { text: "New remote item" },
        },
      ];

      remote.setServerItems("highlights", remoteItems);

      const result = await engine.sync("highlights");

      expect(result.pushed).toBe(2);
      expect(result.pulled).toBe(1); // Only item-2 was pulled (item-1 local won)

      const finalLocal = storage.getAllItems("highlights");
      expect(finalLocal).toHaveLength(3);

      const item1 = finalLocal.find((item) => item.id === "item-1");
      expect(item1?.data.text).toBe("Local wins");
    });
  });

  describe("Sync Multiple Tables", () => {
    it("should sync all tables in sequence", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Setup data for multiple tables
      storage.setItems("highlights", [
        {
          id: "h1",
          _hlc: hlc.next(),
          _deviceId: "device-1",
          _isDeleted: false,
          _serverTimestamp: null,
          data: { text: "Highlight" },
        },
      ]);

      storage.setItems("bookmarks", [
        {
          id: "b1",
          _hlc: hlc.next(),
          _deviceId: "device-1",
          _isDeleted: false,
          _serverTimestamp: null,
          data: { name: "Bookmark" },
        },
      ]);

      const results = await engine.syncAll(["highlights", "bookmarks"]);

      expect(results.size).toBe(2);
      expect(results.get("highlights")?.pushed).toBe(1);
      expect(results.get("bookmarks")?.pushed).toBe(1);
    });
  });

  describe("Cursor Management", () => {
    it("should initialize cursor to current server time", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      await engine.initializeSyncCursor("highlights");

      const cursor = await storage.getSyncCursor("highlights");
      expect(cursor).toBe(serverTime);
    });

    it("should support entity-scoped cursors", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      await engine.initializeSyncCursor("progress", "book-1");
      await engine.initializeSyncCursor("progress", "book-2");

      const cursor1 = await storage.getSyncCursor("progress", "book-1");
      const cursor2 = await storage.getSyncCursor("progress", "book-2");

      expect(cursor1).toBe(serverTime);
      expect(cursor2).toBe(serverTime);

      // Cursors should be independent
      await storage.setSyncCursor("progress", serverTime + 1000, "book-1");

      const newCursor1 = await storage.getSyncCursor("progress", "book-1");
      const newCursor2 = await storage.getSyncCursor("progress", "book-2");

      expect(newCursor1).toBe(serverTime + 1000);
      expect(newCursor2).toBe(serverTime);
    });

    it("should reset cursor to zero", async () => {
      await storage.setSyncCursor("highlights", 123456789);

      await engine.resetSyncCursor("highlights");

      const cursor = await storage.getSyncCursor("highlights");
      expect(cursor).toBe(0);
    });

    it("should get current cursor", async () => {
      const timestamp = 123456789;
      await storage.setSyncCursor("highlights", timestamp);

      const cursor = await engine.getSyncCursor("highlights");
      expect(cursor).toBe(timestamp);
    });
  });

  describe("Edge Cases", () => {
    it("should handle items without entityId", async () => {
      const items: SyncItem[] = [
        {
          id: "item-1",
          // No entityId
          _hlc: hlc.next(),
          _deviceId: "device-1",
          _isDeleted: false,
          _serverTimestamp: null,
          data: { text: "No entity" },
        },
      ];

      storage.setItems("settings", items);

      const result = await engine.push("settings");
      expect(result.pushed).toBe(1);

      const serverItems = remote.getServerItems("settings");
      expect(serverItems[0].entityId).toBeUndefined();
    });

    it("should handle tombstones correctly", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Remote tombstone
      const remoteItem: SyncItem = {
        id: "item-1",
        entityId: "book-1",
        _hlc: "1704067200000-0-device-2",
        _deviceId: "device-2",
        _isDeleted: true,
        _serverTimestamp: serverTime,
        data: { text: "Deleted item" },
      };

      remote.setServerItems("highlights", [remoteItem]);

      const result = await engine.pull("highlights");

      expect(result.pulled).toBe(1);

      const localItems = storage.getAllItems("highlights");
      expect(localItems[0]._isDeleted).toBe(true);
    });

    it("should handle rapid successive syncs", async () => {
      const items: SyncItem[] = [
        {
          id: "item-1",
          _hlc: hlc.next(),
          _deviceId: "device-1",
          _isDeleted: false,
          _serverTimestamp: null,
          data: { text: "Item" },
        },
      ];

      storage.setItems("highlights", items);

      // Run multiple syncs sequentially to avoid race conditions
      const result1 = await engine.sync("highlights");
      const result2 = await engine.sync("highlights");
      const result3 = await engine.sync("highlights");

      // First sync should push, subsequent ones should have nothing to push
      expect(result1.pushed).toBe(1);
      expect(result2.pushed).toBe(0);
      expect(result3.pushed).toBe(0);

      // Item should only be on server once
      const serverItems = remote.getServerItems("highlights");
      expect(serverItems).toHaveLength(1);
    });

    it("should handle large batches efficiently", async () => {
      const largeItemCount = 1000;
      const items: SyncItem[] = Array.from(
        { length: largeItemCount },
        (_, i) => ({
          id: `item-${i}`,
          entityId: "book-1",
          _hlc: hlc.next(),
          _deviceId: "device-1",
          _isDeleted: false,
          _serverTimestamp: null,
          data: { text: `Highlight ${i}`, index: i },
        }),
      );

      storage.setItems("highlights", items);

      const startTime = Date.now();
      const result = await engine.push("highlights");
      const duration = Date.now() - startTime;

      expect(result.pushed).toBe(largeItemCount);
      expect(result.errors).toHaveLength(0);

      // Should complete in reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(5000);
    });
  });
});

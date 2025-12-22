import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHLCService,
  createSyncConfig,
  createSyncMiddleware,
  createTombstone,
  generateDexieStores,
  isNotDeleted,
  UNSYNCED_TIMESTAMP,
  type HLCService,
  type MutationEvent,
  type SyncMetadata,
} from "@/lib/sync/hlc";
import { resetIndexedDB } from "../setup/indexeddb";

// Test data interfaces
interface Highlight {
  id: string;
  bookId: string;
  text: string;
  color: string;
  cfiRange: string;
  createdAt: number;
}

interface ReadingProgress {
  id: string;
  bookId: string;
  userId: string;
  position: string;
  percentage: number;
  lastReadAt: number;
}

type HighlightWithSync = Highlight & SyncMetadata;
type ProgressWithSync = ReadingProgress & SyncMetadata;

class SyncedDatabase extends Dexie {
  highlights!: Dexie.Table<HighlightWithSync, string>;
  readingProgress!: Dexie.Table<ProgressWithSync, string>;

  constructor() {
    super("IntegrationTestDB");
  }
}

describe("HLC Sync Integration", () => {
  let db: SyncedDatabase;
  let hlc: HLCService;
  let mutationEvents: MutationEvent[];
  const deviceId = "integration-test-device";

  beforeEach(async () => {
    // Clear state
    resetIndexedDB();
    localStorage.clear();
    mutationEvents = [];

    // Create HLC service
    hlc = createHLCService(deviceId);

    // Define sync configuration
    const syncConfig = createSyncConfig({
      highlights: {
        primaryKey: "id",
        indices: ["bookId", "createdAt", "color"],
        compoundIndices: [["bookId", "createdAt"]],
      },
      readingProgress: {
        primaryKey: "id",
        indices: ["bookId", "userId", "lastReadAt"],
        compoundIndices: [["bookId", "userId"]],
        entityKey: "bookId",
        appendOnly: true,
      },
    });

    // Generate Dexie schemas
    const schemas = generateDexieStores(syncConfig.tables);

    // Create database
    db = new SyncedDatabase();
    db.version(1).stores(schemas);

    // Apply sync middleware
    db.use(
      createSyncMiddleware({
        hlc,
        syncedTables: new Set(Object.keys(syncConfig.tables)),
        onMutation: (event) => mutationEvents.push(event),
      }),
    );

    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  describe("End-to-end sync workflow", () => {
    it("should handle complete local write and sync cycle", async () => {
      // 1. User creates a highlight (local write)
      const highlight: Highlight = {
        id: "h1",
        bookId: "book-1",
        text: "Important passage",
        color: "yellow",
        cfiRange: "/6/4[chap01]!/4/2/1:0",
        createdAt: Date.now(),
      };

      await db.highlights.add(highlight as HighlightWithSync);

      // Verify local write has correct metadata
      const stored = await db.highlights.get("h1");
      expect(stored!._hlc).toBeDefined();
      expect(stored!._deviceId).toBe(deviceId);
      expect(stored!._serverTimestamp).toBe(UNSYNCED_TIMESTAMP); // Not synced yet
      expect(stored!._isDeleted).toBe(0);

      const localHlc = stored!._hlc;

      // 2. Simulate sync to server - update with server timestamp
      const syncedHighlight: HighlightWithSync = {
        ...stored!,
        _serverTimestamp: Date.now(),
      };

      await db.highlights.put(syncedHighlight);

      // Verify server timestamp was preserved
      const synced = await db.highlights.get("h1");
      expect(synced!._serverTimestamp).not.toBe(UNSYNCED_TIMESTAMP);
      expect(synced!._hlc).toBe(localHlc); // HLC unchanged
      expect(synced!._deviceId).toBe(deviceId);
    });

    it("should handle remote sync pull with conflict resolution", async () => {
      const now = Date.now();

      // Local edit
      const localHighlight: Highlight = {
        id: "conflict-test",
        bookId: "book-1",
        text: "Local version",
        color: "yellow",
        cfiRange: "/6/4[chap01]!/4/2/1:0",
        createdAt: now,
      };

      await db.highlights.add(localHighlight as HighlightWithSync);
      const local = await db.highlights.get("conflict-test");

      // Simulate remote version with later HLC
      const remoteHighlight: HighlightWithSync = {
        id: "conflict-test",
        bookId: "book-1",
        text: "Remote version (newer)",
        color: "blue",
        cfiRange: "/6/4[chap01]!/4/2/1:0",
        createdAt: now,
        _hlc: `${now + 5000}-0-remote-device`,
        _deviceId: "remote-device",
        _serverTimestamp: now + 5000,
        _isDeleted: 0,
      };

      // Apply remote (winner due to later HLC)
      if (hlc.compare(local!._hlc, remoteHighlight._hlc) < 0) {
        await db.highlights.put(remoteHighlight);
      }

      const resolved = await db.highlights.get("conflict-test");
      expect(resolved!.text).toBe("Remote version (newer)");
      expect(resolved!.color).toBe("blue");
      expect(resolved!._deviceId).toBe("remote-device");
    });

    it("should handle deletion sync workflow", async () => {
      // Create highlight
      const highlight: Highlight = {
        id: "to-delete",
        bookId: "book-1",
        text: "Delete me",
        color: "yellow",
        cfiRange: "/6/4[chap01]!/4/2/1:0",
        createdAt: Date.now(),
      };

      await db.highlights.add(highlight as HighlightWithSync);
      expect(await db.highlights.get("to-delete")).toBeDefined();

      // User deletes highlight (soft delete) - get existing record with metadata first
      const existingHighlight = await db.highlights.get("to-delete");
      const tombstone = createTombstone(existingHighlight!);
      await db.highlights.put(tombstone);

      // Tombstone still exists in database
      const deleted = await db.highlights.get("to-delete");
      expect(deleted).toBeDefined();
      expect(deleted!._isDeleted).toBe(1);

      // Application code should filter using isNotDeleted
      const allHighlights = await db.highlights.toArray();
      const activeHighlights = allHighlights.filter(isNotDeleted);
      expect(activeHighlights).toHaveLength(0);

      // Sync engine can access tombstones without filtering
      expect(allHighlights).toHaveLength(1);
      expect(allHighlights[0]._isDeleted).toBe(1);
    });

    it("should sync multiple tables independently", async () => {
      // Add highlight
      const highlight: Highlight = {
        id: "h1",
        bookId: "book-1",
        text: "Test",
        color: "yellow",
        cfiRange: "/6/4[chap01]!/4/2/1:0",
        createdAt: Date.now(),
      };

      await db.highlights.add(highlight as HighlightWithSync);

      // Add reading progress
      const progress: ReadingProgress = {
        id: "p1",
        bookId: "book-1",
        userId: "user-1",
        position: "/6/8[chap02]!/4",
        percentage: 45.5,
        lastReadAt: Date.now(),
      };

      await db.readingProgress.add(progress as ProgressWithSync);

      // Both should have independent sync metadata
      const h = await db.highlights.get("h1");
      const p = await db.readingProgress.get("p1");

      expect(h!._hlc).toBeDefined();
      expect(p!._hlc).toBeDefined();
      expect(h!._hlc).not.toBe(p!._hlc); // Different HLCs
      expect(hlc.compare(h!._hlc, p!._hlc)).toBeLessThanOrEqual(0);

      // Both should emit mutation events
      expect(mutationEvents).toHaveLength(2);
      expect(mutationEvents[0].table).toBe("highlights");
      expect(mutationEvents[1].table).toBe("readingProgress");
    });
  });

  describe("Multi-device simulation", () => {
    it("should handle sync between two devices", async () => {
      // Device 1 creates highlight
      const device1Highlight: Highlight = {
        id: "shared-1",
        bookId: "book-1",
        text: "From device 1",
        color: "yellow",
        cfiRange: "/6/4[chap01]!/4/2/1:0",
        createdAt: Date.now(),
      };

      await db.highlights.add(device1Highlight as HighlightWithSync);
      const d1 = await db.highlights.get("shared-1");

      // Simulate device 2 creating different highlight
      const device2Highlight: HighlightWithSync = {
        id: "shared-2",
        bookId: "book-1",
        text: "From device 2",
        color: "blue",
        cfiRange: "/6/4[chap02]!/4/2/1:0",
        createdAt: Date.now(),
        _hlc: `${Date.now() + 1000}-0-device-2`,
        _deviceId: "device-2",
        _serverTimestamp: Date.now() + 1000,
        _isDeleted: 0,
      };

      // Device 1 receives device 2's highlight
      hlc.receive(device2Highlight._hlc);
      await db.highlights.put(device2Highlight);

      // Both highlights should exist (filter for active only)
      const all = await db.highlights.toArray();
      const active = all.filter(isNotDeleted);
      expect(active).toHaveLength(2);

      // Device 1's next write should have HLC > both previous writes
      const device1NextWrite: Highlight = {
        id: "shared-3",
        bookId: "book-1",
        text: "After sync",
        color: "green",
        cfiRange: "/6/4[chap03]!/4/2/1:0",
        createdAt: Date.now(),
      };

      await db.highlights.add(device1NextWrite as HighlightWithSync);
      const d1Next = await db.highlights.get("shared-3");

      expect(hlc.compare(d1!._hlc, d1Next!._hlc)).toBeLessThan(0);
      expect(hlc.compare(device2Highlight._hlc, d1Next!._hlc)).toBeLessThan(0);
    });

    it("should maintain causality across device interactions", async () => {
      const hlcs: string[] = [];

      // Device 1: Create highlight
      await db.highlights.add({
        id: "h1",
        bookId: "book-1",
        text: "First",
        color: "yellow",
        cfiRange: "/6/4[chap01]!/4/2/1:0",
        createdAt: Date.now(),
      } as HighlightWithSync);

      const h1 = await db.highlights.get("h1");
      hlcs.push(h1!._hlc);

      // Receive from device 2
      const d2hlc = `${Date.now() + 2000}-5-device-2`;
      hlc.receive(d2hlc);

      // Device 1: Create another highlight (should be after d2hlc due to receive)
      await db.highlights.add({
        id: "h2",
        bookId: "book-1",
        text: "Second",
        color: "blue",
        cfiRange: "/6/4[chap02]!/4/2/1:0",
        createdAt: Date.now(),
      } as HighlightWithSync);

      const h2 = await db.highlights.get("h2");
      hlcs.push(h2!._hlc);

      // Receive from device 3
      const d3hlc = `${Date.now() + 3000}-10-device-3`;
      hlc.receive(d3hlc);

      // Device 1: Create final highlight (should be after d3hlc due to receive)
      await db.highlights.add({
        id: "h3",
        bookId: "book-1",
        text: "Third",
        color: "green",
        cfiRange: "/6/4[chap03]!/4/2/1:0",
        createdAt: Date.now(),
      } as HighlightWithSync);

      const h3 = await db.highlights.get("h3");
      hlcs.push(h3!._hlc);

      // Verify monotonicity - local writes should be after received HLCs
      expect(hlc.compare(h1!._hlc, h2!._hlc)).toBeLessThan(0);
      expect(hlc.compare(h2!._hlc, h3!._hlc)).toBeLessThan(0);
    });
  });

  describe("Schema validation in practice", () => {
    it("should enforce compound indices for efficient queries", async () => {
      // Add multiple highlights for same book
      const highlights: Highlight[] = Array.from({ length: 5 }, (_, i) => ({
        id: `h${i}`,
        bookId: "book-1",
        text: `Highlight ${i}`,
        color: "yellow",
        cfiRange: `/6/4[chap0${i}]!/4/2/1:0`,
        createdAt: Date.now() + i * 1000,
      }));

      await db.highlights.bulkAdd(highlights as HighlightWithSync[]);

      // Query using compound index [bookId+createdAt]
      const bookHighlights = await db.highlights
        .where("[bookId+createdAt]")
        .between(["book-1", 0], ["book-1", Date.now() + 10000])
        .filter(isNotDeleted)
        .toArray();

      expect(bookHighlights).toHaveLength(5);
      expect(bookHighlights.every((h) => h.bookId === "book-1")).toBe(true);
    });

    it("should use entityKey for scoped queries", async () => {
      // Add progress for multiple books
      const progress: ReadingProgress[] = [
        {
          id: "p1",
          bookId: "book-1",
          userId: "user-1",
          position: "/6/4",
          percentage: 25,
          lastReadAt: Date.now(),
        },
        {
          id: "p2",
          bookId: "book-2",
          userId: "user-1",
          position: "/6/8",
          percentage: 50,
          lastReadAt: Date.now(),
        },
        {
          id: "p3",
          bookId: "book-1",
          userId: "user-2",
          position: "/6/12",
          percentage: 75,
          lastReadAt: Date.now(),
        },
      ];

      await db.readingProgress.bulkAdd(progress as ProgressWithSync[]);

      // Query by entityKey (bookId)
      const book1Progress = await db.readingProgress
        .where("bookId")
        .equals("book-1")
        .filter(isNotDeleted)
        .toArray();

      expect(book1Progress).toHaveLength(2);
      expect(book1Progress.every((p) => p.bookId === "book-1")).toBe(true);
    });
  });

  describe("Mutation event tracking", () => {
    it("should track all mutations for sync trigger", async () => {
      mutationEvents = [];

      // Create
      await db.highlights.add({
        id: "track-1",
        bookId: "book-1",
        text: "Test",
        color: "yellow",
        cfiRange: "/6/4[chap01]!/4/2/1:0",
        createdAt: Date.now(),
      } as HighlightWithSync);

      expect(mutationEvents).toHaveLength(1);
      expect(mutationEvents[0].type).toBe("create");

      // Update
      await db.highlights.put({
        id: "track-1",
        bookId: "book-1",
        text: "Updated",
        color: "blue",
        cfiRange: "/6/4[chap01]!/4/2/1:0",
        createdAt: Date.now(),
      } as HighlightWithSync);

      expect(mutationEvents).toHaveLength(2);
      expect(mutationEvents[1].type).toBe("update");
    });

    it("should not emit events for remote writes", async () => {
      mutationEvents = [];

      // Remote write (has _serverTimestamp)
      const remoteHighlight: HighlightWithSync = {
        id: "remote-1",
        bookId: "book-1",
        text: "From server",
        color: "yellow",
        cfiRange: "/6/4[chap01]!/4/2/1:0",
        createdAt: Date.now(),
        _hlc: "1000-0-remote-device",
        _deviceId: "remote-device",
        _serverTimestamp: Date.now(),
        _isDeleted: false,
      };

      await db.highlights.put(remoteHighlight);

      // Should not emit mutation event for remote writes
      // (to avoid infinite sync loops)
      expect(mutationEvents).toHaveLength(0);
    });
  });

  describe("Performance and scalability", () => {
    it("should handle bulk operations efficiently", async () => {
      const start = Date.now();

      // Create 100 highlights
      const highlights: Highlight[] = Array.from({ length: 100 }, (_, i) => ({
        id: `perf-${i}`,
        bookId: `book-${i % 10}`,
        text: `Highlight ${i}`,
        color: ["yellow", "blue", "green", "pink"][i % 4],
        cfiRange: `/6/4[chap${i}]!/4/2/1:0`,
        createdAt: Date.now() + i,
      }));

      await db.highlights.bulkAdd(highlights as HighlightWithSync[]);

      const duration = Date.now() - start;

      // Should complete in reasonable time
      expect(duration).toBeLessThan(1000); // 1 second

      // Verify all have sync metadata
      const all = await db.highlights.toArray();
      expect(all).toHaveLength(100);
      expect(
        all.every(
          (h) =>
            h._hlc && h._deviceId && h._serverTimestamp === UNSYNCED_TIMESTAMP,
        ),
      ).toBe(true);
    });

    it("should maintain performance with tombstones", async () => {
      // Add active records
      const active: Highlight[] = Array.from({ length: 50 }, (_, i) => ({
        id: `active-${i}`,
        bookId: "book-1",
        text: `Active ${i}`,
        color: "yellow",
        cfiRange: `/6/4[chap${i}]!/4/2/1:0`,
        createdAt: Date.now(),
      }));

      await db.highlights.bulkAdd(active as HighlightWithSync[]);

      // Add tombstones (simulating remote sync)
      const tombstones: HighlightWithSync[] = Array.from(
        { length: 50 },
        (_, i) => ({
          id: `deleted-${i}`,
          bookId: "book-1",
          text: `Deleted ${i}`,
          color: "yellow",
          cfiRange: `/6/4[chap${i + 100}]!/4/2/1:0`,
          createdAt: Date.now(),
          _hlc: `${Date.now()}-${i}-remote`,
          _deviceId: "remote",
          _serverTimestamp: Date.now(),
          _isDeleted: 1,
        }),
      );

      await db.highlights.bulkPut(tombstones);

      // Query all records first
      const start = Date.now();
      const allResults = await db.highlights.toArray();
      const duration = Date.now() - start;

      // Then filter for active only
      const results = allResults.filter(isNotDeleted);

      expect(results).toHaveLength(50);
      expect(allResults).toHaveLength(100); // Total including tombstones
      expect(duration).toBeLessThan(100); // Should be fast
    });
  });
});

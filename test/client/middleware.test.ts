import {
  createHLCService,
  createSyncMiddleware,
  createTombstone,
  generateDexieStores,
  isNotDeleted,
  UNSYNCED_TIMESTAMP,
  type HLCService,
  type SyncMetadata,
} from "@/lib/sync/hlc";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetIndexedDB } from "../setup/indexeddb";

// Test database interface
interface TestRecord {
  id: string;
  bookId: string;
  content: string;
  createdAt: number;
}

type TestRecordWithSync = TestRecord & SyncMetadata;

class TestDatabase extends Dexie {
  highlights!: Dexie.Table<TestRecordWithSync, string>;
  nonsyncedTable!: Dexie.Table<TestRecord, string>;

  constructor() {
    super("TestDB");
  }
}

describe("Sync Middleware", () => {
  let db: TestDatabase;
  let hlc: HLCService;
  const testDeviceId = "test-device-middleware";

  beforeEach(async () => {
    // Clear localStorage
    resetIndexedDB();
    localStorage.clear();

    // Create HLC service
    hlc = createHLCService(testDeviceId);

    // Create database
    db = new TestDatabase();

    // Generate schemas
    const schemas = generateDexieStores({
      highlights: {
        primaryKey: "id",
        indices: ["bookId", "createdAt"],
      },
    });

    // Add a non-synced table for comparison
    db.version(1).stores({
      ...schemas,
      nonsyncedTable: "id, bookId",
    });

    // Apply middleware
    db.use(
      createSyncMiddleware({
        hlc,
        syncedTables: new Set(["highlights"]),
      }),
    );

    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    await db.close();
  });

  describe("Local writes (add/put)", () => {
    it("should inject sync metadata on add", async () => {
      const record: TestRecord = {
        id: "test-1",
        bookId: "book-1",
        content: "Test content",
        createdAt: Date.now(),
      };

      await db.highlights.add(record as TestRecordWithSync);

      const stored = await db.highlights.get("test-1");
      expect(stored).toBeDefined();
      expect(stored!._hlc).toBeDefined();
      expect(stored!._deviceId).toBe(testDeviceId);
      expect(stored!._serverTimestamp).toBe(UNSYNCED_TIMESTAMP);
      expect(stored!._isDeleted).toBe(0);
    });

    it("should inject sync metadata on put", async () => {
      const record: TestRecord = {
        id: "test-2",
        bookId: "book-1",
        content: "Test content",
        createdAt: Date.now(),
      };

      await db.highlights.put(record as TestRecordWithSync);

      const stored = await db.highlights.get("test-2");
      expect(stored).toBeDefined();
      expect(stored!._hlc).toBeDefined();
      expect(stored!._deviceId).toBe(testDeviceId);
      expect(stored!._serverTimestamp).toBe(UNSYNCED_TIMESTAMP);
      expect(stored!._isDeleted).toBe(0);
    });

    it("should generate unique HLC for each write", async () => {
      const record1: TestRecord = {
        id: "test-3",
        bookId: "book-1",
        content: "Content 1",
        createdAt: Date.now(),
      };

      const record2: TestRecord = {
        id: "test-4",
        bookId: "book-1",
        content: "Content 2",
        createdAt: Date.now(),
      };

      await db.highlights.add(record1 as TestRecordWithSync);
      await db.highlights.add(record2 as TestRecordWithSync);

      const stored1 = await db.highlights.get("test-3");
      const stored2 = await db.highlights.get("test-4");

      expect(stored1!._hlc).not.toBe(stored2!._hlc);
      expect(hlc.compare(stored1!._hlc, stored2!._hlc)).toBeLessThanOrEqual(0);
    });

    it("should update HLC on subsequent writes", async () => {
      const record: TestRecord = {
        id: "test-5",
        bookId: "book-1",
        content: "Original content",
        createdAt: Date.now(),
      };

      await db.highlights.put(record as TestRecordWithSync);
      const first = await db.highlights.get("test-5");

      // Update the record
      await db.highlights.put({
        ...record,
        content: "Updated content",
      } as TestRecordWithSync);
      const updated = await db.highlights.get("test-5");

      expect(hlc.compare(first!._hlc, updated!._hlc)).toBeLessThan(0);
      expect(updated!._serverTimestamp).toBe(UNSYNCED_TIMESTAMP);
      expect(updated!._isDeleted).toBe(0);
    });

    it("should handle bulk add operations", async () => {
      const records: TestRecord[] = Array.from({ length: 10 }, (_, i) => ({
        id: `bulk-${i}`,
        bookId: "book-1",
        content: `Content ${i}`,
        createdAt: Date.now(),
      }));

      await db.highlights.bulkAdd(records as TestRecordWithSync[]);

      const stored = await db.highlights
        .where("bookId")
        .equals("book-1")
        .toArray();

      expect(stored).toHaveLength(10);
      stored.forEach((record) => {
        expect(record._hlc).toBeDefined();
        expect(record._deviceId).toBe(testDeviceId);
        expect(record._serverTimestamp).toBe(UNSYNCED_TIMESTAMP);
        expect(record._isDeleted).toBe(0);
      });
    });

    it("should handle bulk put operations", async () => {
      const records: TestRecord[] = Array.from({ length: 5 }, (_, i) => ({
        id: `bulk-put-${i}`,
        bookId: "book-1",
        content: `Content ${i}`,
        createdAt: Date.now(),
      }));

      await db.highlights.bulkPut(records as TestRecordWithSync[]);

      const stored = await db.highlights.toArray();

      expect(stored.length).toBeGreaterThanOrEqual(5);
      const bulkPutRecords = stored.filter((r) => r.id.startsWith("bulk-put-"));
      expect(bulkPutRecords).toHaveLength(5);
    });
  });

  describe("Remote writes (with _serverTimestamp)", () => {
    it("should pass through remote writes unchanged", async () => {
      const remoteRecord: TestRecordWithSync = {
        id: "remote-1",
        bookId: "book-1",
        content: "Remote content",
        createdAt: Date.now(),
        _hlc: "1000-5-remote-device",
        _deviceId: "remote-device",
        _serverTimestamp: Date.now(),
        _isDeleted: 0,
      };

      await db.highlights.put(remoteRecord);

      const stored = await db.highlights.get("remote-1");
      expect(stored).toBeDefined();
      expect(stored!._hlc).toBe("1000-5-remote-device");
      expect(stored!._deviceId).toBe("remote-device");
      expect(stored!._serverTimestamp).toBe(remoteRecord._serverTimestamp);
      expect(stored!._isDeleted).toBe(0);
    });

    it("should not modify remote HLC timestamp", async () => {
      const remoteHlc = "2000-100-different-device";
      const remoteRecord: TestRecordWithSync = {
        id: "remote-2",
        bookId: "book-1",
        content: "Remote content",
        createdAt: Date.now(),
        _hlc: remoteHlc,
        _deviceId: "different-device",
        _serverTimestamp: Date.now(),
        _isDeleted: 0,
      };

      await db.highlights.put(remoteRecord);

      const stored = await db.highlights.get("remote-2");
      expect(stored!._hlc).toBe(remoteHlc);
    });

    it("should preserve remote tombstones", async () => {
      const remoteTombstone: TestRecordWithSync = {
        id: "remote-tombstone",
        bookId: "book-1",
        content: "Deleted content",
        createdAt: Date.now(),
        _hlc: "3000-0-remote-device",
        _deviceId: "remote-device",
        _serverTimestamp: Date.now(),
        _isDeleted: 1,
      };

      await db.highlights.put(remoteTombstone);

      // Tombstone should be stored and accessible (no automatic filtering)
      const all = await db.highlights.toArray();
      expect(all.find((r) => r.id === "remote-tombstone")).toBeDefined();

      // Direct get should return the tombstone
      const direct = await db.highlights.get("remote-tombstone");
      expect(direct).toBeDefined();
      expect(direct!._isDeleted).toBe(1);
    });
  });

  describe("Delete operations", () => {
    it("should block direct delete operations", async () => {
      const record: TestRecord = {
        id: "delete-test",
        bookId: "book-1",
        content: "To be deleted",
        createdAt: Date.now(),
      };

      await db.highlights.put(record as TestRecordWithSync);

      await expect(db.highlights.delete("delete-test")).rejects.toThrow(
        "Direct delete operations are not allowed",
      );
    });

    it("should block bulkDelete operations", async () => {
      await expect(db.highlights.bulkDelete(["id1", "id2"])).rejects.toThrow(
        "Direct delete operations are not allowed",
      );
    });

    it("should block clear operations", async () => {
      await expect(db.highlights.clear()).rejects.toThrow(
        "Direct delete operations are not allowed",
      );
    });

    it("should allow soft delete via put with _isDeleted=1", async () => {
      const record: TestRecord = {
        id: "soft-delete",
        bookId: "book-1",
        content: "To be soft deleted",
        createdAt: Date.now(),
      };

      await db.highlights.put(record as TestRecordWithSync);

      // Get the record with sync metadata
      const existingRecord = await db.highlights.get("soft-delete");
      expect(existingRecord).toBeDefined();

      // Soft delete using the record with metadata
      const tombstone = createTombstone(existingRecord!);
      await db.highlights.put(tombstone);

      const stored = await db.highlights.get("soft-delete");
      expect(stored).toBeDefined();
      expect(stored!._isDeleted).toBe(1);

      // Application code should filter manually
      expect(isNotDeleted(stored!)).toBe(false);
    });
  });

  describe("Manual filtering with helpers", () => {
    beforeEach(async () => {
      // Add some regular records
      await db.highlights.bulkPut([
        {
          id: "active-1",
          bookId: "book-1",
          content: "Active 1",
          createdAt: Date.now(),
        } as TestRecordWithSync,
        {
          id: "active-2",
          bookId: "book-1",
          content: "Active 2",
          createdAt: Date.now(),
        } as TestRecordWithSync,
      ]);

      // Add a tombstone (via remote sync)
      await db.highlights.put({
        id: "deleted-1",
        bookId: "book-1",
        content: "Deleted",
        createdAt: Date.now(),
        _hlc: "5000-0-other-device",
        _deviceId: "other-device",
        _serverTimestamp: Date.now(),
        _isDeleted: 1,
      });
    });

    it("should NOT automatically filter tombstones from queries", async () => {
      // Without filtering, tombstones are included
      const all = await db.highlights.toArray();

      expect(all).toHaveLength(3); // All records including tombstone
      expect(all.find((r) => r.id === "deleted-1")).toBeDefined();
    });

    it("should filter tombstones using isNotDeleted helper", async () => {
      const all = await db.highlights.toArray();
      const active = all.filter(isNotDeleted);

      expect(active).toHaveLength(2);
      expect(active.find((r) => r.id === "deleted-1")).toBeUndefined();
      expect(active.find((r) => r.id === "active-1")).toBeDefined();
      expect(active.find((r) => r.id === "active-2")).toBeDefined();
    });

    it("should filter tombstones using Dexie filter with isNotDeleted", async () => {
      const active = await db.highlights.filter(isNotDeleted).toArray();

      expect(active).toHaveLength(2);
      expect(active.find((r) => r.id === "deleted-1")).toBeUndefined();
    });

    it("should filter tombstones from where() queries with isNotDeleted", async () => {
      const bookHighlights = await db.highlights
        .where("bookId")
        .equals("book-1")
        .filter(isNotDeleted)
        .toArray();

      expect(bookHighlights).toHaveLength(2);
      expect(bookHighlights.find((r) => r.id === "deleted-1")).toBeUndefined();
    });

    it("should allow sync engine to access tombstones", async () => {
      // Sync engine can query without filtering
      const allRecords = await db.highlights.toArray();

      expect(allRecords).toHaveLength(3);
      const tombstones = allRecords.filter((r) => r._isDeleted === 1);
      expect(tombstones).toHaveLength(1);
      expect(tombstones[0].id).toBe("deleted-1");
    });

    it("should allow manual count of active records", async () => {
      const all = await db.highlights.toArray();
      const activeCount = all.filter(isNotDeleted).length;

      expect(activeCount).toBe(2);
    });
  });

  describe("Non-synced tables", () => {
    it("should not inject sync metadata in non-synced tables", async () => {
      const record: TestRecord = {
        id: "nonsynced-1",
        bookId: "book-1",
        content: "Not synced",
        createdAt: Date.now(),
      };

      await db.nonsyncedTable.add(record);

      const stored = await db.nonsyncedTable.get("nonsynced-1");
      expect(stored).toBeDefined();
      expect((stored as any)._hlc).toBeUndefined();
      expect((stored as any)._deviceId).toBeUndefined();
      expect((stored as any)._serverTimestamp).toBeUndefined();
      expect((stored as any)._isDeleted).toBeUndefined();
    });

    it("should allow direct delete on non-synced tables", async () => {
      const record: TestRecord = {
        id: "nonsynced-2",
        bookId: "book-1",
        content: "Not synced",
        createdAt: Date.now(),
      };

      await db.nonsyncedTable.add(record);
      await expect(
        db.nonsyncedTable.delete("nonsynced-2"),
      ).resolves.not.toThrow();

      const stored = await db.nonsyncedTable.get("nonsynced-2");
      expect(stored).toBeUndefined();
    });
  });

  describe("Mutation events", () => {
    it("should emit mutation events for local writes", async () => {
      const events: any[] = [];

      // Create new DB with mutation callback
      await db.close();
      await db.delete();

      db = new TestDatabase();
      const schemas = generateDexieStores({
        highlights: {
          primaryKey: "id",
          indices: ["bookId"],
        },
      });

      db.version(1).stores(schemas);
      db.use(
        createSyncMiddleware({
          hlc,
          syncedTables: new Set(["highlights"]),
          onMutation: (event) => events.push(event),
        }),
      );

      await db.open();

      const record: TestRecord = {
        id: "event-test",
        bookId: "book-1",
        content: "Test",
        createdAt: Date.now(),
      };

      await db.highlights.add(record as TestRecordWithSync);

      expect(events).toHaveLength(1);
      expect(events[0].table).toBe("highlights");
      expect(events[0].type).toBe("create");
      expect(events[0].key).toBe("event-test");
      expect(events[0].value).toBeDefined();
    });

    it("should distinguish between create and update events", async () => {
      const events: any[] = [];

      await db.close();
      await db.delete();

      db = new TestDatabase();
      const schemas = generateDexieStores({
        highlights: { primaryKey: "id", indices: ["bookId"] },
      });

      db.version(1).stores(schemas);
      db.use(
        createSyncMiddleware({
          hlc,
          syncedTables: new Set(["highlights"]),
          onMutation: (event) => events.push(event),
        }),
      );

      await db.open();

      const record: TestRecord = {
        id: "mutation-test",
        bookId: "book-1",
        content: "Original",
        createdAt: Date.now(),
      };

      await db.highlights.add(record as TestRecordWithSync);
      await db.highlights.put({
        ...record,
        content: "Updated",
      } as TestRecordWithSync);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("create");
      expect(events[1].type).toBe("update");
    });
  });

  describe("Helper functions", () => {
    it("createTombstone should add _isDeleted flag", () => {
      const record: TestRecord = {
        id: "test",
        bookId: "book-1",
        content: "content",
        createdAt: Date.now(),
      };

      const tombstone = createTombstone(record);

      expect(tombstone).toEqual({
        ...record,
        _isDeleted: 1,
      });
    });

    it("createTombstone should preserve existing fields", () => {
      const record = {
        id: "test",
        bookId: "book-1",
        content: "content",
        customField: "custom",
        nestedObject: { a: 1, b: 2 },
      };

      const tombstone = createTombstone(record);

      expect(tombstone.customField).toBe("custom");
      expect(tombstone.nestedObject).toEqual({ a: 1, b: 2 });
      expect(tombstone._isDeleted).toBe(1);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty string as ID", async () => {
      const record: TestRecord = {
        id: "",
        bookId: "book-1",
        content: "Empty ID",
        createdAt: Date.now(),
      };

      await db.highlights.put(record as TestRecordWithSync);

      const stored = await db.highlights.get("");
      expect(stored).toBeDefined();
      expect(stored!._hlc).toBeDefined();
    });

    it("should handle very large content", async () => {
      const largeContent = "x".repeat(100000);
      const record: TestRecord = {
        id: "large-content",
        bookId: "book-1",
        content: largeContent,
        createdAt: Date.now(),
      };

      await db.highlights.put(record as TestRecordWithSync);

      const stored = await db.highlights.get("large-content");
      expect(stored).toBeDefined();
      expect(stored!.content).toBe(largeContent);
      expect(stored!._hlc).toBeDefined();
    });

    it("should handle records with null values", async () => {
      const record = {
        id: "null-test",
        bookId: "book-1",
        content: null as any,
        createdAt: Date.now(),
      };

      await db.highlights.put(record as any);

      const stored = await db.highlights.get("null-test");
      expect(stored).toBeDefined();
      expect(stored!.content).toBeNull();
    });

    it("should handle concurrent writes", async () => {
      const records = Array.from({ length: 50 }, (_, i) => ({
        id: `concurrent-${i}`,
        bookId: "book-1",
        content: `Content ${i}`,
        createdAt: Date.now(),
      }));

      // Write all records concurrently
      await Promise.all(
        records.map((r) => db.highlights.put(r as TestRecordWithSync)),
      );

      const stored = await db.highlights.toArray();
      const concurrentRecords = stored.filter((r) =>
        r.id.startsWith("concurrent-"),
      );

      expect(concurrentRecords.length).toBe(50);

      // All should have unique HLCs
      const hlcs = concurrentRecords.map((r) => r._hlc);
      const uniqueHlcs = new Set(hlcs);
      expect(uniqueHlcs.size).toBe(50);
    });
  });
});

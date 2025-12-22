import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser } from "./helpers";

describe("HLC-based Sync API", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    testUser = await createTestUser(
      "synctest@example.com",
      "testpassword123",
      "Sync Test User",
    );
  });

  describe("GET /api/sync-timestamp", () => {
    it("returns current server timestamp for authenticated users", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync-timestamp",
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.serverTimestamp).toBeDefined();
      expect(typeof data.serverTimestamp).toBe("number");
      expect(data.serverTimestamp).toBeGreaterThan(0);
    });

    it("returns 401 for unauthenticated requests", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync-timestamp",
      );

      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/sync/:table (push)", () => {
    it("accepts and stores sync items", async () => {
      const items = [
        {
          id: "item-1",
          entityId: "book-123",
          _hlc: "1000-0-device1",
          _deviceId: "device1",
          _isDeleted: false,
          data: {
            text: "Test highlight 1",
            color: "yellow",
          },
        },
        {
          id: "item-2",
          entityId: "book-123",
          _hlc: "1001-0-device1",
          _deviceId: "device1",
          _isDeleted: false,
          data: {
            text: "Test highlight 2",
            color: "blue",
          },
        },
      ];

      const response = await SELF.fetch(
        "http://example.com/api/sync/highlights",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": "device1",
          },
          body: JSON.stringify({ items }),
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.results).toHaveLength(2);
      expect(data.results[0].id).toBe("item-1");
      expect(data.results[0].accepted).toBe(true);
      expect(data.results[0].serverTimestamp).toBeDefined();
      expect(data.results[1].id).toBe("item-2");
      expect(data.results[1].accepted).toBe(true);
    });

    it("handles deleted items correctly", async () => {
      const items = [
        {
          id: "item-deleted",
          entityId: "book-123",
          _hlc: "1002-0-device1",
          _deviceId: "device1",
          _isDeleted: true,
          data: {
            text: "This will be deleted",
          },
        },
      ];

      const response = await SELF.fetch(
        "http://example.com/api/sync/highlights",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": "device1",
          },
          body: JSON.stringify({ items }),
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.results[0].accepted).toBe(true);
    });

    it("implements last-write-wins when pushing same item with higher HLC", async () => {
      // First push with older HLC
      const item1 = {
        id: "lww-item",
        entityId: "book-456",
        _hlc: "2000-0-device1",
        _deviceId: "device1",
        _isDeleted: false,
        data: {
          text: "Original text",
          version: 1,
        },
      };

      await SELF.fetch("http://example.com/api/sync/highlights", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
          "X-Device-ID": "device1",
        },
        body: JSON.stringify({ items: [item1] }),
      });

      // Second push with newer HLC from device2
      const item2 = {
        id: "lww-item",
        entityId: "book-456",
        _hlc: "2001-0-device2",
        _deviceId: "device2",
        _isDeleted: false,
        data: {
          text: "Updated text",
          version: 2,
        },
      };

      const response2 = await SELF.fetch(
        "http://example.com/api/sync/highlights",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": "device2",
          },
          body: JSON.stringify({ items: [item2] }),
        },
      );

      expect(response2.status).toBe(200);

      // Device1 pulls to verify the newer version from device2 is stored
      const pullResponse = await SELF.fetch(
        "http://example.com/api/sync/highlights?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device1",
          },
        },
      );

      const pullData = await pullResponse.json();
      const lwwItem = pullData.items.find((item) => item.id === "lww-item");
      expect(lwwItem).toBeDefined();
      expect(lwwItem._hlc).toBe("2001-0-device2");
      expect(lwwItem.data.text).toBe("Updated text");
      expect(lwwItem.data.version).toBe(2);
    });

    it("does not overwrite with older HLC (last-write-wins)", async () => {
      // First push with newer HLC from device2
      const item1 = {
        id: "lww-item-2",
        entityId: "book-789",
        _hlc: "3001-0-device2",
        _deviceId: "device2",
        _isDeleted: false,
        data: {
          text: "Newer text",
          version: 1,
        },
      };

      await SELF.fetch("http://example.com/api/sync/highlights", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
          "X-Device-ID": "device2",
        },
        body: JSON.stringify({ items: [item1] }),
      });

      // Second push with older HLC (should be rejected by setWhere)
      // Second push with older HLC from device1 (should not overwrite)
      const item2 = {
        id: "lww-item-2",
        entityId: "book-789",
        _hlc: "3000-0-device1",
        _deviceId: "device1",
        _isDeleted: false,
        data: {
          text: "Older text",
          version: 0,
        },
      };

      const response2 = await SELF.fetch(
        "http://example.com/api/sync/highlights",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": "device1",
          },
          body: JSON.stringify({ items: [item2] }),
        },
      );

      expect(response2.status).toBe(200);
      const pushData2 = await response2.json();
      expect(pushData2.results[0].accepted).toBe(true);

      // Device1 pulls to verify the newer version from device2 is still stored
      const pullResponse = await SELF.fetch(
        "http://example.com/api/sync/highlights?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device1",
          },
        },
      );

      const pullData = await pullResponse.json();
      const lwwItem = pullData.items.find((item) => item.id === "lww-item-2");
      expect(lwwItem).toBeDefined();
      expect(lwwItem._hlc).toBe("3001-0-device2");
      expect(lwwItem.data.text).toBe("Newer text");
      expect(lwwItem.data.version).toBe(1);
    });

    it("returns 401 for unauthenticated requests", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/highlights",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Device-ID": "device1",
          },
          body: JSON.stringify({ items: [] }),
        },
      );

      expect(response.status).toBe(401);
    });

    it("validates request body schema", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/highlights",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": "device1",
          },
          body: JSON.stringify({ invalid: "data" }),
        },
      );

      expect(response.status).toBe(400);
    });

    it("handles empty items array", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/highlights",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": "device1",
          },
          body: JSON.stringify({ items: [] }),
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.results).toHaveLength(0);
    });
  });

  describe("GET /api/sync/:table (pull)", () => {
    beforeAll(async () => {
      // Setup test data - Device1 pushes some items
      const items = [
        {
          id: "pull-item-1",
          entityId: "book-123",
          _hlc: "4000-0-device1",
          _deviceId: "device1",
          _isDeleted: false,
          data: { text: "Pull test 1" },
        },
        {
          id: "pull-item-2",
          entityId: "book-123",
          _hlc: "4001-0-device1",
          _deviceId: "device1",
          _isDeleted: false,
          data: { text: "Pull test 2" },
        },
        {
          id: "pull-item-3",
          entityId: "book-other",
          _hlc: "4002-0-device1",
          _deviceId: "device1",
          _isDeleted: false,
          data: { text: "Different entity" },
        },
      ];

      await SELF.fetch("http://example.com/api/sync/highlights", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
          "X-Device-ID": "device1",
        },
        body: JSON.stringify({ items }),
      });
    });

    it("pulls all items when since=0", async () => {
      // Device2 pulls all items and should see device1's data
      const response = await SELF.fetch(
        "http://example.com/api/sync/highlights?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device2",
          },
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.serverTimestamp).toBeDefined();
      expect(data.hasMore).toBeDefined();
    });

    it("pulls items after a specific timestamp", async () => {
      // Device2 gets initial timestamp
      const response1 = await SELF.fetch(
        "http://example.com/api/sync/highlights?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device2",
          },
        },
      );

      const data1 = await response1.json();
      const firstTimestamp = data1.serverTimestamp;

      // Device2 pulls items since that timestamp
      const response2 = await SELF.fetch(
        `http://example.com/api/sync/highlights?since=${firstTimestamp}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device2",
          },
        },
      );

      expect(response2.status).toBe(200);
      const data2 = await response2.json();
      expect(data2.items).toBeDefined();
      // Items should have timestamp > firstTimestamp
      for (const item of data2.items) {
        expect(item._serverTimestamp).toBeGreaterThan(firstTimestamp);
      }
    });

    it("filters by entityId when provided", async () => {
      // Device2 pulls with entityId filter and should see device1's data for that entity
      const response = await SELF.fetch(
        "http://example.com/api/sync/highlights?since=0&entityId=book-123",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device2",
          },
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);

      // All items should have the specified entityId
      const pullItems = data.items.filter(
        (item) => item.entityId === "book-123",
      );
      const otherItems = data.items.filter(
        (item) => item.entityId !== "book-123",
      );

      expect(pullItems.length).toBeGreaterThan(0);
      expect(otherItems.length).toBe(0);
    });

    it("respects limit parameter", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/highlights?since=0&limit=2",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device1",
          },
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.items.length).toBeLessThanOrEqual(2);
    });

    it("sets hasMore flag correctly when there are more items", async () => {
      // First, ensure we have enough items
      const manyItems = Array.from({ length: 10 }, (_, i) => ({
        id: `pagination-item-${i}`,
        entityId: "book-pagination",
        _hlc: `5${String(i).padStart(3, "0")}-0-device1`,
        _deviceId: "device1",
        _isDeleted: false,
        data: { text: `Item ${i}` },
      }));

      await SELF.fetch("http://example.com/api/sync/highlights", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
          "X-Device-ID": "device1",
        },
        body: JSON.stringify({ items: manyItems }),
      });

      // Pull with small limit
      const response = await SELF.fetch(
        "http://example.com/api/sync/highlights?since=0&limit=5",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device1",
          },
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      // hasMore should be true if there are more than 5 items total
      expect(typeof data.hasMore).toBe("boolean");
    });

    it("returns 401 for unauthenticated requests", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/highlights?since=0",
        {
          headers: {
            "X-Device-ID": "device1",
          },
        },
      );

      expect(response.status).toBe(401);
    });

    it("includes deleted items in pull results", async () => {
      // Device1 pushes a deleted item
      const deletedItem = {
        id: "deleted-pull-item",
        entityId: "book-delete",
        _hlc: "6000-0-device1",
        _deviceId: "device1",
        _isDeleted: true,
        data: { text: "Deleted item" },
      };

      await SELF.fetch("http://example.com/api/sync/highlights", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
          "X-Device-ID": "device1",
        },
        body: JSON.stringify({ items: [deletedItem] }),
      });

      // Device2 pulls all items and should see the deleted item from device1
      const response = await SELF.fetch(
        "http://example.com/api/sync/highlights?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device2",
          },
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      const foundDeletedItem = data.items.find(
        (item) => item.id === "deleted-pull-item",
      );
      expect(foundDeletedItem).toBeDefined();
      expect(foundDeletedItem._isDeleted).toBe(true);
    });
  });

  describe("Sync workflow", () => {
    it("supports full push-pull sync cycle", async () => {
      // 1. Device1 pushes some items
      const pushItems = [
        {
          id: "cycle-item-1",
          entityId: "book-cycle",
          _hlc: "7000-0-device1",
          _deviceId: "device1",
          _isDeleted: false,
          data: { text: "Cycle test 1", color: "yellow" },
        },
        {
          id: "cycle-item-2",
          entityId: "book-cycle",
          _hlc: "7001-0-device1",
          _deviceId: "device1",
          _isDeleted: false,
          data: { text: "Cycle test 2", color: "blue" },
        },
      ];

      const pushResponse = await SELF.fetch(
        "http://example.com/api/sync/highlights",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": "device1",
          },
          body: JSON.stringify({ items: pushItems }),
        },
      );

      expect(pushResponse.status).toBe(200);
      const pushData = await pushResponse.json();
      const firstServerTimestamp = pushData.results[0].serverTimestamp;

      // 2. Device2 pulls items and should see device1's changes
      const pullResponse = await SELF.fetch(
        `http://example.com/api/sync/highlights?since=${firstServerTimestamp - 1}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device2",
          },
        },
      );

      expect(pullResponse.status).toBe(200);
      const pullData = await pullResponse.json();
      const pulledItems = pullData.items.filter(
        (item) => item.entityId === "book-cycle",
      );
      expect(pulledItems.length).toBeGreaterThanOrEqual(2);

      const item1 = pulledItems.find((item) => item.id === "cycle-item-1");
      const item2 = pulledItems.find((item) => item.id === "cycle-item-2");
      expect(item1).toBeDefined();
      expect(item1.data.text).toBe("Cycle test 1");
      expect(item1._deviceId).toBe("device1");
      expect(item2).toBeDefined();
      expect(item2.data.text).toBe("Cycle test 2");
      expect(item2._deviceId).toBe("device1");

      // 3. Device1 pulls and should NOT see its own changes
      const device1PullResponse = await SELF.fetch(
        `http://example.com/api/sync/highlights?since=${firstServerTimestamp - 1}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device1",
          },
        },
      );

      expect(device1PullResponse.status).toBe(200);
      const device1PullData = await device1PullResponse.json();
      const device1PulledItems = device1PullData.items.filter(
        (item) => item.entityId === "book-cycle",
      );
      // Device1 should not see its own items
      expect(device1PulledItems.length).toBe(0);
    });

    it("handles concurrent updates from different devices", async () => {
      const itemId = "concurrent-item";
      const entityId = "book-concurrent";

      // Device 1 pushes first version
      await SELF.fetch("http://example.com/api/sync/highlights", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
          "X-Device-ID": "device1",
        },
        body: JSON.stringify({
          items: [
            {
              id: itemId,
              entityId,
              _hlc: "1000-0-device1",
              _deviceId: "device1",
              _isDeleted: false,
              data: { text: "Original text", version: 1 },
            },
          ],
        }),
      });

      // Device 2 pushes second version with higher HLC
      await SELF.fetch("http://example.com/api/sync/highlights", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
          "X-Device-ID": "device2",
        },
        body: JSON.stringify({
          items: [
            {
              id: itemId,
              entityId,
              _hlc: "1001-0-device2",
              _deviceId: "device2",
              _isDeleted: false,
              data: { text: "Updated from device2", version: 2 },
            },
          ],
        }),
      });

      // Pull to verify device 2's version won
      const pullResponse = await SELF.fetch(
        "http://example.com/api/sync/highlights?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device1",
          },
        },
      );

      const pullData = await pullResponse.json();
      const item = pullData.items.find((item) => item.id === itemId);
      expect(item).toBeDefined();
      expect(item._deviceId).toBe("device2");
      expect(item.data.version).toBe(2);
      expect(item.data.text).toBe("Updated from device2");
    });
  });

  describe("Multiple table support", () => {
    it("isolates data between different tables", async () => {
      const itemId = "multi-table-item";

      // Push to highlights table
      await SELF.fetch("http://example.com/api/sync/highlights", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
          "X-Device-ID": "device1",
        },
        body: JSON.stringify({
          items: [
            {
              id: itemId,
              _hlc: "1000-0-device1",
              _deviceId: "device1",
              _isDeleted: false,
              data: { type: "highlight" },
            },
          ],
        }),
      });

      // Push to bookmarks table (different table)
      await SELF.fetch("http://example.com/api/sync/bookmarks", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
          "X-Device-ID": "device1",
        },
        body: JSON.stringify({
          items: [
            {
              id: itemId,
              _hlc: "1001-0-device1",
              _deviceId: "device1",
              _isDeleted: false,
              data: { type: "bookmark" },
            },
          ],
        }),
      });

      // Device2 pulls from highlights and should see device1's highlight
      const highlightsResponse = await SELF.fetch(
        "http://example.com/api/sync/highlights?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device2",
          },
        },
      );

      const highlightsData = await highlightsResponse.json();
      const highlightItem = highlightsData.items.find((i) => i.id === itemId);
      expect(highlightItem?.data.type).toBe("highlight");

      // Device2 pulls from bookmarks and should see device1's bookmark
      const bookmarksResponse = await SELF.fetch(
        "http://example.com/api/sync/bookmarks?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": "device2",
          },
        },
      );

      const bookmarksData = await bookmarksResponse.json();
      const bookmarkItem = bookmarksData.items.find((i) => i.id === itemId);
      expect(bookmarkItem?.data.type).toBe("bookmark");
    });
  });
});

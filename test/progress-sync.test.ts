import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser } from "./helpers";

// Response types for progress sync API
interface SyncProgressResponse {
  entries: Array<{
    id: string;
    fileHash: string;
    spineIndex: number;
    scrollProgress: number;
    clientSeq: number;
    clientTimestamp: number;
    serverSeq: number;
    serverTimestamp: number;
    deviceId: string;
  }>;
  serverTimestamp: number;
}

interface PushProgressResponse {
  results: Array<{
    id: string;
    serverSeq: number;
    status: "created" | "duplicate";
  }>;
}

interface ErrorResponse {
  error: string;
}

describe("Progress Sync API", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  const deviceId1 = "test-device-progress-001";
  const deviceId2 = "test-device-progress-002";
  const testFileHash = "abc123def456";
  const testFileHash2 = "xyz789abc123";

  beforeAll(async () => {
    testUser = await createTestUser(
      "progresstest@example.com",
      "testpassword123",
      "Progress Test User",
    );

    // Register the device first by making a request with X-Device-ID header
    await SELF.fetch("http://example.com/api/devices", {
      headers: {
        Cookie: testUser.sessionCookie,
        "X-Device-ID": deviceId1,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    // Register second device
    await SELF.fetch("http://example.com/api/devices", {
      headers: {
        Cookie: testUser.sessionCookie,
        "X-Device-ID": deviceId2,
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15",
      },
    });
  });

  describe("GET /api/sync/progress", () => {
    it("returns empty array when no progress entries exist", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/progress?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": deviceId1,
          },
        },
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as SyncProgressResponse;
      expect(data.entries).toBeDefined();
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data.serverTimestamp).toBeDefined();
    });

    it("returns 401 for unauthenticated requests", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/progress?since=0",
      );

      expect(response.status).toBe(401);
      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when no device ID is provided", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/progress?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(response.status).toBe(401);
      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("POST /api/sync/progress", () => {
    it("creates new progress entries", async () => {
      const entries = [
        {
          id: crypto.randomUUID(),
          fileHash: testFileHash,
          spineIndex: 0,
          scrollProgress: 0.25,
          clientSeq: 1,
          clientTimestamp: Date.now(),
        },
        {
          id: crypto.randomUUID(),
          fileHash: testFileHash,
          spineIndex: 0,
          scrollProgress: 0.5,
          clientSeq: 2,
          clientTimestamp: Date.now() + 1000,
        },
      ];

      const response = await SELF.fetch(
        "http://example.com/api/sync/progress",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": deviceId1,
          },
          body: JSON.stringify({ entries }),
        },
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as PushProgressResponse;
      expect(data.results).toBeDefined();
      expect(data.results.length).toBe(2);
      expect(data.results[0].status).toBe("created");
      expect(data.results[0].serverSeq).toBeGreaterThan(0);
      expect(data.results[1].status).toBe("created");
      expect(data.results[1].serverSeq).toBeGreaterThan(
        data.results[0].serverSeq,
      );
    });

    it("returns duplicate for already synced entries", async () => {
      const entryId = crypto.randomUUID();
      const entries = [
        {
          id: entryId,
          fileHash: testFileHash,
          spineIndex: 1,
          scrollProgress: 0.75,
          clientSeq: 3,
          clientTimestamp: Date.now(),
        },
      ];

      // First push
      const response1 = await SELF.fetch(
        "http://example.com/api/sync/progress",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": deviceId1,
          },
          body: JSON.stringify({ entries }),
        },
      );

      expect(response1.status).toBe(200);
      const data1 = (await response1.json()) as PushProgressResponse;
      expect(data1.results[0].status).toBe("created");

      // Second push with same entry
      const response2 = await SELF.fetch(
        "http://example.com/api/sync/progress",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": deviceId1,
          },
          body: JSON.stringify({ entries }),
        },
      );

      expect(response2.status).toBe(200);
      const data2 = (await response2.json()) as PushProgressResponse;
      expect(data2.results[0].status).toBe("duplicate");
    });

    it("returns 401 for unauthenticated requests", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/progress",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            entries: [
              {
                id: crypto.randomUUID(),
                fileHash: testFileHash,
                spineIndex: 0,
                scrollProgress: 0.5,
                clientSeq: 1,
                clientTimestamp: Date.now(),
              },
            ],
          }),
        },
      );

      expect(response.status).toBe(401);
    });

    it("returns 401 when no device ID is provided", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/progress",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            entries: [
              {
                id: crypto.randomUUID(),
                fileHash: testFileHash,
                spineIndex: 0,
                scrollProgress: 0.5,
                clientSeq: 1,
                clientTimestamp: Date.now(),
              },
            ],
          }),
        },
      );

      expect(response.status).toBe(401);
    });

    it("validates request body schema", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/progress",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": deviceId1,
          },
          body: JSON.stringify({
            entries: [
              {
                // Missing required fields
                fileHash: testFileHash,
              },
            ],
          }),
        },
      );

      expect(response.status).toBe(400);
    });
  });

  describe("Progress sync with since parameter", () => {
    it("returns progress entries after since serverSeq", async () => {
      // First, push some entries
      const entries = [
        {
          id: crypto.randomUUID(),
          fileHash: testFileHash2,
          spineIndex: 0,
          scrollProgress: 0.1,
          clientSeq: 1,
          clientTimestamp: Date.now(),
        },
        {
          id: crypto.randomUUID(),
          fileHash: testFileHash2,
          spineIndex: 0,
          scrollProgress: 0.2,
          clientSeq: 2,
          clientTimestamp: Date.now() + 1000,
        },
      ];

      const pushResponse = await SELF.fetch(
        "http://example.com/api/sync/progress",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": deviceId1,
          },
          body: JSON.stringify({ entries }),
        },
      );

      expect(pushResponse.status).toBe(200);
      const pushData = (await pushResponse.json()) as PushProgressResponse;
      const firstServerSeq = pushData.results[0].serverSeq;

      // Now pull with since=0 to get all entries
      const pullResponse = await SELF.fetch(
        "http://example.com/api/sync/progress?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": deviceId1,
          },
        },
      );

      expect(pullResponse.status).toBe(200);
      const pullData = (await pullResponse.json()) as SyncProgressResponse;
      expect(pullData.entries.length).toBeGreaterThanOrEqual(2);

      // Pull with since=firstServerSeq should exclude the first entry
      const pullResponse2 = await SELF.fetch(
        `http://example.com/api/sync/progress?since=${firstServerSeq}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": deviceId1,
          },
        },
      );

      expect(pullResponse2.status).toBe(200);
      const pullData2 = (await pullResponse2.json()) as SyncProgressResponse;

      // Should have at least one entry (the second one)
      const entriesAfterFirst = pullData2.entries.filter(
        (e) => e.serverSeq > firstServerSeq,
      );
      expect(entriesAfterFirst.length).toBeGreaterThanOrEqual(1);
    });

    it("filters by fileHash when provided", async () => {
      const uniqueFileHash = `unique-${Date.now()}`;

      // Push entry for unique book
      const entries = [
        {
          id: crypto.randomUUID(),
          fileHash: uniqueFileHash,
          spineIndex: 2,
          scrollProgress: 0.9,
          clientSeq: 1,
          clientTimestamp: Date.now(),
        },
      ];

      await SELF.fetch("http://example.com/api/sync/progress", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
          "X-Device-ID": deviceId1,
        },
        body: JSON.stringify({ entries }),
      });

      // Pull with fileHash filter
      const pullResponse = await SELF.fetch(
        `http://example.com/api/sync/progress?since=0&fileHash=${uniqueFileHash}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": deviceId1,
          },
        },
      );

      expect(pullResponse.status).toBe(200);
      const pullData = (await pullResponse.json()) as SyncProgressResponse;
      expect(pullData.entries.length).toBe(1);
      expect(pullData.entries[0].fileHash).toBe(uniqueFileHash);
    });
  });

  describe("Multi-device progress sync", () => {
    it("syncs progress between devices", async () => {
      const sharedFileHash = `shared-${Date.now()}`;

      // Device 1 pushes progress
      const device1Entries = [
        {
          id: crypto.randomUUID(),
          fileHash: sharedFileHash,
          spineIndex: 0,
          scrollProgress: 0.3,
          clientSeq: 1,
          clientTimestamp: Date.now(),
        },
      ];

      const push1Response = await SELF.fetch(
        "http://example.com/api/sync/progress",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": deviceId1,
          },
          body: JSON.stringify({ entries: device1Entries }),
        },
      );

      expect(push1Response.status).toBe(200);

      // Device 2 pulls progress and should see Device 1's entry
      const pull2Response = await SELF.fetch(
        `http://example.com/api/sync/progress?since=0&fileHash=${sharedFileHash}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": deviceId2,
          },
        },
      );

      expect(pull2Response.status).toBe(200);
      const pull2Data = (await pull2Response.json()) as SyncProgressResponse;
      expect(pull2Data.entries.length).toBe(1);
      expect(pull2Data.entries[0].scrollProgress).toBe(0.3);

      // Device 2 pushes new progress
      const device2Entries = [
        {
          id: crypto.randomUUID(),
          fileHash: sharedFileHash,
          spineIndex: 1,
          scrollProgress: 0.6,
          clientSeq: 1,
          clientTimestamp: Date.now() + 5000,
        },
      ];

      const push2Response = await SELF.fetch(
        "http://example.com/api/sync/progress",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": deviceId2,
          },
          body: JSON.stringify({ entries: device2Entries }),
        },
      );

      expect(push2Response.status).toBe(200);

      // Device 1 pulls and should see both entries
      const pull1Response = await SELF.fetch(
        `http://example.com/api/sync/progress?since=0&fileHash=${sharedFileHash}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": deviceId1,
          },
        },
      );

      expect(pull1Response.status).toBe(200);
      const pull1Data = (await pull1Response.json()) as SyncProgressResponse;
      expect(pull1Data.entries.length).toBe(2);

      // Entries should be ordered by serverSeq
      expect(pull1Data.entries[0].serverSeq).toBeLessThan(
        pull1Data.entries[1].serverSeq,
      );
    });
  });

  describe("Progress entry ordering", () => {
    it("maintains serverSeq ordering for total order", async () => {
      const orderTestFileHash = `order-${Date.now()}`;

      // Push multiple entries
      const entries = [];
      for (let i = 0; i < 5; i++) {
        entries.push({
          id: crypto.randomUUID(),
          fileHash: orderTestFileHash,
          spineIndex: i,
          scrollProgress: (i + 1) * 0.1,
          clientSeq: i + 1,
          clientTimestamp: Date.now() + i * 100,
        });
      }

      const pushResponse = await SELF.fetch(
        "http://example.com/api/sync/progress",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
            "X-Device-ID": deviceId1,
          },
          body: JSON.stringify({ entries }),
        },
      );

      expect(pushResponse.status).toBe(200);
      const pushData = (await pushResponse.json()) as PushProgressResponse;

      // Verify serverSeq is monotonically increasing
      for (let i = 1; i < pushData.results.length; i++) {
        expect(pushData.results[i].serverSeq).toBeGreaterThan(
          pushData.results[i - 1].serverSeq,
        );
      }

      // Pull and verify ordering is preserved
      const pullResponse = await SELF.fetch(
        `http://example.com/api/sync/progress?since=0&fileHash=${orderTestFileHash}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
            "X-Device-ID": deviceId1,
          },
        },
      );

      expect(pullResponse.status).toBe(200);
      const pullData = (await pullResponse.json()) as SyncProgressResponse;

      // Entries should be ordered by serverSeq
      for (let i = 1; i < pullData.entries.length; i++) {
        expect(pullData.entries[i].serverSeq).toBeGreaterThan(
          pullData.entries[i - 1].serverSeq,
        );
      }
    });
  });
});

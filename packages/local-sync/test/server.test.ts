import { describe, expect, it } from "vitest";
import type { SyncRecord } from "../src/core/index.js";
import { SyncServer, SyncServerValidationError } from "../src/server/index.js";
import { InMemoryServerSyncStorage } from "../src/server/testing.js";

interface TestPayload {
  id: string;
  value: string;
}

const NOW = 1_000_000;

describe("server bag-of-rows sync", () => {
  it("stores only the LWW winner and sequences accepted changes", async () => {
    const server = createServer();

    const first = await server.push({
      appName: "reader",
      userId: "user-1",
      deviceId: "device-a",
      records: [record({ wallTimeMs: 100, value: "first" })],
    });
    const rejected = await server.push({
      appName: "reader",
      userId: "user-1",
      deviceId: "device-z",
      records: [
        record({ wallTimeMs: 99, deviceId: "device-z", value: "older" }),
      ],
    });
    const tieBreakWinner = await server.push({
      appName: "reader",
      userId: "user-1",
      deviceId: "device-b",
      records: [
        record({
          wallTimeMs: 100,
          deviceId: "device-b",
          value: "tie-break winner",
        }),
      ],
    });

    expect(first.outcomes[0]).toMatchObject({
      accepted: true,
      record: { serverSeq: 1, payload: { value: "first" } },
    });
    expect(rejected.outcomes[0]).toMatchObject({
      accepted: false,
      record: { serverSeq: 1, payload: { value: "first" } },
    });
    expect(tieBreakWinner.outcomes[0]).toMatchObject({
      accepted: true,
      record: { serverSeq: 2, payload: { value: "tie-break winner" } },
    });

    const pulled = await server.pull({
      appName: "reader",
      userId: "user-1",
      cursor: 0,
    });
    expect(pulled).toMatchObject({
      cursor: 2,
      hasMore: false,
      records: [{ serverSeq: 2, payload: { value: "tie-break winner" } }],
    });
    expect("appName" in pulled.records[0]!).toBe(false);
    expect("userId" in pulled.records[0]!).toBe(false);
  });

  it("paginates one global sequence across isolated app namespaces", async () => {
    const storage = new InMemoryServerSyncStorage<TestPayload>();
    const server = createServer(storage);

    await server.push({
      appName: "reader",
      userId: "user-1",
      deviceId: "device-a",
      records: [record({ recordId: "book-1", wallTimeMs: 100 })],
    });
    await server.push({
      appName: "flashcards",
      userId: "user-1",
      deviceId: "device-a",
      records: [record({ recordId: "card-1", wallTimeMs: 101 })],
    });
    await server.push({
      appName: "reader",
      userId: "user-1",
      deviceId: "device-a",
      records: [
        record({
          tableName: "highlights",
          recordId: "highlight-1",
          scopeId: "book-1",
          wallTimeMs: 102,
        }),
        record({
          tableName: "highlights",
          recordId: "highlight-2",
          scopeId: "book-2",
          wallTimeMs: 103,
        }),
      ],
    });

    const firstPage = await server.pull({
      appName: "reader",
      userId: "user-1",
      cursor: 0,
      limit: 1,
    });
    const secondPage = await server.pull({
      appName: "reader",
      userId: "user-1",
      cursor: firstPage.cursor,
      limit: 1,
    });
    const scoped = await server.pull({
      appName: "reader",
      userId: "user-1",
      tableName: "highlights",
      scopeId: "book-1",
      cursor: 0,
    });

    expect(firstPage).toMatchObject({
      cursor: 1,
      hasMore: true,
      records: [{ recordId: "book-1" }],
    });
    expect(secondPage).toMatchObject({
      cursor: 3,
      hasMore: true,
      records: [{ recordId: "highlight-1" }],
    });
    expect(scoped).toMatchObject({
      cursor: 3,
      hasMore: false,
      records: [{ recordId: "highlight-1" }],
    });
    expect(
      await server.pull({
        appName: "reader",
        userId: "user-2",
        cursor: 0,
      }),
    ).toEqual({ records: [], cursor: 0, hasMore: false });
  });

  it("retains tombstone payloads and allows a newer restore", async () => {
    const server = createServer();

    await server.push({
      appName: "reader",
      userId: "user-1",
      deviceId: "device-a",
      records: [record({ wallTimeMs: 100, value: "original" })],
    });
    await server.push({
      appName: "reader",
      userId: "user-1",
      deviceId: "device-a",
      records: [
        record({
          operation: "delete",
          wallTimeMs: 101,
          value: "retained while deleted",
        }),
      ],
    });

    const deleted = await server.pull({
      appName: "reader",
      userId: "user-1",
      cursor: 0,
    });
    expect(deleted.records[0]).toMatchObject({
      operation: "delete",
      payload: { value: "retained while deleted" },
      serverSeq: 2,
    });

    await server.push({
      appName: "reader",
      userId: "user-1",
      deviceId: "device-a",
      records: [record({ wallTimeMs: 102, value: "restored" })],
    });
    const restored = await server.pull({
      appName: "reader",
      userId: "user-1",
      cursor: 2,
    });
    expect(restored.records[0]).toMatchObject({
      operation: "put",
      payload: { value: "restored" },
      serverSeq: 3,
    });
  });

  it("rejects invalid batches before touching storage", async () => {
    const server = createServer();

    await expect(
      server.push({
        appName: "reader",
        userId: "user-1",
        deviceId: "device-a",
        records: [record({ deviceId: "device-b", wallTimeMs: 100 })],
      }),
    ).rejects.toBeInstanceOf(SyncServerValidationError);
    await expect(
      server.push({
        appName: "reader",
        userId: "user-1",
        deviceId: "device-a",
        records: [record({ wallTimeMs: NOW + 1_001 })],
      }),
    ).rejects.toThrow("future clock skew");

    const duplicate = record({ wallTimeMs: 100 });
    await expect(
      server.push({
        appName: "reader",
        userId: "user-1",
        deviceId: "device-a",
        records: [duplicate, duplicate],
      }),
    ).rejects.toThrow("duplicate record");

    expect(
      await server.pull({
        appName: "reader",
        userId: "user-1",
        cursor: 0,
      }),
    ).toEqual({ records: [], cursor: 0, hasMore: false });
  });

  it("requires scoped pulls to use their own table cursor", async () => {
    const server = createServer();

    await expect(
      server.pull({
        appName: "reader",
        userId: "user-1",
        scopeId: "book-1",
        cursor: 0,
      }),
    ).rejects.toThrow("scopeId requires a tableName filter");
  });
});

function createServer(
  storage = new InMemoryServerSyncStorage<TestPayload>(),
): SyncServer<TestPayload> {
  return new SyncServer(storage, {
    now: () => NOW,
    maxFutureClockSkewMs: 1_000,
  });
}

function record(options: {
  operation?: "put" | "delete";
  tableName?: string;
  recordId?: string;
  scopeId?: string;
  wallTimeMs: number;
  counter?: number;
  deviceId?: string;
  value?: string;
}): SyncRecord<TestPayload> {
  const base = {
    tableName: options.tableName ?? "books",
    recordId: options.recordId ?? "book-1",
    ...(options.scopeId === undefined ? {} : { scopeId: options.scopeId }),
    hlc: {
      wallTimeMs: options.wallTimeMs,
      counter: options.counter ?? 0,
    },
    deviceId: options.deviceId ?? "device-a",
    schemaVersion: 1,
    payload: {
      id: options.recordId ?? "book-1",
      value: options.value ?? "value",
    },
  };

  if (options.operation === "delete") {
    return { ...base, operation: "delete" };
  }

  return { ...base, operation: "put" };
}

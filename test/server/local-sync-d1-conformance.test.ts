import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  D1ServerSyncStorage,
  D1SyncBatchTooLargeError,
} from "../../packages/local-sync/src/adapters/d1/index";
import {
  D1_APPLY_LWW_BATCH_SQL,
  D1_READ_BATCH_WINNERS_SQL,
  D1_SCAN_APP_SQL,
  D1_SCAN_SCOPE_SQL,
  D1_SCAN_TABLE_SQL,
  D1_SYNC_ROWS_TABLE,
} from "../../packages/local-sync/src/adapters/d1/sql";
import type { SyncRecord } from "../../packages/local-sync/src/core/index";
import {
  MAX_SERVER_PUSH_BATCH_SIZE,
  SyncServer,
} from "../../packages/local-sync/src/server/index";

interface TestPayload {
  value: string;
}

const NAMESPACE = { appName: "reader", userId: "user-1" } as const;
const NOW = 1_000_000;

describe("D1ServerSyncStorage", () => {
  beforeEach(async () => {
    await env.DATABASE.batch([
      env.DATABASE.prepare(`DELETE FROM ${D1_SYNC_ROWS_TABLE}`),
      env.DATABASE.prepare("DELETE FROM sqlite_sequence WHERE name = ?").bind(
        D1_SYNC_ROWS_TABLE,
      ),
    ]);
  });

  it("is backed by the package migration", async () => {
    const migrations = await env.DATABASE.prepare(
      "SELECT name FROM d1_migrations ORDER BY id",
    ).all<{ name: string }>();
    const schema = await env.DATABASE.prepare(
      `SELECT name FROM sqlite_schema
       WHERE name = ? OR name LIKE 'local_sync_rows_%'
       ORDER BY name`,
    )
      .bind(D1_SYNC_ROWS_TABLE)
      .all<{ name: string }>();

    expect(schema.results.map((row) => row.name)).toEqual([
      "local_sync_rows",
      "local_sync_rows_app_seq_idx",
      "local_sync_rows_logical_key_idx",
      "local_sync_rows_scope_seq_idx",
      "local_sync_rows_table_seq_idx",
    ]);
    expect(migrations.results.at(-1)?.name).toBe(
      "0000_create_local_sync_rows.sql",
    );
  });

  it("applies mixed LWW outcomes through SyncServer without cursor gaps", async () => {
    const storage = createStorage();
    const server = createServer(storage);
    const initial = await server.push({
      ...NAMESPACE,
      deviceId: "device-a",
      records: [
        record({ recordId: "book-1", wallTimeMs: 100, value: "first" }),
        record({ recordId: "book-2", wallTimeMs: 200, value: "second" }),
      ],
    });
    const initialCursor = Math.max(
      ...initial.outcomes.map((outcome) => outcome.record.serverSeq),
    );
    const candidates = [
      record({
        recordId: "book-1",
        wallTimeMs: 99,
        deviceId: "device-z",
        value: "stale",
      }),
      record({
        recordId: "book-2",
        wallTimeMs: 200,
        deviceId: "device-z",
        value: "tie-break winner",
      }),
      record({
        recordId: "book-3",
        wallTimeMs: 300,
        deviceId: "device-z",
        value: "new",
      }),
    ];

    const mixed = await server.push({
      ...NAMESPACE,
      deviceId: "device-z",
      records: candidates,
    });

    expect(mixed.outcomes.map((outcome) => outcome.accepted)).toEqual([
      false,
      true,
      true,
    ]);
    expect(mixed.outcomes[0]).toMatchObject({
      record: {
        serverSeq: initial.outcomes[0]!.record.serverSeq,
        payload: { value: "first" },
      },
    });
    expect(mixed.outcomes[1]).toMatchObject({
      record: {
        deviceId: "device-z",
        payload: { value: "tie-break winner" },
      },
    });

    const catchUp = await server.pull({
      ...NAMESPACE,
      cursor: initialCursor,
    });
    expect(catchUp.records.map((row) => row.recordId)).toEqual([
      "book-2",
      "book-3",
    ]);

    const retry = await server.push({
      ...NAMESPACE,
      deviceId: "device-z",
      records: candidates,
    });
    expect(retry.outcomes.map((outcome) => outcome.accepted)).toEqual([
      false,
      false,
      false,
    ]);
    expect(retry.outcomes.map((outcome) => outcome.record.serverSeq)).toEqual(
      mixed.outcomes.map((outcome) => outcome.record.serverSeq),
    );

    const allocator = await env.DATABASE.prepare(
      "SELECT seq FROM sqlite_sequence WHERE name = ?",
    )
      .bind(D1_SYNC_ROWS_TABLE)
      .first<{ seq: number }>();
    expect(allocator!.seq).toBeGreaterThan(catchUp.cursor);
  });

  it("accepts 500 small records and rejects an oversized encoded batch", async () => {
    const records = Array.from({ length: MAX_SERVER_PUSH_BATCH_SIZE }, (_, i) =>
      record({ recordId: `book-${i}`, wallTimeMs: 1_000 + i }),
    );
    const outcomes = await createStorage().applyLww(NAMESPACE, records);

    expect(outcomes).toHaveLength(MAX_SERVER_PUSH_BATCH_SIZE);
    expect(outcomes.every((outcome) => outcome.accepted)).toBe(true);
    expect(
      new Set(outcomes.map((outcome) => outcome.winner.serverSeq)).size,
    ).toBe(MAX_SERVER_PUSH_BATCH_SIZE);

    const limitedStorage = createStorage({ maxEncodedBatchBytes: 200 });
    await expect(
      limitedStorage.applyLww(NAMESPACE, [
        record({
          recordId: "too-large",
          wallTimeMs: 2_000,
          value: "x".repeat(500),
        }),
      ]),
    ).rejects.toMatchObject({
      name: "D1SyncBatchTooLargeError",
      maxEncodedBytes: 200,
    } satisfies Partial<D1SyncBatchTooLargeError>);
  });

  it("orders HLC components before the device-ID tie-breaker", async () => {
    const storage = createStorage();
    await storage.applyLww(NAMESPACE, [
      record({
        recordId: "book-1",
        wallTimeMs: 100,
        counter: 0,
        deviceId: "device-z",
      }),
    ]);

    const [higherCounter] = await storage.applyLww(NAMESPACE, [
      record({
        recordId: "book-1",
        wallTimeMs: 100,
        counter: 1,
        deviceId: "device-a",
      }),
    ]);
    const [lowerWallTime] = await storage.applyLww(NAMESPACE, [
      record({
        recordId: "book-1",
        wallTimeMs: 99,
        counter: 100,
        deviceId: "device-z",
      }),
    ]);

    expect(higherCounter).toMatchObject({
      accepted: true,
      winner: {
        hlc: { wallTimeMs: 100, counter: 1 },
        deviceId: "device-a",
      },
    });
    expect(lowerWallTime).toMatchObject({
      accepted: false,
      winner: {
        hlc: { wallTimeMs: 100, counter: 1 },
        deviceId: "device-a",
      },
    });
  });

  it("retains tombstone payloads and sequences a later restore", async () => {
    const storage = createStorage();
    await storage.applyLww(NAMESPACE, [
      record({ recordId: "book-1", wallTimeMs: 100, value: "original" }),
    ]);
    const [deleted] = await storage.applyLww(NAMESPACE, [
      record({
        operation: "delete",
        recordId: "book-1",
        wallTimeMs: 101,
        value: "retained",
      }),
    ]);
    const [restored] = await storage.applyLww(NAMESPACE, [
      record({ recordId: "book-1", wallTimeMs: 102, value: "restored" }),
    ]);

    expect(deleted!.winner).toMatchObject({
      operation: "delete",
      payload: { value: "retained" },
    });
    expect(restored!.winner).toMatchObject({
      operation: "put",
      payload: { value: "restored" },
    });
    expect(restored!.winner.serverSeq).toBeGreaterThan(
      deleted!.winner.serverSeq,
    );
  });

  it("rolls back the D1 batch when a statement fails", async () => {
    const valid = env.DATABASE.prepare(D1_APPLY_LWW_BATCH_SQL).bind(
      NAMESPACE.appName,
      NAMESPACE.userId,
      JSON.stringify([record({ recordId: "book-1", wallTimeMs: 100 })]),
    );
    const invalid = env.DATABASE.prepare(
      `INSERT INTO ${D1_SYNC_ROWS_TABLE} (
        app_name,
        user_id,
        table_name,
        record_id,
        hlc_wall_time_ms,
        hlc_counter,
        device_id,
        schema_version,
        is_deleted,
        payload
      ) VALUES ('reader', 'user-1', 'books', 'invalid', 100, 0, 'device-a', 1, 0, 'not-json')`,
    );

    await expect(env.DATABASE.batch([valid, invalid])).rejects.toThrow();
    expect(
      await createStorage().scan({ ...NAMESPACE, cursor: 0, limit: 10 }),
    ).toEqual([]);

    const [afterRollback] = await createStorage().applyLww(NAMESPACE, [
      record({ recordId: "book-after-rollback", wallTimeMs: 101 }),
    ]);
    expect(afterRollback!.winner.serverSeq).toBe(1);
  });

  it("paginates all scan shapes through their intended indexes", async () => {
    const storage = createStorage();
    await storage.applyLww(NAMESPACE, [
      record({ recordId: "book-1", wallTimeMs: 100 }),
      record({
        tableName: "highlights",
        recordId: "highlight-1",
        scopeId: "book-1",
        wallTimeMs: 101,
      }),
      record({
        tableName: "highlights",
        recordId: "highlight-2",
        scopeId: "book-2",
        wallTimeMs: 102,
      }),
      record({
        tableName: "settings",
        recordId: "settings-1",
        wallTimeMs: 103,
      }),
    ]);
    await storage.applyLww({ appName: "flashcards", userId: "user-1" }, [
      record({ recordId: "card-1", wallTimeMs: 104 }),
    ]);
    await storage.applyLww({ appName: "reader", userId: "user-2" }, [
      record({ recordId: "other-user-book", wallTimeMs: 105 }),
    ]);

    const firstPage = await storage.scan({
      ...NAMESPACE,
      cursor: 0,
      limit: 2,
    });
    const secondPage = await storage.scan({
      ...NAMESPACE,
      cursor: firstPage.at(-1)!.serverSeq,
      limit: 2,
    });
    const table = await storage.scan({
      ...NAMESPACE,
      tableName: "highlights",
      cursor: 0,
      limit: 10,
    });
    const scope = await storage.scan({
      ...NAMESPACE,
      tableName: "highlights",
      scopeId: "book-1",
      cursor: 0,
      limit: 10,
    });

    expect([...firstPage, ...secondPage].map((row) => row.recordId)).toEqual([
      "book-1",
      "highlight-1",
      "highlight-2",
      "settings-1",
    ]);
    expect(table.map((row) => row.recordId)).toEqual([
      "highlight-1",
      "highlight-2",
    ]);
    expect(scope.map((row) => row.recordId)).toEqual(["highlight-1"]);

    await expectIndex("local_sync_rows_app_seq_idx", D1_SCAN_APP_SQL, [
      NAMESPACE.appName,
      NAMESPACE.userId,
      0,
      10,
    ]);
    await expectIndex("local_sync_rows_table_seq_idx", D1_SCAN_TABLE_SQL, [
      NAMESPACE.appName,
      NAMESPACE.userId,
      "highlights",
      0,
      10,
    ]);
    await expectIndex("local_sync_rows_scope_seq_idx", D1_SCAN_SCOPE_SQL, [
      NAMESPACE.appName,
      NAMESPACE.userId,
      "highlights",
      "book-1",
      0,
      10,
    ]);
    await expectIndex(
      "local_sync_rows_logical_key_idx",
      D1_READ_BATCH_WINNERS_SQL,
      [
        JSON.stringify([record({ recordId: "book-1", wallTimeMs: 100 })]),
        NAMESPACE.appName,
        NAMESPACE.userId,
      ],
    );
  });
});

function createStorage(
  options: ConstructorParameters<typeof D1ServerSyncStorage>[1] = {},
): D1ServerSyncStorage<TestPayload> {
  return new D1ServerSyncStorage<TestPayload>(env.DATABASE, options);
}

function createServer(
  storage: D1ServerSyncStorage<TestPayload>,
): SyncServer<TestPayload> {
  return new SyncServer(storage, {
    now: () => NOW,
    maxFutureClockSkewMs: 0,
  });
}

async function expectIndex(
  indexName: string,
  sql: string,
  parameters: readonly unknown[],
): Promise<void> {
  const plan = await env.DATABASE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...parameters)
    .all<{ detail: string }>();
  expect(plan.results.map((row) => row.detail).join("\n")).toContain(indexName);
}

function record(options: {
  operation?: "put" | "delete";
  tableName?: string;
  recordId: string;
  scopeId?: string;
  wallTimeMs: number;
  counter?: number;
  deviceId?: string;
  value?: string;
}): SyncRecord<TestPayload> {
  const base = {
    tableName: options.tableName ?? "books",
    recordId: options.recordId,
    ...(options.scopeId === undefined ? {} : { scopeId: options.scopeId }),
    hlc: {
      wallTimeMs: options.wallTimeMs,
      counter: options.counter ?? 0,
    },
    deviceId: options.deviceId ?? "device-a",
    schemaVersion: 1,
    payload: { value: options.value ?? options.recordId },
  };

  if (options.operation === "delete") {
    return { ...base, operation: "delete" };
  }

  return { ...base, operation: "put" };
}

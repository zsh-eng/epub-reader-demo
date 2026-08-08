import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { SyncRecord } from "../../packages/local-sync/src/core/index";
import { MAX_SERVER_PUSH_BATCH_SIZE } from "../../packages/local-sync/src/server/index";
import {
  applyLwwBatch,
  CREATE_SYNC_ROWS_STATEMENTS,
  explainScan,
  prepareLwwUpsertBatch,
  READ_BATCH_WINNERS_SQL,
  scanSyncRows,
  SYNC_ROWS_TABLE,
} from "./local-sync-d1-fixture";

const NAMESPACE = { appName: "reader", userId: "user-1" } as const;

describe("local-sync D1 SQL conformance", () => {
  beforeEach(async () => {
    await env.DATABASE.batch(
      CREATE_SYNC_ROWS_STATEMENTS.map((sql) => env.DATABASE.prepare(sql)),
    );
  });

  it("assigns a fresh sequence only to visible LWW winners", async () => {
    const initial = await applyLwwBatch(env.DATABASE, NAMESPACE, [
      record({ recordId: "book-1", wallTimeMs: 100, value: "first" }),
      record({ recordId: "book-2", wallTimeMs: 200, value: "second" }),
    ]);
    const initialCursor = Math.max(
      ...initial.map((outcome) => outcome.winner.server_seq),
    );

    const mixed = await applyLwwBatch(env.DATABASE, NAMESPACE, [
      record({ recordId: "book-1", wallTimeMs: 99, value: "stale" }),
      record({
        recordId: "book-2",
        wallTimeMs: 200,
        deviceId: "device-z",
        value: "tie-break winner",
      }),
      record({ recordId: "book-3", wallTimeMs: 300, value: "new" }),
    ]);

    expect(mixed.map((outcome) => outcome.accepted)).toEqual([
      false,
      true,
      true,
    ]);
    expect(mixed[0]!.winner).toMatchObject({
      server_seq: initial[0]!.winner.server_seq,
      payload: JSON.stringify({ value: "first" }),
    });
    expect(mixed[1]!.winner).toMatchObject({
      device_id: "device-z",
      payload: JSON.stringify({ value: "tie-break winner" }),
    });
    expect(mixed[1]!.winner.server_seq).toBeGreaterThan(initialCursor);
    expect(mixed[2]!.winner.server_seq).toBeGreaterThan(
      mixed[1]!.winner.server_seq,
    );

    const catchUp = await scanSyncRows(env.DATABASE, {
      ...NAMESPACE,
      cursor: initialCursor,
      limit: 10,
    });
    expect(catchUp.map((row) => row.record_id)).toEqual(["book-2", "book-3"]);

    const retry = await applyLwwBatch(
      env.DATABASE,
      NAMESPACE,
      mixed.map((outcome) => storedRowToRecord(outcome.winner)),
    );
    expect(retry.map((outcome) => outcome.accepted)).toEqual([
      false,
      false,
      false,
    ]);
    expect(retry.map((outcome) => outcome.winner.server_seq)).toEqual(
      mixed.map((outcome) => outcome.winner.server_seq),
    );

    const allocator = await env.DATABASE.prepare(
      "SELECT seq FROM sqlite_sequence WHERE name = ?",
    )
      .bind(SYNC_ROWS_TABLE)
      .first<{ seq: number }>();
    expect(allocator!.seq).toBeGreaterThan(
      Math.max(...mixed.map((outcome) => outcome.winner.server_seq)),
    );
  });

  it("accepts the generic 500-record limit without expanding parameters", async () => {
    const records = Array.from({ length: MAX_SERVER_PUSH_BATCH_SIZE }, (_, i) =>
      record({
        recordId: `book-${i}`,
        wallTimeMs: 1_000 + i,
      }),
    );

    const outcomes = await applyLwwBatch(env.DATABASE, NAMESPACE, records);

    expect(outcomes).toHaveLength(MAX_SERVER_PUSH_BATCH_SIZE);
    expect(outcomes.every((outcome) => outcome.accepted)).toBe(true);
    expect(
      new Set(outcomes.map((outcome) => outcome.winner.server_seq)).size,
    ).toBe(MAX_SERVER_PUSH_BATCH_SIZE);
  });

  it("looks up winners by incoming key through the logical-key index", async () => {
    const records = [
      record({ recordId: "book-1", wallTimeMs: 100 }),
      record({ recordId: "book-2", wallTimeMs: 101 }),
    ];
    const plan = await env.DATABASE.prepare(
      `EXPLAIN QUERY PLAN ${READ_BATCH_WINNERS_SQL}`,
    )
      .bind(JSON.stringify(records), NAMESPACE.appName, NAMESPACE.userId)
      .all<{ detail: string }>();

    expect(plan.results.map((row) => row.detail)).toEqual([
      expect.stringContaining("SCAN json_each"),
      expect.stringContaining("local_sync_d1_rows_logical_key_idx"),
    ]);
  });

  it("orders the HLC counter before the device-ID tie-breaker", async () => {
    await applyLwwBatch(env.DATABASE, NAMESPACE, [
      record({
        recordId: "book-1",
        wallTimeMs: 100,
        counter: 0,
        deviceId: "device-z",
        value: "initial",
      }),
    ]);

    const [higherCounter] = await applyLwwBatch(env.DATABASE, NAMESPACE, [
      record({
        recordId: "book-1",
        wallTimeMs: 100,
        counter: 1,
        deviceId: "device-a",
        value: "higher counter",
      }),
    ]);
    const [lowerWallTime] = await applyLwwBatch(env.DATABASE, NAMESPACE, [
      record({
        recordId: "book-1",
        wallTimeMs: 99,
        counter: 100,
        deviceId: "device-z",
        value: "lower wall time",
      }),
    ]);

    expect(higherCounter).toMatchObject({
      accepted: true,
      winner: {
        hlc_wall_time_ms: 100,
        hlc_counter: 1,
        device_id: "device-a",
      },
    });
    expect(lowerWallTime).toMatchObject({
      accepted: false,
      winner: {
        hlc_wall_time_ms: 100,
        hlc_counter: 1,
        device_id: "device-a",
      },
    });
  });

  it("retains tombstone payloads and sequences a later restore", async () => {
    await applyLwwBatch(env.DATABASE, NAMESPACE, [
      record({ recordId: "book-1", wallTimeMs: 100, value: "original" }),
    ]);
    const [deleted] = await applyLwwBatch(env.DATABASE, NAMESPACE, [
      record({
        operation: "delete",
        recordId: "book-1",
        wallTimeMs: 101,
        value: "retained",
      }),
    ]);
    const [restored] = await applyLwwBatch(env.DATABASE, NAMESPACE, [
      record({ recordId: "book-1", wallTimeMs: 102, value: "restored" }),
    ]);

    expect(deleted!.winner).toMatchObject({
      is_deleted: 1,
      payload: JSON.stringify({ value: "retained" }),
    });
    expect(restored!.winner).toMatchObject({
      is_deleted: 0,
      payload: JSON.stringify({ value: "restored" }),
    });
    expect(restored!.winner.server_seq).toBeGreaterThan(
      deleted!.winner.server_seq,
    );
  });

  it("rolls back the entire D1 batch when a statement fails", async () => {
    const valid = prepareLwwUpsertBatch(
      env.DATABASE,
      NAMESPACE,
      JSON.stringify([record({ recordId: "book-1", wallTimeMs: 100 })]),
    );
    const invalid = env.DATABASE.prepare(
      `INSERT INTO ${SYNC_ROWS_TABLE} (
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
      await scanSyncRows(env.DATABASE, {
        ...NAMESPACE,
        cursor: 0,
        limit: 10,
      }),
    ).toEqual([]);

    const [afterRollback] = await applyLwwBatch(env.DATABASE, NAMESPACE, [
      record({ recordId: "book-after-rollback", wallTimeMs: 101 }),
    ]);
    expect(afterRollback!.winner.server_seq).toBe(1);
  });

  it("orders whole-app, table, and scoped scans through their indexes", async () => {
    await applyLwwBatch(env.DATABASE, NAMESPACE, [
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
    await applyLwwBatch(
      env.DATABASE,
      { appName: "flashcards", userId: "user-1" },
      [record({ recordId: "card-1", wallTimeMs: 104 })],
    );
    await applyLwwBatch(env.DATABASE, { appName: "reader", userId: "user-2" }, [
      record({ recordId: "other-user-book", wallTimeMs: 105 }),
    ]);

    const firstPage = await scanSyncRows(env.DATABASE, {
      ...NAMESPACE,
      cursor: 0,
      limit: 2,
    });
    const secondPage = await scanSyncRows(env.DATABASE, {
      ...NAMESPACE,
      cursor: firstPage.at(-1)!.server_seq,
      limit: 2,
    });
    const table = await scanSyncRows(env.DATABASE, {
      ...NAMESPACE,
      tableName: "highlights",
      cursor: 0,
      limit: 10,
    });
    const scope = await scanSyncRows(env.DATABASE, {
      ...NAMESPACE,
      tableName: "highlights",
      scopeId: "book-1",
      cursor: 0,
      limit: 10,
    });

    expect([...firstPage, ...secondPage].map((row) => row.record_id)).toEqual([
      "book-1",
      "highlight-1",
      "highlight-2",
      "settings-1",
    ]);
    expect(table.map((row) => row.record_id)).toEqual([
      "highlight-1",
      "highlight-2",
    ]);
    expect(scope.map((row) => row.record_id)).toEqual(["highlight-1"]);

    await expectIndex("local_sync_d1_rows_app_seq_idx", {
      ...NAMESPACE,
      cursor: 0,
      limit: 4,
    });
    await expectIndex("local_sync_d1_rows_table_seq_idx", {
      ...NAMESPACE,
      tableName: "highlights",
      cursor: 0,
      limit: 4,
    });
    await expectIndex("local_sync_d1_rows_scope_seq_idx", {
      ...NAMESPACE,
      tableName: "highlights",
      scopeId: "book-1",
      cursor: 0,
      limit: 4,
    });
  });
});

async function expectIndex(
  indexName: string,
  scan: Parameters<typeof explainScan>[1],
): Promise<void> {
  const plan = await explainScan(env.DATABASE, scan);
  expect(plan.join("\n")).toContain(indexName);
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
}): SyncRecord<{ value: string }> {
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

function storedRowToRecord(row: {
  table_name: string;
  record_id: string;
  scope_id: string | null;
  hlc_wall_time_ms: number;
  hlc_counter: number;
  device_id: string;
  schema_version: number;
  is_deleted: 0 | 1;
  payload: string;
}): SyncRecord<{ value: string }> {
  const base = {
    tableName: row.table_name,
    recordId: row.record_id,
    ...(row.scope_id === null ? {} : { scopeId: row.scope_id }),
    hlc: {
      wallTimeMs: row.hlc_wall_time_ms,
      counter: row.hlc_counter,
    },
    deviceId: row.device_id,
    schemaVersion: row.schema_version,
    payload: JSON.parse(row.payload) as { value: string },
  };

  if (row.is_deleted === 1) {
    return { ...base, operation: "delete" };
  }

  return { ...base, operation: "put" };
}

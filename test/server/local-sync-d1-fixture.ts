import type { SyncRecord } from "../../packages/local-sync/src/core/index";
import type { SyncNamespace } from "../../packages/local-sync/src/server/index";

export const SYNC_ROWS_TABLE = "local_sync_d1_rows";

export const CREATE_SYNC_ROWS_STATEMENTS = [
  `DROP TABLE IF EXISTS ${SYNC_ROWS_TABLE}`,
  `CREATE TABLE ${SYNC_ROWS_TABLE} (
    server_seq INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    scope_id TEXT,
    hlc_wall_time_ms INTEGER NOT NULL,
    hlc_counter INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    is_deleted INTEGER NOT NULL CHECK (is_deleted IN (0, 1)),
    payload TEXT NOT NULL CHECK (json_valid(payload))
  )`,
  `CREATE UNIQUE INDEX local_sync_d1_rows_logical_key_idx
    ON ${SYNC_ROWS_TABLE} (app_name, user_id, table_name, record_id)`,
  `CREATE INDEX local_sync_d1_rows_app_seq_idx
    ON ${SYNC_ROWS_TABLE} (app_name, user_id, server_seq)`,
  `CREATE INDEX local_sync_d1_rows_table_seq_idx
    ON ${SYNC_ROWS_TABLE} (app_name, user_id, table_name, server_seq)`,
  `CREATE INDEX local_sync_d1_rows_scope_seq_idx
    ON ${SYNC_ROWS_TABLE} (
      app_name,
      user_id,
      table_name,
      scope_id,
      server_seq
    )`,
] as const;

export const APPLY_LWW_BATCH_SQL = `
  INSERT INTO ${SYNC_ROWS_TABLE} (
    app_name,
    user_id,
    table_name,
    record_id,
    scope_id,
    hlc_wall_time_ms,
    hlc_counter,
    device_id,
    schema_version,
    is_deleted,
    payload
  )
  SELECT
    ?,
    ?,
    json_extract(value, '$.tableName'),
    json_extract(value, '$.recordId'),
    json_extract(value, '$.scopeId'),
    json_extract(value, '$.hlc.wallTimeMs'),
    json_extract(value, '$.hlc.counter'),
    json_extract(value, '$.deviceId'),
    json_extract(value, '$.schemaVersion'),
    CASE json_extract(value, '$.operation')
      WHEN 'delete' THEN 1
      ELSE 0
    END,
    json_extract(value, '$.payload')
  FROM json_each(?)
  WHERE true
  ON CONFLICT (app_name, user_id, table_name, record_id) DO UPDATE SET
    server_seq = excluded.server_seq,
    scope_id = excluded.scope_id,
    hlc_wall_time_ms = excluded.hlc_wall_time_ms,
    hlc_counter = excluded.hlc_counter,
    device_id = excluded.device_id,
    schema_version = excluded.schema_version,
    is_deleted = excluded.is_deleted,
    payload = excluded.payload
  WHERE
    excluded.hlc_wall_time_ms > ${SYNC_ROWS_TABLE}.hlc_wall_time_ms
    OR (
      excluded.hlc_wall_time_ms = ${SYNC_ROWS_TABLE}.hlc_wall_time_ms
      AND excluded.hlc_counter > ${SYNC_ROWS_TABLE}.hlc_counter
    )
    OR (
      excluded.hlc_wall_time_ms = ${SYNC_ROWS_TABLE}.hlc_wall_time_ms
      AND excluded.hlc_counter = ${SYNC_ROWS_TABLE}.hlc_counter
      AND excluded.device_id > ${SYNC_ROWS_TABLE}.device_id
    )
  RETURNING *
`;

export const READ_BATCH_WINNERS_SQL = `
  WITH requested(table_name, record_id) AS (
    SELECT
      json_extract(value, '$.tableName'),
      json_extract(value, '$.recordId')
    FROM json_each(?)
  )
  SELECT stored.*
  FROM requested
  CROSS JOIN ${SYNC_ROWS_TABLE} AS stored
    INDEXED BY local_sync_d1_rows_logical_key_idx
  WHERE stored.app_name = ?
    AND stored.user_id = ?
    AND stored.table_name = requested.table_name
    AND stored.record_id = requested.record_id
`;

export interface StoredSyncRow {
  server_seq: number;
  app_name: string;
  user_id: string;
  table_name: string;
  record_id: string;
  scope_id: string | null;
  hlc_wall_time_ms: number;
  hlc_counter: number;
  device_id: string;
  schema_version: number;
  is_deleted: 0 | 1;
  payload: string;
}

export interface D1PushOutcome {
  readonly accepted: boolean;
  readonly winner: StoredSyncRow;
}

export interface D1SyncScan {
  readonly appName: string;
  readonly userId: string;
  readonly cursor: number;
  readonly tableName?: string;
  readonly scopeId?: string;
  readonly limit: number;
}

/**
 * Exercises the candidate D1 write path without exposing a production adapter.
 * The JSON parameter avoids D1's 100-bound-parameter limit. D1 executes the
 * UPSERT and winner lookup sequentially in one transactional batch.
 */
export async function applyLwwBatch<TPayload>(
  database: D1Database,
  namespace: SyncNamespace,
  records: readonly SyncRecord<TPayload>[],
): Promise<readonly D1PushOutcome[]> {
  if (records.length === 0) {
    return [];
  }

  const encodedRecords = JSON.stringify(records);
  const [acceptedResult, winnersResult] = await database.batch<StoredSyncRow>([
    prepareLwwUpsertBatch(database, namespace, encodedRecords),
    database
      .prepare(READ_BATCH_WINNERS_SQL)
      .bind(encodedRecords, namespace.appName, namespace.userId),
  ]);
  const acceptedKeys = new Set(
    acceptedResult!.results.map((row) => rowKey(row.table_name, row.record_id)),
  );
  const winnersByKey = new Map(
    winnersResult!.results.map((row) => [
      rowKey(row.table_name, row.record_id),
      row,
    ]),
  );

  return records.map((record) => {
    const key = rowKey(record.tableName, record.recordId);
    const winner = winnersByKey.get(key);
    if (winner === undefined) {
      throw new Error(
        `D1 did not return a winner for ${record.tableName}/${record.recordId}`,
      );
    }

    return {
      accepted: acceptedKeys.has(key),
      winner,
    };
  });
}

export function prepareLwwUpsertBatch(
  database: D1Database,
  namespace: SyncNamespace,
  encodedRecords: string,
): D1PreparedStatement {
  return database
    .prepare(APPLY_LWW_BATCH_SQL)
    .bind(namespace.appName, namespace.userId, encodedRecords);
}

export async function scanSyncRows(
  database: D1Database,
  scan: D1SyncScan,
): Promise<readonly StoredSyncRow[]> {
  const conditions = ["app_name = ?", "user_id = ?", "server_seq > ?"];
  const parameters: unknown[] = [scan.appName, scan.userId, scan.cursor];

  if (scan.tableName !== undefined) {
    conditions.push("table_name = ?");
    parameters.push(scan.tableName);
  }
  if (scan.scopeId !== undefined) {
    conditions.push("scope_id = ?");
    parameters.push(scan.scopeId);
  }
  parameters.push(scan.limit);

  const result = await database
    .prepare(
      `SELECT * FROM ${SYNC_ROWS_TABLE}
       WHERE ${conditions.join(" AND ")}
       ORDER BY server_seq
       LIMIT ?`,
    )
    .bind(...parameters)
    .all<StoredSyncRow>();

  return result.results;
}

export async function explainScan(
  database: D1Database,
  scan: D1SyncScan,
): Promise<readonly string[]> {
  const conditions = ["app_name = ?", "user_id = ?", "server_seq > ?"];
  const parameters: unknown[] = [scan.appName, scan.userId, scan.cursor];

  if (scan.tableName !== undefined) {
    conditions.push("table_name = ?");
    parameters.push(scan.tableName);
  }
  if (scan.scopeId !== undefined) {
    conditions.push("scope_id = ?");
    parameters.push(scan.scopeId);
  }
  parameters.push(scan.limit);

  const result = await database
    .prepare(
      `EXPLAIN QUERY PLAN SELECT * FROM ${SYNC_ROWS_TABLE}
       WHERE ${conditions.join(" AND ")}
       ORDER BY server_seq
       LIMIT ?`,
    )
    .bind(...parameters)
    .all<{ detail: string }>();

  return result.results.map((row) => row.detail);
}

function rowKey(tableName: string, recordId: string): string {
  return JSON.stringify([tableName, recordId]);
}

import {
  type SyncPullBody,
  type SyncPullResponse,
  type SyncPushChange,
  type SyncPushResponse,
  type SyncRecord,
} from "../protocol.js";
import { DEFAULT_SYNC_PULL_LIMIT } from "../protocol.js";

/** Minimal D1 interface; consumers do not need Reader's generated Worker types. */
export interface SyncD1Statement {
  bind(...values: unknown[]): SyncD1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface SyncD1Database {
  prepare(query: string): SyncD1Statement;
  batch<T>(statements: SyncD1Statement[]): Promise<{ results: T[] }[]>;
}

/** Apply through the host's migration system. User foreign keys remain host-owned. */
export const SYNC_D1_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sync_records (
  server_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  schema_version INTEGER NOT NULL, hlc_wall_time_ms INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL, device_id TEXT NOT NULL, is_deleted INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_records_user_key_unique ON sync_records (user_id, key);
CREATE INDEX IF NOT EXISTS sync_records_user_seq_idx ON sync_records (user_id, server_seq);
`;

/**
 * One JSON bind avoids D1's parameter limit. A winning conflict copies the
 * attempted insert's fresh AUTOINCREMENT value into the compacted row.
 */
const APPLY_SYNC_V2_BATCH_SQL = `
  INSERT INTO sync_records (
    user_id,
    key,
    value,
    schema_version,
    hlc_wall_time_ms,
    hlc_counter,
    device_id,
    is_deleted
  )
  SELECT
    ?,
    json_extract(candidate.value, '$.key'),
    json_extract(candidate.value, '$.value'),
    json_extract(candidate.value, '$.schemaVersion'),
    json_extract(candidate.value, '$.hlc.wallTimeMs'),
    json_extract(candidate.value, '$.hlc.counter'),
    ?,
    json_extract(candidate.value, '$.isDeleted')
  FROM json_each(?) AS candidate
  WHERE true
  ON CONFLICT (user_id, key) DO UPDATE SET
    server_seq = excluded.server_seq,
    value = excluded.value,
    schema_version = excluded.schema_version,
    hlc_wall_time_ms = excluded.hlc_wall_time_ms,
    hlc_counter = excluded.hlc_counter,
    device_id = excluded.device_id,
    is_deleted = excluded.is_deleted
  WHERE
    excluded.hlc_wall_time_ms > sync_records.hlc_wall_time_ms
    OR (
      excluded.hlc_wall_time_ms = sync_records.hlc_wall_time_ms
      AND excluded.hlc_counter > sync_records.hlc_counter
    )
    OR (
      excluded.hlc_wall_time_ms = sync_records.hlc_wall_time_ms
      AND excluded.hlc_counter = sync_records.hlc_counter
      AND excluded.device_id > sync_records.device_id
    )
  RETURNING *
`;

const READ_SYNC_V2_BATCH_WINNERS_SQL = `
  WITH requested(key) AS (
    SELECT json_extract(candidate.value, '$.key')
    FROM json_each(?) AS candidate
  )
  SELECT stored.*
  FROM requested
  CROSS JOIN sync_records AS stored
    INDEXED BY sync_records_user_key_unique
  WHERE stored.user_id = ?
    AND stored.key = requested.key
`;

const READ_SYNC_V2_HEAD_SQL = `
  SELECT COALESCE(MAX(server_seq), 0) AS head
  FROM sync_records
  WHERE user_id = ?
`;

const PULL_SYNC_V2_PAGE_SQL = `
  SELECT *
  FROM sync_records INDEXED BY sync_records_user_seq_idx
  WHERE user_id = ?
    AND server_seq > ?
    AND server_seq <= ?
    AND (? = 0 OR device_id <> ?)
  ORDER BY server_seq
  LIMIT ?
`;

interface StoredSyncV2Record {
  readonly server_seq: number;
  readonly user_id: string;
  readonly key: string;
  readonly value: string;
  readonly schema_version: number;
  readonly hlc_wall_time_ms: number;
  readonly hlc_counter: number;
  readonly device_id: string;
  readonly is_deleted: number;
}

export async function pushSyncV2(
  database: SyncD1Database,
  userId: string,
  deviceId: string,
  changes: readonly SyncPushChange[],
): Promise<SyncPushResponse> {
  if (changes.length === 0) {
    return { results: [] };
  }

  const encodedChanges = JSON.stringify(changes);
  const [acceptedResult, winnersResult] =
    await database.batch<StoredSyncV2Record>([
      database
        .prepare(APPLY_SYNC_V2_BATCH_SQL)
        .bind(userId, deviceId, encodedChanges),
      database
        .prepare(READ_SYNC_V2_BATCH_WINNERS_SQL)
        .bind(encodedChanges, userId),
    ]);

  if (acceptedResult === undefined || winnersResult === undefined) {
    throw new Error("D1 returned an incomplete sync push result");
  }

  const acceptedKeys = new Set(
    acceptedResult.results.map((record) => record.key),
  );
  const winnersByKey = new Map(
    winnersResult.results.map((record) => [
      record.key,
      decodeStoredSyncV2Record(record),
    ]),
  );

  return {
    results: changes.map((change) => {
      const winner = winnersByKey.get(change.key);
      if (winner === undefined) {
        throw new Error(
          `D1 did not return a winner for sync key ${change.key}`,
        );
      }

      return {
        accepted: acceptedKeys.has(change.key),
        winner,
      };
    }),
  };
}

export async function readSyncV2Head(
  database: SyncD1Database,
  userId: string,
): Promise<number> {
  const result = await database
    .prepare(READ_SYNC_V2_HEAD_SQL)
    .bind(userId)
    .first<{ head: number }>();
  return result?.head ?? 0;
}

export async function pullSyncV2(
  database: SyncD1Database,
  userId: string,
  deviceId: string,
  body: SyncPullBody,
  head: number,
): Promise<SyncPullResponse> {
  const limit = body.limit ?? DEFAULT_SYNC_PULL_LIMIT;
  const result = await database
    .prepare(PULL_SYNC_V2_PAGE_SQL)
    .bind(
      userId,
      body.cursor,
      head,
      body.excludeOwnDevice ? 1 : 0,
      deviceId,
      limit + 1,
    )
    .all<StoredSyncV2Record>();
  const hasMore = result.results.length > limit;
  const records = result.results.slice(0, limit).map(decodeStoredSyncV2Record);
  const lastRecord = records.at(-1);

  return {
    records,
    cursor: hasMore ? lastRecord!.serverSeq : head,
    head,
    hasMore,
  };
}

function decodeStoredSyncV2Record(record: StoredSyncV2Record): SyncRecord {
  return {
    key: record.key,
    value: record.value,
    isDeleted: record.is_deleted !== 0,
    schemaVersion: record.schema_version,
    hlc: {
      wallTimeMs: record.hlc_wall_time_ms,
      counter: record.hlc_counter,
    },
    deviceId: record.device_id,
    serverSeq: record.server_seq,
  };
}

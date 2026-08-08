import type { SyncPayload, SyncRecord } from "../../core/index.js";
import type {
  ServerStoragePushOutcome,
  ServerSyncRow,
  ServerSyncScan,
  ServerSyncStorage,
  SyncNamespace,
} from "../../server/index.js";
import {
  D1_APPLY_LWW_BATCH_SQL,
  D1_READ_BATCH_WINNERS_SQL,
  D1_SCAN_APP_SQL,
  D1_SCAN_SCOPE_SQL,
  D1_SCAN_TABLE_SQL,
} from "./sql.js";

export const DEFAULT_D1_MAX_ENCODED_BATCH_BYTES = 1024 * 1024;

/** The D1 result surface used by the adapter. */
export interface D1ResultLike<TRow> {
  readonly results: readonly TRow[];
}

/** The prepared-statement surface used by the adapter. */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<TRow = Record<string, unknown>>(): Promise<D1ResultLike<TRow>>;
}

/**
 * Structural subset of Cloudflare's D1 binding.
 *
 * Keeping this local avoids imposing Cloudflare runtime types on other package
 * entrypoints while allowing a generated `D1Database` binding to pass directly.
 */
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<TRow = Record<string, unknown>>(
    statements: D1PreparedStatementLike[],
  ): Promise<readonly D1ResultLike<TRow>[]>;
}

export interface D1ServerSyncStorageOptions {
  readonly maxEncodedBatchBytes?: number;
}

/** A push cannot fit within the configured D1 JSON parameter budget. */
export class D1SyncBatchTooLargeError extends Error {
  override readonly name = "D1SyncBatchTooLargeError";

  constructor(
    readonly encodedBytes: number,
    readonly maxEncodedBytes: number,
  ) {
    super(
      `Encoded D1 sync batch is ${encodedBytes} bytes; maximum is ${maxEncodedBytes}`,
    );
  }
}

/** Production latest-state storage backed by one Cloudflare D1 table. */
export class D1ServerSyncStorage<
  TPayload = SyncPayload,
> implements ServerSyncStorage<TPayload> {
  private readonly maxEncodedBatchBytes: number;

  constructor(
    private readonly database: D1DatabaseLike,
    options: D1ServerSyncStorageOptions = {},
  ) {
    this.maxEncodedBatchBytes =
      options.maxEncodedBatchBytes ?? DEFAULT_D1_MAX_ENCODED_BATCH_BYTES;

    if (
      !Number.isSafeInteger(this.maxEncodedBatchBytes) ||
      this.maxEncodedBatchBytes <= 0
    ) {
      throw new Error("maxEncodedBatchBytes must be a positive safe integer");
    }
  }

  async applyLww(
    namespace: SyncNamespace,
    records: readonly SyncRecord<TPayload>[],
  ): Promise<readonly ServerStoragePushOutcome<TPayload>[]> {
    if (records.length === 0) {
      return [];
    }

    const encodedRecords = JSON.stringify(records);
    const encodedBytes = new TextEncoder().encode(encodedRecords).byteLength;
    if (encodedBytes > this.maxEncodedBatchBytes) {
      throw new D1SyncBatchTooLargeError(
        encodedBytes,
        this.maxEncodedBatchBytes,
      );
    }

    const [acceptedResult, winnersResult] =
      await this.database.batch<StoredD1SyncRow>([
        this.database
          .prepare(D1_APPLY_LWW_BATCH_SQL)
          .bind(namespace.appName, namespace.userId, encodedRecords),
        this.database
          .prepare(D1_READ_BATCH_WINNERS_SQL)
          .bind(encodedRecords, namespace.appName, namespace.userId),
      ]);

    if (acceptedResult === undefined || winnersResult === undefined) {
      throw new Error("D1 returned an incomplete sync batch result");
    }

    const acceptedKeys = new Set(
      acceptedResult.results.map((row) =>
        recordKey(row.table_name, row.record_id),
      ),
    );
    const winners = new Map(
      winnersResult.results.map((row) => [
        recordKey(row.table_name, row.record_id),
        decodeRow<TPayload>(row),
      ]),
    );

    return records.map((record) => {
      const key = recordKey(record.tableName, record.recordId);
      const winner = winners.get(key);
      if (winner === undefined) {
        throw new Error(
          `D1 did not return a winner for ${record.tableName}/${record.recordId}`,
        );
      }

      return { accepted: acceptedKeys.has(key), winner };
    });
  }

  async scan(
    query: ServerSyncScan,
  ): Promise<readonly ServerSyncRow<TPayload>[]> {
    const statement = createScanStatement(this.database, query);
    const result = await statement.all<StoredD1SyncRow>();
    return result.results.map(decodeRow<TPayload>);
  }
}

interface StoredD1SyncRow {
  readonly server_seq: number;
  readonly app_name: string;
  readonly user_id: string;
  readonly table_name: string;
  readonly record_id: string;
  readonly scope_id: string | null;
  readonly hlc_wall_time_ms: number;
  readonly hlc_counter: number;
  readonly device_id: string;
  readonly schema_version: number;
  readonly is_deleted: 0 | 1;
  readonly payload: string;
}

function createScanStatement(
  database: D1DatabaseLike,
  query: ServerSyncScan,
): D1PreparedStatementLike {
  if (query.scopeId !== undefined) {
    return database
      .prepare(D1_SCAN_SCOPE_SQL)
      .bind(
        query.appName,
        query.userId,
        query.tableName,
        query.scopeId,
        query.cursor,
        query.limit,
      );
  }

  if (query.tableName !== undefined) {
    return database
      .prepare(D1_SCAN_TABLE_SQL)
      .bind(
        query.appName,
        query.userId,
        query.tableName,
        query.cursor,
        query.limit,
      );
  }

  return database
    .prepare(D1_SCAN_APP_SQL)
    .bind(query.appName, query.userId, query.cursor, query.limit);
}

function decodeRow<TPayload>(row: StoredD1SyncRow): ServerSyncRow<TPayload> {
  const base = {
    appName: row.app_name,
    userId: row.user_id,
    tableName: row.table_name,
    recordId: row.record_id,
    ...(row.scope_id === null ? {} : { scopeId: row.scope_id }),
    hlc: {
      wallTimeMs: row.hlc_wall_time_ms,
      counter: row.hlc_counter,
    },
    deviceId: row.device_id,
    schemaVersion: row.schema_version,
    serverSeq: row.server_seq,
    payload: JSON.parse(row.payload) as TPayload,
  };

  if (row.is_deleted === 1) {
    return { ...base, operation: "delete" };
  }

  return { ...base, operation: "put" };
}

function recordKey(tableName: string, recordId: string): string {
  return JSON.stringify([tableName, recordId]);
}

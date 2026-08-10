import {
  type SequencedSyncRecord,
  type SyncBatch,
  type SyncCursor,
  type SyncPayload,
  type SyncRecord,
} from "../core/index.js";

export const DEFAULT_SERVER_PULL_LIMIT = 500;
export const MAX_SERVER_PULL_LIMIT = 5_000;
export const MAX_SERVER_PUSH_BATCH_SIZE = 500;
export const DEFAULT_MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface SyncNamespace {
  readonly appName: string;
  readonly userId: string;
}

/** The complete latest-state row stored in the generic server sync table. */
export type ServerSyncRow<TPayload = SyncPayload> =
  SequencedSyncRecord<TPayload> & SyncNamespace;

export interface ServerPushRequest<
  TPayload = SyncPayload,
> extends SyncNamespace {
  /** Trusted device identity supplied by the authenticated transport. */
  readonly deviceId: string;
  readonly records: readonly SyncRecord<TPayload>[];
}

export interface ServerPushOutcome<TPayload = SyncPayload> {
  /** True only when this candidate created a new server stream position. */
  readonly accepted: boolean;
  /** The current server winner, including its existing or newly assigned cursor. */
  readonly record: SequencedSyncRecord<TPayload>;
}

export interface ServerPushResult<TPayload = SyncPayload> {
  readonly outcomes: readonly ServerPushOutcome<TPayload>[];
}

export interface ServerPullRequest extends SyncNamespace {
  readonly cursor: SyncCursor;
  readonly tableName?: string;
  readonly scopeId?: string;
  readonly limit?: number;
}

export interface ServerSyncScan extends SyncNamespace {
  readonly cursor: SyncCursor;
  readonly tableName?: string;
  readonly scopeId?: string;
  /** Maximum rows to return, already including the service's lookahead row. */
  readonly limit: number;
}

export interface ServerStoragePushOutcome<TPayload = SyncPayload> {
  readonly accepted: boolean;
  readonly winner: ServerSyncRow<TPayload>;
}

/**
 * Storage semantics required by the framework-neutral server coordinator.
 *
 * `applyLww` must atomically compare and replace each logical row while
 * assigning a fresh, globally monotonic sequence to accepted candidates.
 * Sequence gaps and partial batches after an adapter error are allowed because
 * clients retry idempotently and receive the current winner for every result.
 * Outcomes must correspond to the candidate records in input order.
 */
export interface ServerSyncStorage<TPayload = SyncPayload> {
  applyLww(
    namespace: SyncNamespace,
    records: readonly SyncRecord<TPayload>[],
  ): Promise<readonly ServerStoragePushOutcome<TPayload>[]>;

  /** Returns rows in ascending server-sequence order. */
  scan(query: ServerSyncScan): Promise<readonly ServerSyncRow<TPayload>[]>;
}

export interface SyncServerOptions {
  readonly now?: () => number;
  readonly maxFutureClockSkewMs?: number;
  readonly maxPushBatchSize?: number;
  readonly defaultPullLimit?: number;
  readonly maxPullLimit?: number;
}

/** Framework-neutral push/pull behavior for a latest-state bag of sync rows. */
export class SyncServer<TPayload = SyncPayload> {
  private readonly now: () => number;
  private readonly maxFutureClockSkewMs: number;
  private readonly maxPushBatchSize: number;
  private readonly defaultPullLimit: number;
  private readonly maxPullLimit: number;

  constructor(
    private readonly storage: ServerSyncStorage<TPayload>,
    options: SyncServerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.maxFutureClockSkewMs =
      options.maxFutureClockSkewMs ?? DEFAULT_MAX_FUTURE_CLOCK_SKEW_MS;
    this.maxPushBatchSize =
      options.maxPushBatchSize ?? MAX_SERVER_PUSH_BATCH_SIZE;
    this.defaultPullLimit =
      options.defaultPullLimit ?? DEFAULT_SERVER_PULL_LIMIT;
    this.maxPullLimit = options.maxPullLimit ?? MAX_SERVER_PULL_LIMIT;

    assertNonNegativeInteger(this.maxFutureClockSkewMs, "maxFutureClockSkewMs");
    assertPositiveInteger(this.maxPushBatchSize, "maxPushBatchSize");
    assertPositiveInteger(this.defaultPullLimit, "defaultPullLimit");
    assertPositiveInteger(this.maxPullLimit, "maxPullLimit");
    if (this.defaultPullLimit > this.maxPullLimit) {
      throw new SyncServerValidationError(
        "defaultPullLimit must not exceed maxPullLimit",
      );
    }
  }

  async push(
    request: ServerPushRequest<TPayload>,
  ): Promise<ServerPushResult<TPayload>> {
    if (request.records.length > this.maxPushBatchSize) {
      throw new SyncServerValidationError(
        `Push batch exceeds maximum size of ${this.maxPushBatchSize}`,
      );
    }

    const latestAllowedWallTime = this.now() + this.maxFutureClockSkewMs;
    const recordKeys = new Set<string>();

    for (const record of request.records) {
      validateRecord(record, request.deviceId, latestAllowedWallTime);

      const key = JSON.stringify([record.tableName, record.recordId]);
      if (recordKeys.has(key)) {
        throw new SyncServerValidationError(
          `Push batch contains duplicate record: ${record.tableName}/${record.recordId}`,
        );
      }
      recordKeys.add(key);
    }

    const namespace = {
      appName: request.appName,
      userId: request.userId,
    } satisfies SyncNamespace;
    const outcomes = await this.storage.applyLww(namespace, request.records);

    if (outcomes.length !== request.records.length) {
      throw new Error("Server sync storage returned an incomplete push result");
    }

    return {
      outcomes: outcomes.map(({ accepted, winner }) => ({
        accepted,
        record: stripNamespace(winner),
      })),
    };
  }

  async pull(request: ServerPullRequest): Promise<SyncBatch<TPayload>> {
    if (request.scopeId !== undefined && request.tableName === undefined) {
      throw new SyncServerValidationError(
        "scopeId requires a tableName filter",
      );
    }

    const limit = request.limit ?? this.defaultPullLimit;
    if (limit > this.maxPullLimit) {
      throw new SyncServerValidationError(
        `Pull limit exceeds maximum size of ${this.maxPullLimit}`,
      );
    }

    const query: ServerSyncScan = {
      appName: request.appName,
      userId: request.userId,
      cursor: request.cursor,
      limit: limit + 1,
      ...(request.tableName === undefined
        ? {}
        : { tableName: request.tableName }),
      ...(request.scopeId === undefined ? {} : { scopeId: request.scopeId }),
    };
    const scanned = await this.storage.scan(query);
    const hasMore = scanned.length > limit;
    const page = scanned.slice(0, limit);
    const lastRecord = page.at(-1);

    return {
      records: page.map(stripNamespace),
      cursor: lastRecord?.serverSeq ?? request.cursor,
      hasMore,
    };
  }
}

export class SyncServerValidationError extends Error {
  override readonly name = "SyncServerValidationError";
}

function validateRecord<TPayload>(
  record: SyncRecord<TPayload>,
  authenticatedDeviceId: string,
  latestAllowedWallTime: number,
): void {
  if (record.deviceId !== authenticatedDeviceId) {
    throw new SyncServerValidationError(
      `Record deviceId does not match authenticated device: ${record.tableName}/${record.recordId}`,
    );
  }
  if (record.hlc.wallTimeMs > latestAllowedWallTime) {
    throw new SyncServerValidationError(
      `Record HLC exceeds the allowed future clock skew: ${record.tableName}/${record.recordId}`,
    );
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SyncServerValidationError(`${field} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SyncServerValidationError(
      `${field} must be a non-negative integer`,
    );
  }
}

function stripNamespace<TPayload>(
  row: ServerSyncRow<TPayload>,
): SequencedSyncRecord<TPayload> {
  const base = {
    tableName: row.tableName,
    recordId: row.recordId,
    ...(row.scopeId === undefined ? {} : { scopeId: row.scopeId }),
    hlc: row.hlc,
    deviceId: row.deviceId,
    schemaVersion: row.schemaVersion,
    serverSeq: row.serverSeq,
  };

  if (row.operation === "put") {
    return { ...base, operation: "put", payload: row.payload };
  }

  return { ...base, operation: "delete", payload: row.payload };
}

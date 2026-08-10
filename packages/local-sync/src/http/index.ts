import { z } from "zod";
import type {
  SequencedSyncRecord,
  SyncBatch,
  SyncCursor,
  SyncPayload,
  SyncRecord,
} from "../core/index.js";
import {
  MAX_SERVER_PULL_LIMIT,
  MAX_SERVER_PUSH_BATCH_SIZE,
  type ServerPushResult,
} from "../server/index.js";

/** Untrusted push JSON before trusted namespace and device context is attached. */
export interface SyncPushBody {
  readonly records: readonly SyncRecord<SyncPayload>[];
}

/** Parsed HTTP query values before trusted namespace context is attached. */
export interface SyncPullQuery {
  readonly cursor: SyncCursor;
  readonly tableName?: string;
  readonly scopeId?: string;
  readonly limit?: number;
}

export type SyncPushResponse = ServerPushResult<SyncPayload>;
export type SyncPullResponse = SyncBatch<SyncPayload>;

const nonEmptyText = z.string().min(1);
const nonNegativeInteger = z.int().nonnegative();
const positiveInteger = z.int().positive();
const deviceId = nonEmptyText.regex(/^[A-Za-z0-9_-]+$/);
const payload = z.record(z.string(), z.json());

const recordShape = {
  tableName: nonEmptyText,
  recordId: nonEmptyText,
  scopeId: nonEmptyText.optional(),
  hlc: z.strictObject({
    wallTimeMs: nonNegativeInteger,
    counter: nonNegativeInteger,
  }),
  deviceId,
  schemaVersion: positiveInteger,
  payload,
};

const rawSyncRecord = z.discriminatedUnion("operation", [
  z.strictObject({ ...recordShape, operation: z.literal("put") }),
  z.strictObject({ ...recordShape, operation: z.literal("delete") }),
]);

const rawSequencedSyncRecord = z.discriminatedUnion("operation", [
  z.strictObject({
    ...recordShape,
    operation: z.literal("put"),
    serverSeq: positiveInteger,
  }),
  z.strictObject({
    ...recordShape,
    operation: z.literal("delete"),
    serverSeq: positiveInteger,
  }),
]);

const syncRecord = rawSyncRecord.transform(
  (record): SyncRecord<SyncPayload> => normalizeRecord(record),
);
const sequencedSyncRecord = rawSequencedSyncRecord.transform(
  (record): SequencedSyncRecord<SyncPayload> => ({
    ...normalizeRecord(record),
    serverSeq: record.serverSeq,
  }),
);

const syncPushBody = z.strictObject({
  records: z.array(syncRecord).max(MAX_SERVER_PUSH_BATCH_SIZE),
});

const syncPullQuery = z
  .strictObject({
    cursor: decimalInteger("cursor").pipe(nonNegativeInteger),
    tableName: nonEmptyText.optional(),
    scopeId: nonEmptyText.optional(),
    limit: decimalInteger("limit")
      .pipe(positiveInteger.max(MAX_SERVER_PULL_LIMIT))
      .optional(),
  })
  .transform(
    (query): SyncPullQuery => ({
      cursor: query.cursor,
      ...(query.tableName === undefined ? {} : { tableName: query.tableName }),
      ...(query.scopeId === undefined ? {} : { scopeId: query.scopeId }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    }),
  );

const syncPushResponse = z.strictObject({
  outcomes: z
    .array(
      z.strictObject({
        accepted: z.boolean(),
        record: sequencedSyncRecord,
      }),
    )
    .max(MAX_SERVER_PUSH_BATCH_SIZE),
});

const syncPullResponse = z.strictObject({
  records: z.array(sequencedSyncRecord).max(MAX_SERVER_PULL_LIMIT),
  cursor: nonNegativeInteger,
  hasMore: z.boolean(),
});

export function parseSyncPushBody(input: unknown): SyncPushBody {
  return syncPushBody.parse(input);
}

export function parseSyncPullQuery(input: unknown): SyncPullQuery {
  return syncPullQuery.parse(input);
}

export function parseSyncPushResponse(input: unknown): SyncPushResponse {
  return syncPushResponse.parse(input);
}

export function parseSyncPullResponse(input: unknown): SyncPullResponse {
  return syncPullResponse.parse(input);
}

type RawSyncRecord = z.infer<typeof rawSyncRecord>;

function normalizeRecord(record: RawSyncRecord): SyncRecord<SyncPayload> {
  const base = {
    tableName: record.tableName,
    recordId: record.recordId,
    ...(record.scopeId === undefined ? {} : { scopeId: record.scopeId }),
    hlc: record.hlc,
    deviceId: record.deviceId,
    schemaVersion: record.schemaVersion,
    payload: record.payload,
  };

  return record.operation === "put"
    ? { ...base, operation: "put" }
    : { ...base, operation: "delete" };
}

function decimalInteger(field: string) {
  return z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/, `${field} must be an unsigned decimal`)
    .transform(Number);
}

import { getLabRuntime, getRuntimeStorage } from "@/features/sync-lab/runtime";
/** Pull, conflict resolution, push, and reconciliation for sync v2. */

import { honoClient } from "@/lib/api";
import {
  observeSyncHlcBatch,
  readSyncClientState,
  writeSyncClientState,
  type SyncClientStateStorage,
} from "@/lib/sync-v2/client-state";
import {
  SYNC_V2_SYNCED_TABLES,
  type EPUBReaderSyncV2DB,
} from "@/lib/sync-v2/db";
import {
  DEFAULT_SYNC_PULL_LIMIT,
  MAX_SYNC_PUSH_CHANGES,
  MAX_SYNC_PUSH_BODY_BYTES,
  syncPushChangeSchema,
  SYNC_DEVICE_ID_HEADER,
  compareSyncVersions,
  decodeSyncKey,
  decodeSyncValue,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type SyncPullBody,
  type SyncPullResponse,
  type SyncPushChange,
  type SyncPushResponse,
  type SyncRecord,
} from "@/lib/sync-v2/protocol";
import { normalizeBookFileReferences } from "@/lib/book-file-references";
import type { Table } from "dexie";

const INITIAL_SCHEMA_VERSION = 1;

export interface SyncV2Remote {
  pull(deviceId: string, request: SyncPullBody): Promise<SyncPullResponse>;
  push(
    deviceId: string,
    changes: readonly SyncPushChange[],
  ): Promise<SyncPushResponse>;
}

export interface SyncV2RunResult {
  pulled: number;
  skipped: number;
  pushed: number;
}

/** Optional diagnostic events, emitted after storage changes commit. */
export interface SyncV2Event {
  phase: "pull" | "push";
  outcome:
    | "applied"
    | "kept-local"
    | "acknowledged"
    | "replaced"
    | "edited-in-flight";
  key: string;
}

export interface SyncV2ClientOptions {
  /** Raw connection without local-mutation interception. */
  syncDb: EPUBReaderSyncV2DB;
  remote?: SyncV2Remote;
  stateStorage?: SyncClientStateStorage;
  syncedTables?: readonly string[];
  onEvent?: (event: SyncV2Event) => void;
}

interface PreparedRemoteRecord {
  source: SyncRecord;
  tableName: string;
  row: Record<string, unknown>;
}

/**
 * Runs the v2 protocol. Full sync calls share one pull-then-push operation so
 * lifecycle triggers cannot start duplicate work.
 */
export class SyncV2Client {
  private readonly syncDb: EPUBReaderSyncV2DB;
  private readonly remote: SyncV2Remote;
  private readonly stateStorage: SyncClientStateStorage;
  private readonly syncedTables: ReadonlySet<string>;
  private activeSync: Promise<SyncV2RunResult> | null = null;
  private readonly onEvent: (event: SyncV2Event) => void;

  constructor(options: SyncV2ClientOptions) {
    this.syncDb = options.syncDb;
    this.remote =
      options.remote ?? getLabRuntime()?.syncRemote ?? new HonoSyncV2Remote();
    this.stateStorage = options.stateStorage ?? getRuntimeStorage();
    this.syncedTables = new Set(options.syncedTables ?? SYNC_V2_SYNCED_TABLES);
    this.onEvent = options.onEvent ?? (() => {});
  }

  sync(): Promise<SyncV2RunResult> {
    if (this.activeSync !== null) {
      return this.activeSync;
    }

    const run = this.runSync().finally(() => {
      if (this.activeSync === run) {
        this.activeSync = null;
      }
    });
    this.activeSync = run;
    return run;
  }

  async pull(): Promise<Pick<SyncV2RunResult, "pulled" | "skipped">> {
    let pulled = 0;
    let skipped = 0;
    let head: number | undefined;

    while (true) {
      const state = this.requireState();
      const request: SyncPullBody = {
        cursor: state.pullCursor,
        ...(head === undefined ? {} : { head }),
        limit: DEFAULT_SYNC_PULL_LIMIT,
        excludeOwnDevice: state.bootstrapped,
      };
      const response = await this.remote.pull(state.deviceId, request);
      const validResponse = syncPullResponseSchema.parse(response);
      validatePullResponse(request, validResponse, head);
      const preparedRecords = prepareRemoteRecords(
        validResponse.records,
        this.syncedTables,
      );

      observeSyncHlcBatch(
        validResponse.records.map((record) => record.hlc),
        this.stateStorage,
      );
      const result = await applyPreparedRemoteRecords(
        this.syncDb,
        preparedRecords,
        state.deviceId,
        this.onEvent,
      );
      pulled += result.applied;
      skipped += result.skipped;

      const currentState = this.requireState();
      writeSyncClientState(
        {
          ...currentState,
          pullCursor: validResponse.cursor,
          bootstrapped: currentState.bootstrapped || !validResponse.hasMore,
        },
        this.stateStorage,
      );

      if (!validResponse.hasMore) {
        return { pulled, skipped };
      }
      head = validResponse.head;
    }
  }

  async push(): Promise<number> {
    const state = this.requireState();
    const pendingSnapshot = await this.syncDb._sync_outbox.toArray();
    let pushed = 0;

    for (const changes of createPushBatches(pendingSnapshot)) {
      const response = syncPushResponseSchema.parse(
        await this.remote.push(state.deviceId, changes),
      );
      validatePushResponse(changes, response);
      const preparedWinners = prepareRemoteRecords(
        response.results.map((result) => result.winner),
        this.syncedTables,
      );
      observeSyncHlcBatch(
        response.results.map((result) => result.winner.hlc),
        this.stateStorage,
      );
      pushed += await reconcilePushResults(
        this.syncDb,
        changes,
        preparedWinners,
        this.onEvent,
      );
    }

    return pushed;
  }

  private async runSync(): Promise<SyncV2RunResult> {
    const pullResult = await this.pull();
    const pushed = await this.push();
    return { ...pullResult, pushed };
  }

  private requireState() {
    const state = readSyncClientState(this.stateStorage);
    if (state === null) {
      throw new Error("Sync client state is not initialized");
    }
    return state;
  }
}

/** Count the actual JSON envelope, escaped values, commas, and UTF-8 bytes. */
function* createPushBatches(changes: readonly SyncPushChange[]) {
  const encoder = new TextEncoder();
  const envelopeBytes = encoder.encode(
    JSON.stringify({ changes: [] }),
  ).byteLength;
  let batch: SyncPushChange[] = [];
  let bodyBytes = envelopeBytes;
  for (const change of changes) {
    const validation = syncPushChangeSchema.safeParse(change);
    if (!validation.success) {
      throw new Error(
        `Cannot synchronize record ${change.key}: ${validation.error.message}`,
      );
    }
    const changeBytes = encoder.encode(JSON.stringify(change)).byteLength;
    if (envelopeBytes + changeBytes > MAX_SYNC_PUSH_BODY_BYTES) {
      throw new Error(
        `Cannot synchronize record ${change.key}: encoded mutation exceeds the push body limit`,
      );
    }
    const commaBytes = batch.length === 0 ? 0 : 1;
    if (
      batch.length === MAX_SYNC_PUSH_CHANGES ||
      bodyBytes + commaBytes + changeBytes > MAX_SYNC_PUSH_BODY_BYTES
    ) {
      yield batch;
      batch = [];
      bodyBytes = envelopeBytes;
    }
    bodyBytes += (batch.length === 0 ? 0 : 1) + changeBytes;
    batch.push(change);
  }
  if (batch.length > 0) yield batch;
}

export class SyncRemoteRequestError extends Error {
  readonly status: number;
  constructor(operation: string, status: number) {
    super(`Sync ${operation} failed with status ${status}`);
    this.name = "SyncRemoteRequestError";
    this.status = status;
  }
}

export class HonoSyncV2Remote implements SyncV2Remote {
  async pull(
    deviceId: string,
    request: SyncPullBody,
  ): Promise<SyncPullResponse> {
    const response = await honoClient.api.sync.v2.pull.$get(
      {
        query: {
          cursor: String(request.cursor),
          excludeOwnDevice: request.excludeOwnDevice ? "true" : "false",
          ...(request.head === undefined ? {} : { head: String(request.head) }),
          ...(request.limit === undefined
            ? {}
            : { limit: String(request.limit) }),
        },
      },
      { headers: { [SYNC_DEVICE_ID_HEADER]: deviceId } },
    );
    if (!response.ok) {
      throw new SyncRemoteRequestError("pull", response.status);
    }
    return syncPullResponseSchema.parse(await response.json());
  }

  async push(
    deviceId: string,
    changes: readonly SyncPushChange[],
  ): Promise<SyncPushResponse> {
    const response = await honoClient.api.sync.v2.push.$post(
      { json: { changes: [...changes] } },
      { headers: { [SYNC_DEVICE_ID_HEADER]: deviceId } },
    );
    if (!response.ok) {
      throw new SyncRemoteRequestError("push", response.status);
    }
    return syncPushResponseSchema.parse(await response.json());
  }
}

/** Compare pending local versions and apply eligible remote rows atomically. */
async function applyPreparedRemoteRecords(
  db: EPUBReaderSyncV2DB,
  prepared: readonly PreparedRemoteRecord[],
  localDeviceId: string,
  onEvent: (event: SyncV2Event) => void,
): Promise<{ applied: number; skipped: number }> {
  if (prepared.length === 0) {
    return { applied: 0, skipped: 0 };
  }

  const tables = getDomainTables(db, prepared);
  let applied = 0;
  let skipped = 0;
  const events: SyncV2Event[] = [];

  await db.transaction("rw", [db._sync_outbox, ...tables], async () => {
    const localChanges = await db._sync_outbox.bulkGet(
      prepared.map((record) => record.source.key),
    );
    const rowsByTable = new Map<string, Record<string, unknown>[]>();

    prepared.forEach((record, index) => {
      const localChange = localChanges[index];
      if (
        localChange !== undefined &&
        compareSyncVersions(
          { hlc: localChange.hlc, deviceId: localDeviceId },
          record.source,
        ) > 0
      ) {
        skipped += 1;
        events.push({
          phase: "pull",
          outcome: "kept-local",
          key: record.source.key,
        });
        return;
      }

      const rows = rowsByTable.get(record.tableName) ?? [];
      rows.push(record.row);
      rowsByTable.set(record.tableName, rows);
      applied += 1;
      events.push({
        phase: "pull",
        outcome: "applied",
        key: record.source.key,
      });
    });

    await putRemoteRows(db, rowsByTable);
  });

  events.forEach(onEvent);
  return { applied, skipped };
}

/**
 * Reconcile only the exact outbox snapshot sent over the network. A local edit
 * made while the request is in flight has a new HLC and remains untouched.
 */
async function reconcilePushResults(
  db: EPUBReaderSyncV2DB,
  sentChanges: readonly SyncPushChange[],
  preparedWinners: readonly PreparedRemoteRecord[],
  onEvent: (event: SyncV2Event) => void,
): Promise<number> {
  const tables = getDomainTables(db, preparedWinners);
  let reconciled = 0;
  const events: SyncV2Event[] = [];

  await db.transaction("rw", [db._sync_outbox, ...tables], async () => {
    const currentChanges = await db._sync_outbox.bulkGet(
      sentChanges.map((change) => change.key),
    );
    const resolvedKeys: string[] = [];
    const rowsByTable = new Map<string, Record<string, unknown>[]>();

    sentChanges.forEach((sentChange, index) => {
      const currentChange = currentChanges[index];
      if (
        currentChange === undefined ||
        !sameSyncChange(currentChange, sentChange)
      ) {
        events.push({
          phase: "push",
          outcome: "edited-in-flight",
          key: sentChange.key,
        });
        return;
      }

      const winner = preparedWinners[index]!;
      events.push({
        phase: "push",
        outcome: winnerMatchesChange(winner.source, sentChange)
          ? "acknowledged"
          : "replaced",
        key: sentChange.key,
      });
      if (!winnerMatchesChange(winner.source, sentChange)) {
        const rows = rowsByTable.get(winner.tableName) ?? [];
        rows.push(winner.row);
        rowsByTable.set(winner.tableName, rows);
      }
      resolvedKeys.push(sentChange.key);
      reconciled += 1;
    });

    await putRemoteRows(db, rowsByTable);
    await db._sync_outbox.bulkDelete(resolvedKeys);
  });

  events.forEach(onEvent);
  return reconciled;
}

function prepareRemoteRecords(
  records: readonly SyncRecord[],
  syncedTables: ReadonlySet<string>,
): PreparedRemoteRecord[] {
  const seenKeys = new Set<string>();

  return records.map((record) => {
    if (seenKeys.has(record.key)) {
      throw new Error(`Sync response contains duplicate key ${record.key}`);
    }
    seenKeys.add(record.key);

    const [tableName, rowId] = decodeSyncKey(record.key);
    if (!syncedTables.has(tableName)) {
      throw new Error(`Sync response targets unknown table ${tableName}`);
    }
    if (record.schemaVersion !== INITIAL_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported schema version ${record.schemaVersion} for ${record.key}`,
      );
    }

    const value = decodeSyncValue<unknown>(record.value);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Sync value for ${record.key} must be an object`);
    }

    const decodedRow = value as Record<string, unknown>;
    const row =
      tableName === "books"
        ? normalizeBookFileReferences(decodedRow)
        : decodedRow;
    if (row.id !== rowId) {
      throw new Error(`Sync value ID does not match key ${record.key}`);
    }
    if (row.isDeleted !== record.isDeleted) {
      throw new Error(`Sync deletion state does not match value ${record.key}`);
    }

    return { source: record, tableName, row };
  });
}

function getDomainTables(
  db: EPUBReaderSyncV2DB,
  records: readonly PreparedRemoteRecord[],
): Table[] {
  return [...new Set(records.map((record) => record.tableName))].map(
    (tableName) => db.table(tableName) as Table,
  );
}

async function putRemoteRows(
  db: EPUBReaderSyncV2DB,
  rowsByTable: ReadonlyMap<string, readonly Record<string, unknown>[]>,
): Promise<void> {
  for (const [tableName, rows] of rowsByTable) {
    await (
      db.table(tableName) as Table<Record<string, unknown>, string>
    ).bulkPut([...rows]);
  }
}

function validatePushResponse(
  changes: readonly SyncPushChange[],
  response: SyncPushResponse,
): void {
  if (response.results.length !== changes.length) {
    throw new Error("Sync push response length does not match request");
  }

  response.results.forEach((result, index) => {
    if (result.winner.key !== changes[index]!.key) {
      throw new Error("Sync push response order does not match request");
    }
  });
}

function validatePullResponse(
  request: SyncPullBody,
  response: SyncPullResponse,
  fixedHead: number | undefined,
): void {
  if (fixedHead !== undefined && response.head !== fixedHead) {
    throw new Error("Sync pull changed its fixed pagination head");
  }
  if (response.cursor < request.cursor) {
    throw new Error("Sync pull moved its cursor backwards");
  }
  if (response.records.some((record) => record.serverSeq <= request.cursor)) {
    throw new Error("Sync pull returned a record at or before its cursor");
  }
  if (response.hasMore && response.cursor <= request.cursor) {
    throw new Error("Sync pull did not advance its partial-page cursor");
  }
}

function sameSyncChange(left: SyncPushChange, right: SyncPushChange): boolean {
  return (
    left.key === right.key &&
    left.value === right.value &&
    left.schemaVersion === right.schemaVersion &&
    left.isDeleted === right.isDeleted &&
    left.hlc.wallTimeMs === right.hlc.wallTimeMs &&
    left.hlc.counter === right.hlc.counter
  );
}

function winnerMatchesChange(
  winner: SyncRecord,
  change: SyncPushChange,
): boolean {
  return sameSyncChange(winner, change);
}

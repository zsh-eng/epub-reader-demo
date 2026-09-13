import {
  observeSyncHlcBatch,
  type SyncClientStateStore,
} from "./client-state.js";
import {
  DEFAULT_SYNC_PULL_LIMIT,
  MAX_SYNC_PUSH_CHANGES,
  MAX_SYNC_PUSH_BODY_BYTES,
  syncPushChangeSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type SyncPullBody,
  type SyncPullResponse,
  type SyncPushChange,
  type SyncPushResponse,
} from "./protocol.js";
import type { SyncRemote, SyncRunResult, SyncStorage } from "./storage.js";

export interface SyncClientOptions<Prepared> {
  storage: SyncStorage<Prepared>;
  remote: SyncRemote;
  stateStore: SyncClientStateStore;
}

/**
 * Runs the v2 protocol. Full sync calls share one pull-then-push operation so
 * lifecycle triggers cannot start duplicate work.
 */
export class SyncClient<Prepared> {
  private readonly storage: SyncStorage<Prepared>;
  private readonly remote: SyncRemote;
  private readonly stateStore: SyncClientStateStore;
  private activeSync: Promise<SyncRunResult> | null = null;

  constructor(options: SyncClientOptions<Prepared>) {
    this.storage = options.storage;
    this.remote = options.remote;
    this.stateStore = options.stateStore;
  }

  sync(): Promise<SyncRunResult> {
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

  async pull(): Promise<Pick<SyncRunResult, "pulled" | "skipped">> {
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
      const preparedRecords = this.storage.prepareRemoteRecords(
        validResponse.records,
      );

      observeSyncHlcBatch(
        validResponse.records.map((record) => record.hlc),
        this.stateStore,
      );
      const result = await this.storage.applyRemoteRecords(
        preparedRecords,
        state.deviceId,
      );
      pulled += result.applied;
      skipped += result.skipped;

      const currentState = this.requireState();
      this.stateStore.write({
        ...currentState,
        pullCursor: validResponse.cursor,
        bootstrapped: currentState.bootstrapped || !validResponse.hasMore,
      });

      if (!validResponse.hasMore) {
        return { pulled, skipped };
      }
      head = validResponse.head;
    }
  }

  async push(): Promise<number> {
    const state = this.requireState();
    const pendingSnapshot = await this.storage.getPendingChanges();
    let pushed = 0;

    for (const changes of createPushBatches(pendingSnapshot)) {
      const response = syncPushResponseSchema.parse(
        await this.remote.push(state.deviceId, changes),
      );
      validatePushResponse(changes, response);
      const preparedWinners = this.storage.prepareRemoteRecords(
        response.results.map((result) => result.winner),
      );
      observeSyncHlcBatch(
        response.results.map((result) => result.winner.hlc),
        this.stateStore,
      );
      pushed += await this.storage.reconcilePushResults(
        changes,
        preparedWinners,
      );
    }

    return pushed;
  }

  private async runSync(): Promise<SyncRunResult> {
    const pullResult = await this.pull();
    const pushed = await this.push();
    return { ...pullResult, pushed };
  }

  private requireState() {
    const state = this.stateStore.read();
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

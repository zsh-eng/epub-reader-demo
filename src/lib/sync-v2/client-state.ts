import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import {
  SYNC_CLIENT_STATE_STORAGE_KEY,
  type SyncClientState,
  type SyncHlc,
  syncClientStateSchema,
  syncDeviceIdSchema,
} from "@/lib/sync-v2/protocol";

export type SyncClientStateStorage = Pick<Storage, "getItem" | "setItem">;

export function createSyncClientState(deviceId: string): SyncClientState {
  return syncClientStateSchema.parse({
    deviceId: syncDeviceIdSchema.parse(deviceId),
    hlc: { wallTimeMs: 0, counter: 0 },
    pullCursor: 0,
    bootstrapped: false,
  });
}

export function readSyncClientState(
  storage: SyncClientStateStorage = getRuntimeStorage(),
): SyncClientState | null {
  const encoded = storage.getItem(SYNC_CLIENT_STATE_STORAGE_KEY);
  if (encoded === null) {
    return null;
  }

  return syncClientStateSchema.parse(JSON.parse(encoded));
}

export function writeSyncClientState(
  state: SyncClientState,
  storage: SyncClientStateStorage = getRuntimeStorage(),
): void {
  const validState = syncClientStateSchema.parse(state);
  storage.setItem(SYNC_CLIENT_STATE_STORAGE_KEY, JSON.stringify(validState));
}

/** Seed the v2 envelope with the app's current device ID on first use. */
export function getOrCreateSyncClientState(
  deviceId: string,
  storage: SyncClientStateStorage = getRuntimeStorage(),
): SyncClientState {
  const state = readSyncClientState(storage);
  if (state !== null) {
    return state;
  }

  const initialState = createSyncClientState(deviceId);
  writeSyncClientState(initialState, storage);
  return initialState;
}

/** Reserve a monotonic HLC range and persist the last value in one write. */
export function nextSyncHlcBatch(
  count: number,
  storage: SyncClientStateStorage = getRuntimeStorage(),
  now = Date.now(),
): SyncHlc[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("HLC batch count must be a non-negative safe integer");
  }
  if (count === 0) {
    return [];
  }

  const state = readSyncClientState(storage);
  if (state === null) {
    throw new Error(
      "Sync client state must be initialized before local writes",
    );
  }

  const wallTimeMs = Math.max(now, state.hlc.wallTimeMs);
  const firstCounter =
    wallTimeMs > state.hlc.wallTimeMs ? 0 : state.hlc.counter + 1;
  const timestamps = Array.from({ length: count }, (_, index) => ({
    wallTimeMs,
    counter: firstCounter + index,
  }));

  writeSyncClientState(
    {
      ...state,
      hlc: timestamps.at(-1)!,
    },
    storage,
  );
  return timestamps;
}

/** Observe remote clocks outside IndexedDB; harmless gaps are preferable. */
export function observeSyncHlcBatch(
  timestamps: readonly SyncHlc[],
  storage: SyncClientStateStorage = getRuntimeStorage(),
): void {
  if (timestamps.length === 0) {
    return;
  }

  const state = readSyncClientState(storage);
  if (state === null) {
    throw new Error("Sync client state must be initialized before remote sync");
  }

  const latest = timestamps.reduce((current, candidate) =>
    compareHlc(candidate, current) > 0 ? candidate : current,
  );
  if (compareHlc(latest, state.hlc) <= 0) {
    return;
  }

  writeSyncClientState({ ...state, hlc: latest }, storage);
}

function compareHlc(left: SyncHlc, right: SyncHlc): number {
  if (left.wallTimeMs !== right.wallTimeMs) {
    return left.wallTimeMs - right.wallTimeMs;
  }
  return left.counter - right.counter;
}

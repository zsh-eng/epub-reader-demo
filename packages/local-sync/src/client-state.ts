import { observeSyncHlc, tickSyncHlcBatch } from "./clock.js";
import {
  syncClientStateSchema,
  syncDeviceIdSchema,
  type SyncClientState,
  type SyncHlc,
} from "./protocol.js";

/** Each client/account must receive its own durable state store. */
export interface SyncClientStateStore {
  read(): SyncClientState | null;
  write(state: SyncClientState): void;
}

export interface SyncKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Adapt a caller-owned key/value store; importing the package never opens storage. */
export function createSyncClientStateStore(
  storage: SyncKeyValueStorage,
  key: string,
): SyncClientStateStore {
  return {
    read() {
      const encoded = storage.getItem(key);
      return encoded === null
        ? null
        : syncClientStateSchema.parse(JSON.parse(encoded));
    },
    write(state) {
      storage.setItem(key, JSON.stringify(syncClientStateSchema.parse(state)));
    },
  };
}

export function createSyncClientState(deviceId: string): SyncClientState {
  return syncClientStateSchema.parse({
    deviceId: syncDeviceIdSchema.parse(deviceId),
    hlc: { wallTimeMs: 0, counter: 0 },
    pullCursor: 0,
    bootstrapped: false,
  });
}

export function getOrCreateSyncClientState(
  deviceId: string,
  store: SyncClientStateStore,
): SyncClientState {
  const state = store.read();
  if (state !== null) return state;
  const initialState = createSyncClientState(deviceId);
  store.write(initialState);
  return initialState;
}

/** Persist the reserved clock range before the caller starts local writes. */
export function nextSyncHlcBatch(
  count: number,
  store: SyncClientStateStore,
  now: number,
): SyncHlc[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("HLC batch count must be a non-negative safe integer");
  }
  if (count === 0) return [];
  const state = store.read();
  if (state === null)
    throw new Error(
      "Sync client state must be initialized before local writes",
    );
  const timestamps = tickSyncHlcBatch(state.hlc, count, now);
  store.write({ ...state, hlc: timestamps.at(-1)! });
  return timestamps;
}

/** Harmless reserved-clock gaps can survive a failed database transaction. */
export function observeSyncHlcBatch(
  timestamps: readonly SyncHlc[],
  store: SyncClientStateStore,
): void {
  if (timestamps.length === 0) return;
  const state = store.read();
  if (state === null)
    throw new Error("Sync client state must be initialized before remote sync");
  const latest = observeSyncHlc(state.hlc, timestamps);
  if (latest !== state.hlc) store.write({ ...state, hlc: latest });
}

import {
  SYNC_CLIENT_STATE_STORAGE_KEY,
  type SyncClientState,
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
  storage: SyncClientStateStorage = localStorage,
): SyncClientState | null {
  const encoded = storage.getItem(SYNC_CLIENT_STATE_STORAGE_KEY);
  if (encoded === null) {
    return null;
  }

  return syncClientStateSchema.parse(JSON.parse(encoded));
}

export function writeSyncClientState(
  state: SyncClientState,
  storage: SyncClientStateStorage = localStorage,
): void {
  const validState = syncClientStateSchema.parse(state);
  storage.setItem(SYNC_CLIENT_STATE_STORAGE_KEY, JSON.stringify(validState));
}

/** Seed the v2 envelope with the app's current device ID on first use. */
export function getOrCreateSyncClientState(
  deviceId: string,
  storage: SyncClientStateStorage = localStorage,
): SyncClientState {
  const state = readSyncClientState(storage);
  if (state !== null) {
    return state;
  }

  const initialState = createSyncClientState(deviceId);
  writeSyncClientState(initialState, storage);
  return initialState;
}

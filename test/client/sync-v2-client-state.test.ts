import {
  getOrCreateSyncClientState,
  readSyncClientState,
  writeSyncClientState,
} from "@/lib/sync-v2/client-state";
import { SYNC_CLIENT_STATE_STORAGE_KEY } from "@/lib/sync-v2/protocol";
import { beforeEach, describe, expect, it } from "vitest";

describe("sync v2 client state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists one state envelope and keeps its original device ID", () => {
    const initial = getOrCreateSyncClientState("device-a");
    expect(initial).toEqual({
      deviceId: "device-a",
      hlc: { wallTimeMs: 0, counter: 0 },
      pullCursor: 0,
      bootstrapped: false,
    });

    const advanced = {
      ...initial,
      hlc: { wallTimeMs: 1_000, counter: 2 },
      pullCursor: 42,
      bootstrapped: true,
    };
    writeSyncClientState(advanced);

    expect(readSyncClientState()).toEqual(advanced);
    expect(getOrCreateSyncClientState("device-b")).toEqual(advanced);
  });

  it("rejects an invalid stored envelope", () => {
    localStorage.setItem(
      SYNC_CLIENT_STATE_STORAGE_KEY,
      JSON.stringify({ deviceId: "invalid device" }),
    );

    expect(() => readSyncClientState()).toThrow();
  });
});

import {
  configureLabRuntime,
  registerLabDrain,
  drainLabWork,
  getRuntimeStorage,
  type LabRuntimeConfig,
} from "@/features/sync-lab/runtime";
import { LabStorage } from "@/features/sync-lab/core/storage";
import { getOrCreateDeviceId } from "@/lib/device";
import {
  createSyncV2ApplicationDb,
  deleteLegacyClientDatabase,
} from "@/lib/sync-v2/db";
import { SYNC_CLIENT_STATE_STORAGE_KEY } from "@/lib/sync-v2/protocol";
import { readSyncClientState } from "@/lib/sync-v2/client-state";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { resetIndexedDB } from "../setup/indexeddb";

function runtime(): LabRuntimeConfig {
  return {
    databaseName: "sync-lab-isolation",
    deviceId: "lab-device",
    storage: new LabStorage(),
    syncRemote: { pull: vi.fn(), push: vi.fn() },
    fileRemote: { put: vi.fn(), get: vi.fn(), list: vi.fn(), delete: vi.fn() },
    now: () => 1234,
    isOnline: () => true,
    subscribeOnline: () => () => {},
    autoSync: () => false,
    subscribeAutoSync: () => () => {},
  };
}

describe("lab runtime isolation", () => {
  afterEach(() => {
    delete window.__SYNC_LAB_RUNTIME__;
    vi.restoreAllMocks();
  });

  it("routes identity and storage to the lab and skips legacy cleanup", async () => {
    const productionStorage = localStorage.getItem("epub-reader-device-id");
    const lab = runtime();
    configureLabRuntime(lab);
    expect(getRuntimeStorage()).toBe(lab.storage);
    expect(getOrCreateDeviceId()).toBe("lab-device");
    expect(localStorage.getItem("epub-reader-device-id")).toBe(
      productionStorage,
    );
    const remove = vi.spyOn(Dexie, "delete");
    await deleteLegacyClientDatabase();
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps an unmounted owner's final write in the shutdown drain", async () => {
    configureLabRuntime(runtime());
    let release!: () => void;
    const write = new Promise<void>((resolve) => {
      release = resolve;
    });
    const unregister = registerLabDrain(() => write);
    unregister();
    let settled = false;
    const drain = drainLabWork().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await drain;
    expect(settled).toBe(true);
  });

  it("rejects production database names and runtime replacement", () => {
    expect(() =>
      configureLabRuntime({ ...runtime(), databaseName: "epub-reader-db-v2" }),
    ).toThrow("sync-lab-");
    configureLabRuntime(runtime());
    expect(() => configureLabRuntime(runtime())).toThrow("cannot be replaced");
  });

  it("keeps local changes and HLC state separate for two application databases", async () => {
    resetIndexedDB();
    const productionState = localStorage.getItem(SYNC_CLIENT_STATE_STORAGE_KEY);
    const storageA = new LabStorage();
    const storageB = new LabStorage();
    const a = createSyncV2ApplicationDb("sync-lab-a", {
      deviceId: "device-a",
      storage: storageA,
      now: () => 1000,
    });
    const b = createSyncV2ApplicationDb("sync-lab-b", {
      deviceId: "device-b",
      storage: storageB,
      now: () => 2000,
    });
    try {
      const note = {
        id: "note",
        bookId: "book",
        kind: "note" as const,
        content: "A",
        createdAt: 1,
        updatedAt: 1,
        anchor: {
          spineItemId: "chapter",
          startOffset: 0,
          endOffset: 1,
          textBefore: "",
          textAfter: "",
        },
        isDeleted: false,
      };
      await a.notes.put(note);
      await b.notes.put({ ...note, content: "B" });
      expect(await a.notes.get("note")).toMatchObject({ content: "A" });
      expect(await b.notes.get("note")).toMatchObject({ content: "B" });
      expect((await a._sync_outbox.toArray())[0]?.hlc.wallTimeMs).toBe(1000);
      expect((await b._sync_outbox.toArray())[0]?.hlc.wallTimeMs).toBe(2000);
      expect(readSyncClientState(storageA)?.deviceId).toBe("device-a");
      expect(readSyncClientState(storageB)?.deviceId).toBe("device-b");
      expect(localStorage.getItem(SYNC_CLIENT_STATE_STORAGE_KEY)).toBe(
        productionState,
      );
    } finally {
      a.close();
      b.close();
      await Dexie.delete("sync-lab-a");
      await Dexie.delete("sync-lab-b");
    }
  });
});

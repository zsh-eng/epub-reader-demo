import { afterEach, expect, it, vi } from "vitest";
import { configureLabRuntime } from "@/features/sync-lab/runtime";
import { LabStorage } from "@/features/sync-lab/core/storage";
import { honoClient } from "@/lib/api";

afterEach(() => {
  delete window.__SYNC_LAB_RUNTIME__;
  vi.restoreAllMocks();
});

it("blocks authenticated production requests before calling fetch in a lab client", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const productionIdentity = localStorage.getItem("epub-reader-device-id");
  configureLabRuntime({
    databaseName: "sync-lab-network-isolation",
    deviceId: "lab-device",
    storage: new LabStorage(),
    syncRemote: { pull: vi.fn(), push: vi.fn() },
    fileRemote: { put: vi.fn(), get: vi.fn(), list: vi.fn(), delete: vi.fn() },
    now: () => 0,
    isOnline: () => true,
    subscribeOnline: () => () => {},
    autoSync: () => false,
    subscribeAutoSync: () => () => {},
  });
  await expect(honoClient.api.sessions.$get()).rejects.toThrow(
    "disabled in Sync Lab",
  );
  await expect(honoClient.api.devices.$get()).rejects.toThrow(
    "disabled in Sync Lab",
  );
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(localStorage.getItem("epub-reader-device-id")).toBe(
    productionIdentity,
  );
});

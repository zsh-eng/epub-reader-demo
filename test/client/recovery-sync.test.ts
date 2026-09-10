import { SyncProvider, useSync } from "@/hooks/use-sync";
import { useFileUploads } from "@/hooks/use-file-uploads";
import { files } from "@/lib/files";
import { syncService } from "@/lib/sync-service";
import { SyncV2Client } from "@/lib/sync-v2/sync";
import { db, addBook, getBook } from "@/lib/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  signedIn: true,
  sessionId: undefined as string | undefined,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    isAuthenticated: auth.signedIn,
    isLoading: false,
    session: auth.sessionId ? { id: auth.sessionId } : undefined,
  }),
}));
beforeEach(async () => {
  auth.signedIn = true;
  auth.sessionId = undefined;
  await db.open();
});

it("recovers record sync only for a new confirmed session, including restoration offline", async () => {
  const { SyncService } = await import("@/lib/sync-service");
  const { SyncRemoteRequestError } = await import("@/lib/sync-v2/sync");
  const service = new SyncService();
  const exchange = vi
    .spyOn(SyncV2Client.prototype, "sync")
    .mockRejectedValueOnce(new SyncRemoteRequestError("pull", 401))
    .mockResolvedValue({ pulled: 0, pushed: 0, skipped: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    service.setSessionIdentity("expired");
    service.startPeriodicSync();
    await service.drain();
    service.stopPeriodicSync();
    service.setSessionIdentity("expired");
    service.setSessionIdentity(undefined);
    service.startPeriodicSync();
    expect(service.getSnapshot().authRequired).toBe(true);
    expect(exchange).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("offline"));
    service.setSessionIdentity("restored");
    expect(service.getSnapshot().authRequired).toBe(false);
    expect(exchange).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("online"));
    await service.drain();
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot().error).toBeNull();
  } finally {
    service.dispose();
  }
});

it("retries the new session when an older in-flight exchange returns 401", async () => {
  const { SyncService } = await import("@/lib/sync-service");
  const { SyncRemoteRequestError } = await import("@/lib/sync-v2/sync");
  const service = new SyncService();
  const pending = Promise.withResolvers<{
    pulled: number;
    pushed: number;
    skipped: number;
  }>();
  const exchange = vi
    .spyOn(SyncV2Client.prototype, "sync")
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ pulled: 0, pushed: 0, skipped: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    service.setSessionIdentity("old");
    service.startPeriodicSync();
    service.stopPeriodicSync();
    service.setSessionIdentity("new");
    service.startPeriodicSync();
    pending.reject(new SyncRemoteRequestError("pull", 401));
    await service.drain();
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toMatchObject({
      authRequired: false,
      error: null,
      isSyncing: false,
    });
  } finally {
    service.dispose();
  }
});

it("forwards confirmed session changes from auth while upload and sync transport stay offline", async () => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  window.dispatchEvent(new Event("offline"));
  const recordIdentity = vi.spyOn(syncService, "setSessionIdentity");
  const uploadIdentity = vi.spyOn(files, "setSessionIdentity");
  const resume = vi.spyOn(files, "resumeUploads").mockImplementation(() => {});
  vi.spyOn(files, "pauseUploads").mockImplementation(() => {});
  const manualRetry = vi
    .spyOn(files, "retryUploads")
    .mockImplementation(() => {});
  const record = mountSync();
  const upload = renderHook(useFileUploads);
  auth.sessionId = "restored-offline";
  record.rerender();
  upload.rerender();
  expect(recordIdentity).toHaveBeenLastCalledWith("restored-offline");
  expect(uploadIdentity).toHaveBeenLastCalledWith("restored-offline");
  expect(resume).not.toHaveBeenCalled();
  expect(manualRetry).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  act(() => window.dispatchEvent(new Event("online")));
  expect(resume).toHaveBeenCalledOnce();
});
afterEach(async () => {
  cleanup();
  syncService.stopPeriodicSync();
  window.dispatchEvent(new Event("online"));
  vi.restoreAllMocks();
  await db.delete();
});
function mountSync() {
  vi.spyOn(syncService, "startPeriodicSync").mockImplementation(() => {});
  const client = new QueryClient();
  return renderHook(useSync, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(SyncProvider, {}, children),
      ),
  });
}
it("rejects a manual offline race without changing the last completed timestamp", async () => {
  const exchange = vi
    .spyOn(SyncV2Client.prototype, "sync")
    .mockResolvedValue({ pulled: 0, pushed: 0, skipped: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { result } = mountSync();
  await act(() => result.current.triggerSync());
  const completedAt = result.current.lastSyncedAt;
  expect(completedAt).toBeInstanceOf(Date);
  window.dispatchEvent(new Event("offline"));
  await act(async () => {
    await expect(result.current.triggerSync()).rejects.toThrow(
      "You are offline",
    );
  });
  expect(result.current.lastSyncedAt).toBe(completedAt);
  expect(result.current.syncError?.message).toContain("You are offline");
  expect(exchange).toHaveBeenCalledOnce();
});
it("deletes a signed-in book locally when exchange is skipped offline", async () => {
  const exchange = vi.spyOn(SyncV2Client.prototype, "sync");
  const { result } = mountSync();
  await addBook({
    id: "offline-book",
    sourceFileId: "xxh64:0000000000000000",
    title: "Offline",
    author: "Reader",
    fileSize: 1,
    dateAdded: 1,
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
    cover: null,
  });
  window.dispatchEvent(new Event("offline"));
  await act(async () => {
    await expect(
      result.current.deleteBook("offline-book"),
    ).resolves.toBeUndefined();
  });
  expect(await getBook("offline-book")).toBeUndefined();
  expect(await db._sync_outbox.count()).toBeGreaterThan(0);
  expect(exchange).not.toHaveBeenCalled();
});
it("does not restart exchange on reconnect after periodic sync stops", async () => {
  const exchange = vi
    .spyOn(SyncV2Client.prototype, "sync")
    .mockResolvedValue({ pulled: 0, pushed: 0, skipped: 0 });
  syncService.startPeriodicSync();
  await Promise.resolve();
  syncService.stopPeriodicSync();
  window.dispatchEvent(new Event("offline"));
  window.dispatchEvent(new Event("online"));
  expect(exchange).toHaveBeenCalledOnce();
});

it("rejects a signed-out manual sync without exchange or a completion timestamp", async () => {
  auth.signedIn = false;
  const exchange = vi.spyOn(syncService, "syncAll");
  const { result } = mountSync();
  await expect(result.current.triggerSync()).rejects.toThrow(
    "Sign in to synchronize",
  );
  expect(exchange).not.toHaveBeenCalled();
  expect(result.current.lastSyncedAt).toBeNull();
});

it("publishes automatic failures and recovery through the same state as manual sync", async () => {
  const { SyncService } = await import("@/lib/sync-service");
  const service = new SyncService();
  const exchange = vi
    .spyOn(SyncV2Client.prototype, "sync")
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValue({ pulled: 0, pushed: 0, skipped: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    service.startPeriodicSync();
    expect(service.getSnapshot().isSyncing).toBe(true);
    await service.drain();
    expect(service.getSnapshot().error?.message).toBe("Temporary failure");
    expect(service.getSnapshot().lastSyncedAt).toBeNull();
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    await service.drain();
    expect(service.getSnapshot()).toMatchObject({
      isSyncing: false,
      error: null,
      authRequired: false,
    });
    expect(service.getSnapshot().lastSyncedAt).toBeInstanceOf(Date);
    expect(exchange).toHaveBeenCalledTimes(2);
  } finally {
    service.dispose();
  }
});

it("blocks automatic 401 retries until an explicit exchange succeeds", async () => {
  const { SyncService } = await import("@/lib/sync-service");
  const { SyncRemoteRequestError } = await import("@/lib/sync-v2/sync");
  const service = new SyncService();
  const exchange = vi
    .spyOn(SyncV2Client.prototype, "sync")
    .mockRejectedValueOnce(new SyncRemoteRequestError("pull", 401))
    .mockResolvedValue({ pulled: 0, pushed: 0, skipped: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    service.startPeriodicSync();
    await service.drain();
    expect(service.getSnapshot().authRequired).toBe(true);
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    service.stopPeriodicSync();
    service.startPeriodicSync();
    await service.drain();
    expect(exchange).toHaveBeenCalledOnce();
    await service.syncAll();
    expect(service.getSnapshot().authRequired).toBe(false);
    expect(exchange).toHaveBeenCalledTimes(2);
  } finally {
    service.dispose();
  }
});

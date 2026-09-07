import { SyncProvider, useSync } from "@/hooks/use-sync";
import { syncService } from "@/lib/sync-service";
import { SyncV2Client } from "@/lib/sync-v2/sync";
import { db, addBook, getBook } from "@/lib/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: auth.signedIn, isLoading: false }),
}));
beforeEach(async () => {
  auth.signedIn = true;
  await db.open();
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

import { useAuth } from "@/hooks/use-auth";
import { deleteBook as deleteBookFromDb } from "@/lib/db";
import { syncService } from "@/lib/sync-service";
import { subscribeToQueryInvalidation } from "@/lib/query-invalidation";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export class SyncUnavailableError extends Error {}

interface SyncContextValue {
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
  /** Last sync timestamp */
  lastSyncedAt: Date | null;
  /** Trigger a manual sync */
  triggerSync: () => Promise<void>;
  /** Delete a book (syncs deletion to server) */
  deleteBook: (bookId: string) => Promise<void>;
  /** Error from last sync attempt */
  syncError: Error | null;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/**
 * Owns the synchronization lifecycle and observable UI state once.
 *
 * This hook:
 * - Refreshes queries after committed database writes, including offline edits
 * - Starts periodic sync when user is authenticated
 * - Provides manual sync triggers and book operations
 * - Exposes sync state to the UI
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<Error | null>(null);
  useEffect(() => subscribeToQueryInvalidation(queryClient), [queryClient]);

  // Start/stop periodic sync based on auth status
  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    if (isAuthenticated) {
      // Start periodic sync (every 30 seconds)
      syncService.startPeriodicSync(30000);
    } else {
      // Stop sync when logged out
      syncService.stopPeriodicSync();
    }

    return () => {
      syncService.stopPeriodicSync();
    };
  }, [isAuthenticated, isAuthLoading]);

  // Manual sync trigger
  const triggerSync = useCallback(async () => {
    if (!isAuthenticated)
      throw new SyncUnavailableError("Sign in to synchronize your library.");

    setIsSyncing(true);
    setSyncError(null);

    try {
      const result = await syncService.syncAll();
      if (result.status === "offline") {
        throw new SyncUnavailableError(
          "You are offline. Connect to the internet and try again.",
        );
      }
      setLastSyncedAt(new Date());
    } catch (error) {
      console.error("[useSync] Sync failed:", error);
      const syncFailure =
        error instanceof Error ? error : new Error("Sync failed");
      setSyncError(syncFailure);
      throw syncFailure;
    } finally {
      setIsSyncing(false);
    }
  }, [isAuthenticated]);

  // Delete a book (syncs to server)
  const deleteBook = useCallback(
    async (bookId: string) => {
      if (!isAuthenticated) {
        await deleteBookFromDb(bookId);
        return;
      }

      // Delete locally first
      await deleteBookFromDb(bookId);

      // Then run the normal pull-push flow.
      await syncService.syncAll();
    },
    [isAuthenticated],
  );

  const value = useMemo<SyncContextValue>(
    () => ({
      isSyncing,
      lastSyncedAt,
      triggerSync,
      deleteBook,
      syncError,
    }),
    [deleteBook, isSyncing, lastSyncedAt, syncError, triggerSync],
  );

  return createElement(SyncContext.Provider, { value }, children);
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSync must be used within SyncProvider");
  }
  return context;
}

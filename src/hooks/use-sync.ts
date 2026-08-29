import { useAuth } from "@/hooks/use-auth";
import { deleteBook as deleteBookFromDb } from "@/lib/db";
import { syncService } from "@/lib/sync-service";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface SyncContextValue {
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
  /** Last sync timestamp */
  lastSyncedAt: Date | null;
  /** Trigger a manual sync */
  triggerSync: () => Promise<void>;
  /** Download a specific book */
  downloadBook: (bookId: string) => Promise<void>;
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
 * - Initializes the sync service with the QueryClient
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
  const initialized = useRef(false);

  // Initialize sync service with query client
  useEffect(() => {
    if (!initialized.current) {
      syncService.setQueryClient(queryClient);
      initialized.current = true;
    }
  }, [queryClient]);

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
    if (!isAuthenticated) {
      console.log("[useSync] Not authenticated, skipping sync");
      return;
    }

    setIsSyncing(true);
    setSyncError(null);

    try {
      await syncService.syncAll();
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

  // Download a book from server
  const downloadBook = useCallback(
    async (_bookId: string) => {
      if (!isAuthenticated) {
        throw new Error("Must be authenticated to download books");
      }

      await syncService.syncAll();
    },
    [isAuthenticated],
  );

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
      downloadBook,
      deleteBook,
      syncError,
    }),
    [deleteBook, downloadBook, isSyncing, lastSyncedAt, syncError, triggerSync],
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

/**
 * Hook to get the sync state for a specific book
 *
 * Note: This hook is currently a stub. The sync service doesn't expose
 * per-book sync state yet. To implement this, we'd need to track sync
 * metadata at a more granular level.
 */
export function useBookSyncState(fileHash: string | undefined) {
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!fileHash) {
      setIsLoading(false);
      return;
    }

    // TODO: Implement per-book sync state tracking
    // For now, we just return null status
    setStatus(null);
    setIsLoading(false);
  }, [fileHash]);

  return { status, isLoading };
}

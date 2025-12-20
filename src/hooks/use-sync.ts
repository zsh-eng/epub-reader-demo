import { useAuth } from "@/hooks/use-auth";
import { syncService } from "@/lib/sync-service";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseSyncReturn {
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

/**
 * Hook for managing book synchronization.
 *
 * This hook:
 * - Initializes the sync service with the QueryClient
 * - Starts periodic sync when user is authenticated
 * - Provides manual sync triggers and book operations
 * - Exposes sync state to the UI
 */
export function useSync(): UseSyncReturn {
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
      await syncService.sync();
      setLastSyncedAt(new Date());
    } catch (error) {
      console.error("[useSync] Sync failed:", error);
      setSyncError(error instanceof Error ? error : new Error("Sync failed"));
    } finally {
      setIsSyncing(false);
    }
  }, [isAuthenticated]);

  // Download a book from server
  const downloadBook = useCallback(
    async (bookId: string) => {
      if (!isAuthenticated) {
        throw new Error("Must be authenticated to download books");
      }

      await syncService.downloadBook(bookId);
    },
    [isAuthenticated],
  );

  // Delete a book (syncs to server)
  const deleteBook = useCallback(
    async (bookId: string) => {
      if (!isAuthenticated) {
        // If not authenticated, we can still delete locally
        // but we'll use the regular db delete
        const { deleteBook: deleteBookFromDb } = await import("@/lib/db");
        await deleteBookFromDb(bookId);
        return;
      }

      await syncService.deleteBook(bookId);
    },
    [isAuthenticated],
  );

  return {
    isSyncing,
    lastSyncedAt,
    triggerSync,
    downloadBook,
    deleteBook,
    syncError,
  };
}

/**
 * Hook to get the sync state for a specific book
 */
export function useBookSyncState(fileHash: string | undefined) {
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!fileHash) {
      setIsLoading(false);
      return;
    }

    let mounted = true;

    const loadState = async () => {
      const state = await syncService.getBookSyncState(fileHash);
      if (mounted) {
        setStatus(state?.status ?? null);
        setIsLoading(false);
      }
    };

    loadState();

    return () => {
      mounted = false;
    };
  }, [fileHash]);

  return { status, isLoading };
}

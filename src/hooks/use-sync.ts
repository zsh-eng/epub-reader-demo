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
      await syncService.syncAll();
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

      // Sync the books table with specific entity filter
      await syncService.syncTable("books", bookId);
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

      // Delete locally first
      const { deleteBook: deleteBookFromDb } = await import("@/lib/db");
      await deleteBookFromDb(bookId);

      // Then sync to push the deletion to server
      await syncService.syncTable("books");
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

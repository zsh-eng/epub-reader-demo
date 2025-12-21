/**
 * Sync Service
 *
 * Core synchronization orchestrator for bidirectional sync between
 * local IndexedDB and the server.
 *
 * Key responsibilities:
 * - Pull: Fetch book changes from server since last sync
 * - Push: Send local book changes to server
 * - Coordinate upload and download operations
 * - Invalidate TanStack Query cache when data changes
 * - Periodic sync management
 */

import { bookKeys } from "@/hooks/use-book-loader";
import { honoClient } from "@/lib/api";
import {
  addSyncLog,
  db,
  getBookByFileHash,
  getSyncCursor,
  setBookSyncState,
  setSyncCursor,
  type Book,
  type BookSyncState,
  type SyncLog,
} from "@/lib/db";
import { type QueryClient } from "@tanstack/react-query";
import { bookDownloadService } from "./sync/book-download-service";
import { bookUploadService } from "./sync/book-upload-service";
import type {
  BookSyncResult,
  PushBooksResponse,
  ServerBook,
  SyncBooksResponse,
} from "./sync/types";

// Sync cursor ID for books
const BOOKS_SYNC_CURSOR_ID = "books";

/**
 * SyncService handles bidirectional synchronization of books between
 * the local IndexedDB and the server.
 */
export class SyncService {
  private queryClient: QueryClient | null = null;
  private isSyncing = false;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize the sync service with a QueryClient for cache invalidation
   */
  setQueryClient(queryClient: QueryClient): void {
    this.queryClient = queryClient;
    bookDownloadService.setQueryClient(queryClient);
  }

  /**
   * Start periodic sync (e.g., every 30 seconds when online)
   */
  startPeriodicSync(intervalMs = 30000): void {
    if (this.syncInterval) {
      return; // Already running
    }

    // Initial sync
    this.sync();

    // Set up periodic sync
    this.syncInterval = setInterval(() => {
      if (navigator.onLine) {
        this.sync();
      }
    }, intervalMs);

    // Listen for online events to trigger sync
    window.addEventListener("online", this.handleOnline);
  }

  /**
   * Stop periodic sync
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    window.removeEventListener("online", this.handleOnline);
  }

  private handleOnline = (): void => {
    this.sync();
  };

  /**
   * Main sync method: pulls from server, pushes local changes, and optionally downloads cover images
   *
   * This syncs metadata only - actual file content (covers and EPUBs) are downloaded separately.
   *
   * @param downloadCovers If true, downloads cover images for books after pulling metadata.
   *                       Recommended for initial sync or when you want to update the library view.
   *                       Default: true
   */
  async sync(downloadCovers = true): Promise<void> {
    if (this.isSyncing) {
      console.log("[SyncService] Sync already in progress, skipping");
      return;
    }

    if (!navigator.onLine) {
      console.log("[SyncService] Offline, skipping sync");
      return;
    }

    this.isSyncing = true;
    const startTime = Date.now();

    try {
      console.log("[SyncService] Starting sync...");

      await this.pull();
      await this.push();
      if (downloadCovers) {
        await bookDownloadService.downloadCoverImages();
      }

      console.log(
        `[SyncService] Sync completed in ${Date.now() - startTime}ms`,
      );
    } catch (error) {
      console.error("[SyncService] Sync failed:", error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Pull changes from server since last sync
   */
  async pull(): Promise<void> {
    const startTime = Date.now();

    try {
      // Get last sync cursor
      const cursor = await getSyncCursor(BOOKS_SYNC_CURSOR_ID);
      const since = cursor?.lastServerTimestamp ?? 0;

      console.log(`[SyncService] Pulling books since ${since}`);
      const response = await honoClient.api.sync.books.$get({
        query: { since: since.toString() },
      });

      if (!response.ok) {
        throw new Error(`Failed to pull books: ${response.status}`);
      }

      const data: SyncBooksResponse = await response.json();
      if (data.books.length === 0) {
        console.log("[SyncService] No new books from server");
        return;
      }

      console.log(`[SyncService] Received ${data.books.length} books`);
      let hasChanges = false;
      for (const serverBook of data.books) {
        const changed = await this.processServerBook(serverBook);
        if (changed) {
          hasChanges = true;
        }
      }

      // Update sync cursor
      await setSyncCursor({
        id: BOOKS_SYNC_CURSOR_ID,
        lastServerTimestamp: data.serverTimestamp,
      });

      // Invalidate queries if there were changes
      if (hasChanges) {
        this.invalidateBookQueries();
      }

      await this.logSync(
        "pull",
        "book",
        "sync",
        "update",
        "success",
        Date.now() - startTime,
      );
    } catch (error) {
      await this.logSync(
        "pull",
        "book",
        "sync",
        "update",
        "failure",
        Date.now() - startTime,
        error instanceof Error ? error.message : "Unknown error",
      );
      throw error;
    }
  }

  /**
   * Process a single book from the server
   * Returns true if a change was made locally
   */
  private async processServerBook(serverBook: ServerBook): Promise<boolean> {
    const existingBook = await getBookByFileHash(serverBook.fileHash);

    const isServerBookDeleted = serverBook.deletedAt !== null;
    if (isServerBookDeleted && !existingBook) {
      return false;
    }

    if (isServerBookDeleted && existingBook) {
      // Delete local book and related data
      await db.transaction(
        "rw",
        [
          db.books,
          db.bookFiles,
          db.readingProgress,
          db.highlights,
          db.bookSyncState,
        ],
        async () => {
          await db.books.delete(existingBook.id);
          await db.bookFiles.where("bookId").equals(existingBook.id).delete();
          await db.readingProgress.delete(existingBook.id);
          await db.highlights.where("bookId").equals(existingBook.id).delete();
          await db.bookSyncState.delete(serverBook.fileHash);
        },
      );

      console.log(`[SyncService] Deleted book: ${serverBook.title}`);
      await this.logSync(
        "pull",
        "book",
        serverBook.fileHash,
        "delete",
        "success",
      );
      return true;
    }

    if (!existingBook) {
      const newBook: Book = {
        id: crypto.randomUUID(),
        fileHash: serverBook.fileHash,
        title: serverBook.title,
        author: serverBook.author,
        fileSize: serverBook.fileSize,
        dateAdded: new Date(serverBook.createdAt ?? Date.now()),
        metadata: (serverBook.metadata as Book["metadata"]) ?? {},
        manifest: [],
        spine: [],
        toc: [],
        isDownloaded: 0, // Not downloaded yet
        remoteEpubUrl: serverBook.epubUrl ?? undefined,
        remoteCoverUrl: serverBook.coverUrl ?? undefined,
      };

      await db.books.add(newBook);

      // Set sync state as synced (metadata is synced, but epub not downloaded)
      await setBookSyncState({
        fileHash: serverBook.fileHash,
        status: "synced",
        lastSyncedAt: new Date(),
        lastServerTimestamp: serverBook.updatedAt ?? undefined,
        epubUploaded: !!serverBook.epubR2Key,
        coverUploaded: !!serverBook.coverR2Key,
        retryCount: 0,
      });

      console.log(
        `[SyncService] Added remote book: ${serverBook.title} (not downloaded)`,
      );
      await this.logSync(
        "pull",
        "book",
        serverBook.fileHash,
        "create",
        "success",
      );
      return true;
    }

    // Handle metadata update for existing book
    const serverUpdatedAt = serverBook.updatedAt ?? 0;
    const localUpdatedAt = existingBook.lastOpened?.getTime() ?? 0;

    // Server is newer, update metadata
    if (serverUpdatedAt > localUpdatedAt) {
      await db.books.update(existingBook.id, {
        title: serverBook.title,
        author: serverBook.author,
        metadata:
          (serverBook.metadata as Book["metadata"]) ?? existingBook.metadata,
        remoteEpubUrl: serverBook.epubUrl ?? existingBook.remoteEpubUrl,
        remoteCoverUrl: serverBook.coverUrl ?? existingBook.remoteCoverUrl,
      });

      console.log(`[SyncService] Updated book metadata: ${serverBook.title}`);
      await this.logSync(
        "pull",
        "book",
        serverBook.fileHash,
        "update",
        "success",
      );
      return true;
    }

    return false;
  }

  /**
   * Push local changes to server
   */
  async push(): Promise<void> {
    const startTime = Date.now();

    try {
      // Get all local books that need syncing
      const booksToSync = await this.getBooksToSync();

      if (booksToSync.length === 0) {
        console.log("[SyncService] No books to push");
        return;
      }

      console.log(`[SyncService] Pushing ${booksToSync.length} books`);

      const response = await honoClient.api.sync.books.$post({
        json: {
          books: booksToSync.map((book) => ({
            fileHash: book.fileHash,
            title: book.title,
            author: book.author,
            fileSize: book.fileSize,
            metadata: book.metadata,
            localCreatedAt: book.dateAdded.getTime(),
          })),
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to push books: ${response.status}`);
      }

      const data: PushBooksResponse = await response.json();

      // Process results and upload files as needed
      await this.processUploadResults(data.results, booksToSync);
      await this.logSync(
        "push",
        "book",
        "batch",
        "update",
        "success",
        Date.now() - startTime,
      );
    } catch (error) {
      await this.logSync(
        "push",
        "book",
        "batch",
        "update",
        "failure",
        Date.now() - startTime,
        error instanceof Error ? error.message : "Unknown error",
      );
      throw error;
    }
  }

  /**
   * Process upload results and trigger file uploads as needed
   */
  private async processUploadResults(
    results: BookSyncResult[],
    booksToSync: Book[],
  ): Promise<void> {
    for (const result of results) {
      const book = booksToSync.find((b) => b.fileHash === result.fileHash);
      if (!book) continue;

      if (result.status === "created" || result.status === "updated") {
        // Mark as pending upload if we need to upload files
        await setBookSyncState({
          fileHash: result.fileHash,
          status: "pending_upload",
          lastSyncedAt: new Date(),
          epubUploaded: false,
          coverUploaded: false,
          retryCount: 0,
        });

        // Upload files using upload service
        const uploadResult = await bookUploadService.uploadBookFiles(book);

        // Log the result
        await this.logSync(
          "push",
          "book",
          result.fileHash,
          result.status === "created" ? "create" : "update",
          uploadResult.success ? "success" : "failure",
          undefined,
          uploadResult.error,
        );
      } else if (result.status === "exists") {
        // Book already exists on server, mark as synced
        await setBookSyncState({
          fileHash: result.fileHash,
          status: "synced",
          lastSyncedAt: new Date(),
          epubUploaded: true,
          coverUploaded: true,
          retryCount: 0,
        });

        await this.logSync(
          "push",
          "book",
          result.fileHash,
          "update",
          "success",
        );
      }
    }
  }

  /**
   * Get books that need to be synced to server
   */
  private async getBooksToSync(): Promise<Book[]> {
    // Get all downloaded local books
    const allBooks = await db.books.where("isDownloaded").equals(1).toArray();

    // Get sync states
    const syncStates = await db.bookSyncState.toArray();
    const syncStateMap = new Map(syncStates.map((s) => [s.fileHash, s]));

    // Filter to books that haven't been synced or have errors
    return allBooks.filter((book) => {
      const state = syncStateMap.get(book.fileHash);
      if (!state) return true; // Never synced
      if (state.status === "error" && state.retryCount < 3) return true; // Retry errors
      if (state.status === "pending_upload") return true; // Pending upload
      return false;
    });
  }

  /**
   * Downloads cover images for books that need them.
   * Delegates to BookDownloadService.
   *
   * @param fileHashes Optional array of file hashes to filter which covers to download
   */
  async downloadCoverImages(fileHashes?: string[]): Promise<void> {
    await bookDownloadService.downloadCoverImages({ fileHashes });
  }

  /**
   * Downloads the full EPUB content for a specific book.
   * Delegates to BookDownloadService.
   *
   * This is a heavy operation that downloads and extracts all EPUB files.
   * Should ONLY be called on-demand when the user wants to read a book.
   *
   * @param fileHash The book's file hash
   * @throws Error if book not found or download fails
   */
  async downloadBook(fileHash: string): Promise<void> {
    const startTime = Date.now();

    try {
      await bookDownloadService.downloadBook(fileHash);

      await this.logSync(
        "pull",
        "book",
        fileHash,
        "download",
        "success",
        Date.now() - startTime,
      );
    } catch (error) {
      await this.logSync(
        "pull",
        "book",
        fileHash,
        "download",
        "failure",
        Date.now() - startTime,
        error instanceof Error ? error.message : "Unknown error",
      );
      throw error;
    }
  }

  /**
   * Deletes a book from both server and local storage
   *
   * @param bookId The book's ID
   */
  async deleteBook(bookId: string): Promise<void> {
    const book = await db.books.get(bookId);
    if (!book) {
      throw new Error("Book not found");
    }

    try {
      // Delete on server first (soft delete)
      const response = await honoClient.api.sync.books[":fileHash"].$delete({
        param: { fileHash: book.fileHash },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // If it's 404, the book doesn't exist on server, which is fine
        if (response.status !== 404) {
          throw new Error(
            `Failed to delete book on server: ${(errorData as { error?: string }).error ?? response.status}`,
          );
        }
      }

      // Delete locally
      await db.transaction(
        "rw",
        [
          db.books,
          db.bookFiles,
          db.readingProgress,
          db.highlights,
          db.bookSyncState,
        ],
        async () => {
          await db.books.delete(bookId);
          await db.bookFiles.where("bookId").equals(bookId).delete();
          await db.readingProgress.delete(bookId);
          await db.highlights.where("bookId").equals(bookId).delete();
          await db.bookSyncState.delete(book.fileHash);
        },
      );

      await this.logSync("push", "book", book.fileHash, "delete", "success");

      // Invalidate queries
      this.invalidateBookQueries();

      console.log(`[SyncService] Deleted book: ${book.title}`);
    } catch (error) {
      await this.logSync(
        "push",
        "book",
        book.fileHash,
        "delete",
        "failure",
        undefined,
        error instanceof Error ? error.message : "Unknown error",
      );
      throw error;
    }
  }

  /**
   * Invalidate TanStack Query book-related queries
   */
  private invalidateBookQueries(bookId?: string): void {
    if (!this.queryClient) {
      console.warn("[SyncService] QueryClient not set, skipping invalidation");
      return;
    }

    if (bookId) {
      // Invalidate specific book
      this.queryClient.invalidateQueries({
        queryKey: bookKeys.detail(bookId),
      });
      this.queryClient.invalidateQueries({
        queryKey: bookKeys.progress(bookId),
      });
    }

    // Always invalidate the book list and all books queries
    this.queryClient.invalidateQueries({
      queryKey: bookKeys.list(),
    });
    this.queryClient.invalidateQueries({
      queryKey: bookKeys.all,
    });
  }

  /**
   * Log a sync operation for debugging
   */
  private async logSync(
    direction: SyncLog["direction"],
    entityType: SyncLog["entityType"],
    entityId: string,
    action: SyncLog["action"],
    status: SyncLog["status"],
    durationMs?: number,
    errorMessage?: string,
  ): Promise<void> {
    try {
      await addSyncLog({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        direction,
        entityType,
        entityId,
        action,
        status,
        durationMs,
        errorMessage,
      });
    } catch (error) {
      console.error("[SyncService] Failed to write sync log:", error);
    }
  }

  /**
   * Get the current sync state for a book
   */
  async getBookSyncState(fileHash: string): Promise<BookSyncState | undefined> {
    return await db.bookSyncState.get(fileHash);
  }

  /**
   * Check if the sync service is currently syncing
   */
  get syncing(): boolean {
    return this.isSyncing;
  }
}

// Export singleton instance
export const syncService = new SyncService();

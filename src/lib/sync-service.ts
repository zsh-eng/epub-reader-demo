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
import type { QueryClient } from "@tanstack/react-query";

// Types for server responses
interface ServerBook {
  id: string;
  fileHash: string;
  title: string;
  author: string;
  fileSize: number;
  metadata: Record<string, unknown> | null;
  epubR2Key: string | null;
  coverR2Key: string | null;
  coverUrl: string | null;
  epubUrl: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  deletedAt: number | null;
}

interface SyncBooksResponse {
  books: ServerBook[];
  serverTimestamp: number;
}

interface BookSyncResult {
  fileHash: string;
  status: "created" | "updated" | "exists";
  serverId: string;
  epubUploadUrl: string | null;
  coverUploadUrl: string | null;
}

interface PushBooksResponse {
  results: BookSyncResult[];
}

// Sync cursor ID for books
const BOOKS_SYNC_CURSOR_ID = "books";

/**
 * SyncService handles bidirectional synchronization of books between
 * the local IndexedDB and the server.
 *
 * Key responsibilities:
 * - Pull: Fetch book changes from server since last sync
 * - Push: Send local book changes to server
 * - Upload: Send EPUB and cover files to R2
 * - Download: Fetch EPUB files from R2 when needed
 * - Invalidate: Notify TanStack Query when data changes
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
   *                       Default: false (metadata only)
   */
  async sync(downloadCovers: boolean = true): Promise<void> {
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

      // Pull first to get latest server state
      await this.pull();

      // Then push local changes
      await this.push();

      // Optionally download cover images for newly synced books
      if (downloadCovers) {
        await this.downloadCoverImages();
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

      // Process each book from server
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

    // Handle deletion
    if (serverBook.deletedAt) {
      if (existingBook) {
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
            await db.highlights
              .where("bookId")
              .equals(existingBook.id)
              .delete();
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
      return false;
    }

    // Handle new book from server (not downloaded locally yet)
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
      for (const result of data.results) {
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

          // Upload files
          await this.uploadBookFiles(book);
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
        }

        await this.logSync(
          "push",
          "book",
          result.fileHash,
          result.status === "created" ? "create" : "update",
          "success",
        );
      }

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
   * Get books that need to be synced to server
   */
  private async getBooksToSync(): Promise<Book[]> {
    // Get all downloaded local books
    const allBooks = await db.books.where("isDownloaded").equals(1).toArray();
    console.log("allbooks", allBooks);

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
   * Upload EPUB and cover files for a book
   */
  private async uploadBookFiles(book: Book): Promise<void> {
    try {
      // Update status to uploading
      await setBookSyncState({
        fileHash: book.fileHash,
        status: "uploading",
        lastSyncedAt: new Date(),
        epubUploaded: false,
        coverUploaded: false,
        retryCount: 0,
      });

      // Get all book files and reconstruct the EPUB
      const bookFiles = await db.bookFiles
        .where("bookId")
        .equals(book.id)
        .toArray();

      if (bookFiles.length === 0) {
        throw new Error("No files found for book");
      }

      // Create a zip file from the book files using the same structure
      const { zip } = await import("fflate");

      // Convert book files to the format fflate expects
      const fileEntries: Record<string, Uint8Array> = {};
      for (const file of bookFiles) {
        const arrayBuffer = await file.content.arrayBuffer();
        fileEntries[file.path] = new Uint8Array(arrayBuffer);
      }

      // Zip synchronously (fflate is fast enough for this)
      const zipped = await new Promise<Uint8Array>((resolve, reject) => {
        zip(fileEntries, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

      const epubBlob = new Blob([new Uint8Array(zipped)], {
        type: "application/epub+zip",
      });
      const epubFile = new File([epubBlob], `${book.fileHash}.epub`, {
        type: "application/epub+zip",
      });

      // Get cover file if available
      let coverFile: File | undefined;
      if (book.coverImagePath) {
        const coverBookFile = await db.bookFiles
          .where("bookId")
          .equals(book.id)
          .and((f) => f.path === book.coverImagePath)
          .first();

        if (coverBookFile) {
          // Determine file extension from path
          const ext =
            book.coverImagePath.split(".").pop()?.toLowerCase() || "jpg";
          const mimeType =
            ext === "png"
              ? "image/png"
              : ext === "gif"
                ? "image/gif"
                : ext === "webp"
                  ? "image/webp"
                  : "image/jpeg";

          coverFile = new File(
            [coverBookFile.content],
            `${book.fileHash}.${ext}`,
            { type: mimeType },
          );
        }
      }

      // Upload both files in a single request
      const formData = new FormData();
      formData.append("epub", epubFile);
      if (coverFile) {
        formData.append("cover", coverFile);
      }

      const response = await fetch(`/api/sync/books/${book.fileHash}/files`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `File upload failed: ${(errorData as { error?: string }).error ?? response.status}`,
        );
      }

      // Mark as synced
      await setBookSyncState({
        fileHash: book.fileHash,
        status: "synced",
        lastSyncedAt: new Date(),
        epubUploaded: true,
        coverUploaded: !!coverFile,
        retryCount: 0,
      });

      console.log(`[SyncService] Uploaded files for: ${book.title}`);
    } catch (error) {
      // Get current state to increment retry count
      const currentState = await db.bookSyncState.get(book.fileHash);
      const retryCount = (currentState?.retryCount ?? 0) + 1;

      await setBookSyncState({
        fileHash: book.fileHash,
        status: "error",
        lastSyncedAt: new Date(),
        epubUploaded: currentState?.epubUploaded ?? false,
        coverUploaded: currentState?.coverUploaded ?? false,
        errorMessage: error instanceof Error ? error.message : "Upload failed",
        retryCount,
      });

      console.error(
        `[SyncService] Failed to upload files for: ${book.title}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Download the EPUB file for a remote book
   */
  /**
   * Downloads cover images for books that don't have them yet.
   *
   * This is a separate operation from metadata sync to allow for:
   * - Bandwidth efficiency: Only download covers when needed for UI
   * - Selective downloads: Download covers for specific books
   * - Background operation: Can run after sync without blocking
   *
   * Call this after `pull()` to populate the library view with cover images.
   *
   * @param fileHashes Optional array of specific books to download covers for.
   *                   If not provided, downloads all books that have a remoteCoverUrl but no local cover.
   *
   * @example
   * // Download all missing covers
   * await syncService.downloadCoverImages();
   *
   * // Download covers for specific books
   * await syncService.downloadCoverImages(['hash1', 'hash2']);
   */
  async downloadCoverImages(fileHashes?: string[]): Promise<void> {
    const startTime = Date.now();
    console.log("[Sync] Starting cover image download...");

    try {
      const allBooks = await db.books.toArray();
      const booksNeedingCovers = allBooks.filter((book) => {
        const needsCover = !book.coverImagePath && !book.isDownloaded;
        if (fileHashes) {
          return needsCover && fileHashes.includes(book.fileHash);
        }
        return needsCover;
      });

      console.log(
        `[Sync] Found ${booksNeedingCovers.length} books needing covers`,
      );

      for (const book of booksNeedingCovers) {
        try {
          console.log(`[Sync] Downloading cover for: ${book.title}`);

          if (!book.remoteCoverUrl) {
            console.error(`[Sync] No remote cover URL for ${book.title}`);
            continue;
          }

          const response = await fetch(book.remoteCoverUrl, {
            credentials: "include",
          });

          if (!response.ok) {
            console.error(
              `[Sync] Failed to download cover for ${book.title}:`,
              response.statusText,
            );
            continue;
          }

          const coverBlob = await response.blob();

          // Determine the media type from the blob
          let mediaType = coverBlob.type;
          if (!mediaType || mediaType === "application/octet-stream") {
            // Try to infer from the first few bytes
            const coverArrayBuffer = await coverBlob.arrayBuffer();
            const coverContent = new Uint8Array(coverArrayBuffer);
            if (coverContent[0] === 0xff && coverContent[1] === 0xd8) {
              mediaType = "image/jpeg";
            } else if (coverContent[0] === 0x89 && coverContent[1] === 0x50) {
              mediaType = "image/png";
            }
          }

          // Store the cover image in book_files
          const coverPath = book.coverImagePath || "cover.jpg";
          await db.bookFiles.put({
            id: `${book.id}-${coverPath}`,
            bookId: book.id,
            path: coverPath,
            content: coverBlob,
            mediaType: mediaType,
          });

          // Update the book's coverImagePath if it wasn't set
          // This ensures BookCard can find the cover
          if (!book.coverImagePath) {
            await db.books.update(book.id, { coverImagePath: coverPath });
          }

          console.log(
            `[Sync] Successfully downloaded cover for: ${book.title}`,
          );

          // Invalidate queries so UI updates with the new cover
          this.invalidateBookQueries(book.id);
        } catch (error) {
          console.error(
            `[Sync] Error downloading cover for ${book.title}:`,
            error,
          );
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[Sync] Cover download completed in ${duration}ms`);
    } catch (error) {
      console.error("[Sync] Cover download failed:", error);
      throw error;
    }
  }

  /**
   * Downloads the full EPUB content for a specific book.
   *
   * This is a heavy operation that downloads and extracts all EPUB files.
   * Should ONLY be called on-demand when the user wants to read a book.
   *
   * The EPUB content is:
   * - Downloaded from the remote server
   * - Unzipped and extracted
   * - Stored in IndexedDB for offline reading
   * - Parsed to update book metadata (manifest, spine, TOC)
   *
   * @param fileHash The book's file hash
   *
   * @throws Error if book not found or download fails
   *
   * @example
   * // Download book when user clicks "Read"
   * try {
   *   await syncService.downloadBook(book.fileHash);
   *   // Now the book is available for offline reading
   * } catch (error) {
   *   console.error("Failed to download book:", error);
   * }
   */
  async downloadBook(fileHash: string): Promise<void> {
    // TODO: Sync service should handle already downloading the book
    const book = await db.books.where("fileHash").equals(fileHash).first();
    if (!book) {
      throw new Error("Book not found");
    }

    if (book.isDownloaded) {
      console.log(`[SyncService] Book already downloaded: ${book.title}`);
      return;
    }

    if (!book.remoteEpubUrl) {
      throw new Error("No remote EPUB URL available");
    }

    const startTime = Date.now();

    try {
      // Update sync state
      await setBookSyncState({
        fileHash: book.fileHash,
        status: "pending_download",
        epubUploaded: true,
        coverUploaded: true,
        retryCount: 0,
      });

      console.log(`[SyncService] Downloading book: ${book.title}`);

      // Fetch the EPUB from server
      const response = await fetch(book.remoteEpubUrl, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to download EPUB: ${response.status}`);
      }

      const epubBlob = await response.blob();
      const epubArrayBuffer = await epubBlob.arrayBuffer();
      const epubUint8Array = new Uint8Array(epubArrayBuffer);

      // Parse the EPUB and extract files using fflate
      const { unzip } = await import("fflate");

      const unzipped = await new Promise<Record<string, Uint8Array>>(
        (resolve, reject) => {
          unzip(epubUint8Array, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        },
      );

      // Extract and store all files
      for (const [relativePath, content] of Object.entries(unzipped)) {
        // Determine media type from extension
        let mediaType = "application/octet-stream";
        if (relativePath.endsWith(".xhtml") || relativePath.endsWith(".html")) {
          mediaType = "application/xhtml+xml";
        } else if (relativePath.endsWith(".xml")) {
          mediaType = "application/xml";
        } else if (relativePath.endsWith(".css")) {
          mediaType = "text/css";
        } else if (
          relativePath.endsWith(".jpg") ||
          relativePath.endsWith(".jpeg")
        ) {
          mediaType = "image/jpeg";
        } else if (relativePath.endsWith(".png")) {
          mediaType = "image/png";
        } else if (relativePath.endsWith(".gif")) {
          mediaType = "image/gif";
        } else if (relativePath.endsWith(".svg")) {
          mediaType = "image/svg+xml";
        } else if (relativePath.endsWith(".ncx")) {
          mediaType = "application/x-dtbncx+xml";
        } else if (relativePath.endsWith(".opf")) {
          mediaType = "application/oebps-package+xml";
        }

        await db.bookFiles.add({
          id: crypto.randomUUID(),
          bookId: book.id,
          path: relativePath,
          content: new Blob([new Uint8Array(content)]),
          mediaType,
        });
      }

      // Parse the EPUB to get manifest, spine, toc
      const { parseEPUBMetadataOnly } = await import("@/lib/epub-parser");
      const metadata = await parseEPUBMetadataOnly(epubBlob);

      // Update book with full metadata and mark as downloaded
      await db.books.update(book.id, {
        manifest: metadata.manifest,
        spine: metadata.spine,
        toc: metadata.toc,
        coverImagePath: metadata.coverImagePath,
        isDownloaded: 1,
      });

      // Update sync state
      await setBookSyncState({
        fileHash: book.fileHash,
        status: "synced",
        lastSyncedAt: new Date(),
        epubUploaded: true,
        coverUploaded: true,
        retryCount: 0,
      });

      console.log(`[SyncService] Downloaded book: ${book.title}`);
      await this.logSync(
        "pull",
        "book",
        book.fileHash,
        "download",
        "success",
        Date.now() - startTime,
      );

      // Invalidate queries
      this.invalidateBookQueries(book.id);
    } catch (error) {
      // Update sync state with error
      const currentState = await db.bookSyncState.get(book.fileHash);
      await setBookSyncState({
        fileHash: book.fileHash,
        status: "error",
        epubUploaded: currentState?.epubUploaded ?? false,
        coverUploaded: currentState?.coverUploaded ?? false,
        errorMessage:
          error instanceof Error ? error.message : "Download failed",
        retryCount: (currentState?.retryCount ?? 0) + 1,
      });

      await this.logSync(
        "pull",
        "book",
        book.fileHash,
        "download",
        "failure",
        Date.now() - startTime,
        error instanceof Error ? error.message : "Unknown error",
      );

      throw error;
    }
  }

  /**
   * Delete a book both locally and on server
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

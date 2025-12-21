/**
 * Book Download Service
 *
 * Handles downloading books and cover images from the server.
 * Responsibilities:
 * - Download full EPUB content and extract files
 * - Download cover images for library view
 * - Handle download errors and retries
 * - Update sync state during downloads
 * - Save original EPUB blob for potential re-upload
 */

import { db, setBookSyncState, saveEpubBlob, type Book } from "@/lib/db";
import type { QueryClient } from "@tanstack/react-query";
import type { DownloadCoverOptions, DownloadResult } from "./types";
import { detectMediaTypeFromBlob, handleFetchError, pLimit } from "./utils";
import { processEpubToBookFiles } from "./epub-processing";

export class BookDownloadService {
  private queryClient: QueryClient | null = null;

  setQueryClient(queryClient: QueryClient): void {
    this.queryClient = queryClient;
  }

  /**
   * Downloads cover images for books that need them.
   * Uses parallel downloads with concurrency limit.
   *
   * @param options Options for filtering which covers to download
   * @returns Array of download results
   */
  async downloadCoverImages(
    options: DownloadCoverOptions = {},
  ): Promise<DownloadResult[]> {
    const startTime = Date.now();
    console.log("[BookDownload] Starting cover image download...");

    try {
      const allBooks = await db.books.toArray();
      const booksNeedingCovers = allBooks.filter((book) => {
        const needsCover = !book.coverImagePath && !book.isDownloaded;
        if (options.fileHashes) {
          return needsCover && options.fileHashes.includes(book.fileHash);
        }
        return needsCover;
      });

      console.log(
        `[BookDownload] Found ${booksNeedingCovers.length} books needing covers`,
      );

      if (booksNeedingCovers.length === 0) {
        return [];
      }

      // Download covers in parallel with concurrency limit
      const results = await pLimit(
        3, // Max 3 concurrent downloads
        booksNeedingCovers,
        (book) => this.downloadSingleCover(book),
      );

      const successCount = results.filter((r) => r.success).length;
      const duration = Date.now() - startTime;
      console.log(
        `[BookDownload] Cover download completed: ${successCount}/${results.length} successful in ${duration}ms`,
      );

      return results;
    } catch (error) {
      console.error("[BookDownload] Cover download failed:", error);
      throw error;
    }
  }

  /**
   * Downloads a single cover image for a book
   */
  private async downloadSingleCover(book: Book): Promise<DownloadResult> {
    try {
      console.log(`[BookDownload] Downloading cover for: ${book.title}`);

      if (!book.remoteCoverUrl) {
        return {
          success: false,
          fileHash: book.fileHash,
          error: "No remote cover URL",
        };
      }

      const response = await fetch(book.remoteCoverUrl, {
        credentials: "include",
      });

      if (!response.ok) {
        await handleFetchError(response);
      }

      const coverBlob = await response.blob();

      // Determine media type
      const mediaType =
        (await detectMediaTypeFromBlob(coverBlob)) || "image/jpeg";

      // Determine cover path
      const ext = mediaType.split("/")[1] || "jpg";
      const coverPath = book.coverImagePath || `cover.${ext}`;

      // Store the cover image in book_files
      await db.bookFiles.put({
        id: `${book.id}-${coverPath}`,
        bookId: book.id,
        path: coverPath,
        content: coverBlob,
        mediaType: mediaType,
      });

      // Update the book's coverImagePath if it wasn't set
      if (!book.coverImagePath) {
        await db.books.update(book.id, { coverImagePath: coverPath });
      }

      console.log(
        `[BookDownload] Successfully downloaded cover for: ${book.title}`,
      );

      // Invalidate queries so UI updates
      this.invalidateBookQueries(book.id);

      return {
        success: true,
        fileHash: book.fileHash,
      };
    } catch (error) {
      console.error(
        `[BookDownload] Error downloading cover for ${book.title}:`,
        error,
      );
      return {
        success: false,
        fileHash: book.fileHash,
        error: error instanceof Error ? error.message : "Unknown error",
      };
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
   * - Stored as original EPUB blob (for potential re-upload)
   * - Unzipped and extracted
   * - Stored in IndexedDB for offline reading
   * - Parsed to update book metadata (manifest, spine, TOC)
   *
   * @param fileHash The book's file hash
   * @throws Error if book not found or download fails
   */
  async downloadBook(fileHash: string): Promise<void> {
    const book = await db.books.where("fileHash").equals(fileHash).first();
    if (!book) {
      throw new Error("Book not found");
    }

    if (book.isDownloaded) {
      console.log(`[BookDownload] Book already downloaded: ${book.title}`);
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

      console.log(`[BookDownload] Downloading book: ${book.title}`);

      // Fetch the EPUB from server
      const response = await fetch(book.remoteEpubUrl, {
        credentials: "include",
      });

      if (!response.ok) {
        await handleFetchError(response);
      }

      const epubBlob = await response.blob();
      // Save the original EPUB blob for potential re-upload
      await saveEpubBlob(book.fileHash, epubBlob);
      const bookFiles = await processEpubToBookFiles(epubBlob, book.id);

      // Batch insert all files
      await db.bookFiles.bulkAdd(bookFiles);

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

      const duration = Date.now() - startTime;
      console.log(
        `[BookDownload] Downloaded book: ${book.title} in ${duration}ms`,
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

      console.error(
        `[BookDownload] Failed to download book: ${book.title}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Invalidate TanStack Query book-related queries
   */
  private invalidateBookQueries(bookId?: string): void {
    if (!this.queryClient) {
      console.warn("[BookDownload] QueryClient not set, skipping invalidation");
      return;
    }

    if (bookId) {
      // Invalidate specific book queries
      this.queryClient.invalidateQueries({
        queryKey: ["book", bookId],
      });
      this.queryClient.invalidateQueries({
        queryKey: ["book", bookId, "progress"],
      });
    }

    // Always invalidate the book list
    this.queryClient.invalidateQueries({
      queryKey: ["books"],
    });
  }
}

// Export singleton instance
export const bookDownloadService = new BookDownloadService();

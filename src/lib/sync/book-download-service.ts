/**
 * Book Download Service
 *
 * Handles downloading books and cover images from the server.
 * Uses the FileManager for all file operations, which handles:
 * - Local caching in IndexedDB
 * - Network fetching when not cached
 * - Request deduplication
 *
 * Responsibilities:
 * - Download full EPUB content and extract files
 * - Handle download errors
 * - Update book metadata after download
 */

import { db, saveEpubBlob } from "@/lib/db";
import { fileManager } from "@/lib/files";
import { isNotDeleted } from "@/lib/sync/hlc/middleware";
import type { QueryClient } from "@tanstack/react-query";
import { processEpubToBookFiles } from "./epub-processing";

export class BookDownloadService {
  private queryClient: QueryClient | null = null;

  setQueryClient(queryClient: QueryClient): void {
    this.queryClient = queryClient;
  }

  /**
   * Downloads the full EPUB content for a specific book.
   *
   * This is a heavy operation that downloads and extracts all EPUB files.
   * Should ONLY be called on-demand when the user wants to read a book.
   *
   * The EPUB content is:
   * - Downloaded via FileManager (handles caching automatically)
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
    if (!book || !isNotDeleted(book)) {
      throw new Error("Book not found");
    }

    if (book.isDownloaded) {
      console.log(`[BookDownload] Book already downloaded: ${book.title}`);
      return;
    }

    // Check if the book has a remote EPUB available
    if (!book.hasRemoteEpub) {
      throw new Error("No remote EPUB available for this book");
    }

    const startTime = Date.now();

    try {
      console.log(`[BookDownload] Downloading book: ${book.title}`);

      // Fetch the EPUB via FileManager (handles caching)
      const result = await fileManager.getFile(fileHash, "epub");
      const epubBlob = result.blob;

      console.log(
        `[BookDownload] EPUB fetched (fromCache: ${result.fromCache})`,
      );

      // Save the original EPUB blob for potential re-upload
      await saveEpubBlob(book.fileHash, epubBlob);

      // Process EPUB into individual book files for rendering
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

      const duration = Date.now() - startTime;
      console.log(
        `[BookDownload] Downloaded book: ${book.title} in ${duration}ms`,
      );

      // Invalidate queries
      this.invalidateBookQueries(book.id);
    } catch (error) {
      console.error(
        `[BookDownload] Failed to download book: ${book.title}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Check if a book's EPUB is available locally (already downloaded)
   */
  async isBookAvailableLocally(fileHash: string): Promise<boolean> {
    return fileManager.hasLocal(fileHash, "epub");
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

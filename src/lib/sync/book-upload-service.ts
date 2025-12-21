/**
 * Book Upload Service
 *
 * Handles uploading book files (EPUB and covers) to the server.
 * Responsibilities:
 * - Zip book files and upload to server
 * - Extract cover images for upload
 * - Handle upload errors and retries
 * - Update sync state during uploads
 */

import { db, setBookSyncState, type Book } from "@/lib/db";
import { getMediaTypeFromPath, handleFetchError } from "./utils";
import type { UploadResult } from "./types";

export class BookUploadService {
  /**
   * Uploads book files (EPUB + cover) to the server.
   * Creates a zip from book files and sends via multipart form data.
   *
   * @param book The book to upload
   * @returns Upload result with status
   */
  async uploadBookFiles(book: Book): Promise<UploadResult> {
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

      console.log(`[BookUpload] Uploading files for: ${book.title}`);

      // Get all book files and reconstruct the EPUB
      const bookFiles = await db.bookFiles
        .where("bookId")
        .equals(book.id)
        .toArray();

      if (bookFiles.length === 0) {
        throw new Error("No files found for book");
      }

      // Create EPUB file
      const epubFile = await this.createEpubFile(book, bookFiles);

      // Get cover file if available
      const coverFile = await this.extractCoverFile(book);

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
        await handleFetchError(response);
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

      console.log(
        `[BookUpload] Successfully uploaded files for: ${book.title}`,
      );

      return {
        success: true,
        fileHash: book.fileHash,
        epubUploaded: true,
        coverUploaded: !!coverFile,
      };
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
        `[BookUpload] Failed to upload files for: ${book.title}`,
        error,
      );

      return {
        success: false,
        fileHash: book.fileHash,
        epubUploaded: false,
        coverUploaded: false,
        error: error instanceof Error ? error.message : "Upload failed",
      };
    }
  }

  /**
   * Creates an EPUB file by zipping all book files
   */
  private async createEpubFile(
    book: Book,
    bookFiles: Array<{ path: string; content: Blob }>,
  ): Promise<File> {
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

    return new File([epubBlob], `${book.fileHash}.epub`, {
      type: "application/epub+zip",
    });
  }

  /**
   * Extracts the cover file from book files if available
   */
  private async extractCoverFile(book: Book): Promise<File | undefined> {
    if (!book.coverImagePath) {
      return undefined;
    }

    const coverBookFile = await db.bookFiles
      .where("bookId")
      .equals(book.id)
      .and((f) => f.path === book.coverImagePath)
      .first();

    if (!coverBookFile) {
      return undefined;
    }

    // Determine file extension and MIME type from path
    const ext = book.coverImagePath.split(".").pop()?.toLowerCase() || "jpg";
    const mimeType = getMediaTypeFromPath(`cover.${ext}`);

    return new File([coverBookFile.content], `${book.fileHash}.${ext}`, {
      type: mimeType,
    });
  }

  /**
   * Uploads multiple books in sequence with error handling
   * Returns results for all uploads
   */
  async uploadMultipleBooks(books: Book[]): Promise<UploadResult[]> {
    const results: UploadResult[] = [];

    for (const book of books) {
      const result = await this.uploadBookFiles(book);
      results.push(result);

      // Continue with other books even if one fails
      if (!result.success) {
        console.warn(
          `[BookUpload] Failed to upload ${book.title}, continuing with remaining books`,
        );
      }
    }

    return results;
  }
}

// Export singleton instance
export const bookUploadService = new BookUploadService();

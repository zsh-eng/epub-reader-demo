/**
 * Book Upload Service
 *
 * Handles uploading book files (EPUB and covers) to the server.
 * Responsibilities:
 * - Upload stored EPUB blobs to server
 * - Extract cover images for upload
 * - Handle upload errors and retries
 * - Update sync state during uploads
 * - Clean up EPUB blobs after successful upload
 */

import { deleteEpubBlob, getEpubBlob, type Book } from "@/lib/db";
import { createEpubFile } from "./epub-processing";
import type { UploadResult } from "./types";
import { getMediaTypeFromPath, handleFetchError } from "./utils";

export class BookUploadService {
  /**
   * Uploads book files (EPUB + cover) to the server.
   * Uses the stored original EPUB blob instead of recreating it.
   *
   * @param book The book to upload
   * @returns Upload result with status
   */
  async uploadBookFiles(book: Book): Promise<UploadResult> {
    try {
      console.log(`[BookUpload] Uploading files for: ${book.title}`);

      // Get the stored EPUB blob
      const epubBlobRecord = await getEpubBlob(book.fileHash);
      if (!epubBlobRecord) {
        throw new Error("Original EPUB blob not found");
      }

      const epubFile = createEpubFile(epubBlobRecord.blob, book.fileHash);
      const coverFile = await this.extractCoverFile(book);

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

      // Clean up EPUB blob after successful upload
      await deleteEpubBlob(book.fileHash);
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
   * Extracts the cover file from book files if available
   */
  private async extractCoverFile(book: Book): Promise<File | undefined> {
    if (!book.coverImagePath) {
      return undefined;
    }

    const { db } = await import("@/lib/db");
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

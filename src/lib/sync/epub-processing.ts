/**
 * EPUB Processing Utilities
 *
 * Shared utilities for processing EPUB files across different services.
 * Handles common operations like:
 * - Converting between Blob and ArrayBuffer
 * - Extracting EPUB contents
 * - Creating File objects from blobs
 *
 ## EPUB File Lifecycle

  * The original EPUB file is preserved in IndexedDB until successfully synced:
  *
  * 1. **User adds book**: Original EPUB blob is stored in `files` table
  *    - Stored alongside cover image (if available)
  *    - Content-addressed by fileHash
  *    - Also extracted into book files for reading
  *
  * 2. **Upload to server**: Stored EPUB blob is retrieved from `files` table
  *    - No need to recreate EPUB from individual files
  *    - Preserves exact original file
  *
  * 3. **After successful upload**: EPUB blob can be deleted from `files` table
  *    - Saves storage space
  *    - Book files remain for offline reading
  *
  * 4. **Download from server**: Downloaded EPUB blob is stored in `files` table
  *    - Enables potential re-upload to another device/account
  *    - Also extracted into book files for reading
  *
  * 5. **Book deletion**: Book files are deleted (EPUB and cover remain in `files` table)
  *    - Files table entries can be cleaned up separately if not referenced
 */

import type { BookFile } from "@/lib/db";
import { getMediaTypeFromPath } from "./utils";

/**
 * Extracts all files from an EPUB blob
 * @param epubBlob The EPUB file as a Blob
 * @returns Array of extracted files with paths and content
 */
export async function extractEpubFiles(
  epubBlob: Blob,
): Promise<Record<string, Uint8Array>> {
  const { unzip } = await import("fflate");

  const epubArrayBuffer = await epubBlob.arrayBuffer();
  const epubUint8Array = new Uint8Array(epubArrayBuffer);

  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(epubUint8Array, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/**
 * Converts extracted EPUB files to BookFile format for database storage
 * @param extractedFiles Files from extractEpubFiles()
 * @param bookId The book ID to associate with these files
 * @returns Array of BookFile objects ready for database insertion
 */
export function createBookFilesFromExtracted(
  extractedFiles: Record<string, Uint8Array>,
  bookId: string,
): BookFile[] {
  const bookFiles: BookFile[] = [];

  for (const [relativePath, content] of Object.entries(extractedFiles)) {
    const mediaType = getMediaTypeFromPath(relativePath);
    const contentBlob = new Blob([new Uint8Array(content)]);

    bookFiles.push({
      id: crypto.randomUUID(),
      bookId,
      path: relativePath,
      content: contentBlob,
      mediaType,
    });
  }

  return bookFiles;
}

/**
 * Creates a File object from a Blob with proper EPUB MIME type
 * @param blob The EPUB content as a Blob
 * @param fileHash The file hash to use as filename
 * @returns File object ready for upload
 */
export function createEpubFile(blob: Blob, fileHash: string): File {
  return new File([blob], `${fileHash}.epub`, {
    type: "application/epub+zip",
  });
}

/**
 * Extracts and processes an EPUB blob into database-ready BookFiles
 * This is a convenience function that combines extraction and conversion
 * @param epubBlob The EPUB file as a Blob
 * @param bookId The book ID to associate with these files
 * @returns Array of BookFile objects ready for database insertion
 */
export async function processEpubToBookFiles(
  epubBlob: Blob,
  bookId: string,
): Promise<BookFile[]> {
  const extractedFiles = await extractEpubFiles(epubBlob);
  return createBookFilesFromExtracted(extractedFiles, bookId);
}

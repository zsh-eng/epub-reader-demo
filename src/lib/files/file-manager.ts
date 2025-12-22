/**
 * File Manager
 *
 * The main facade for file access. Abstracts whether files come from
 * local storage (IndexedDB) or the network (server/R2).
 *
 * Consuming code simply requests a file, and FileManager handles:
 * - Checking local cache first
 * - Fetching from network if not cached
 * - Storing fetched files locally for future access
 * - Deduplicating in-flight requests
 * - Managing uploads and downloads via transfer queue
 */

import { fileStorage } from "@/lib/files/file-storage";
import { transferQueue } from "@/lib/files/transfer-queue";
import type {
  FileFetchResult,
  FileGetOptions,
  FileType,
  Priority,
  TransferProgress,
} from "@/lib/files/types";

/**
 * FileManager provides a simple interface for file access.
 * It's the single entry point for getting files - consumers don't need
 * to know whether files are local or remote.
 */
class FileManager {
  /**
   * In-flight request deduplication map.
   * Prevents multiple simultaneous fetches for the same file.
   */
  private inFlightRequests = new Map<string, Promise<FileFetchResult>>();

  /**
   * Get a file by its content hash and type.
   *
   * This method:
   * 1. Checks local storage first
   * 2. If not found and network allowed, fetches from server
   * 3. Caches the fetched file locally
   * 4. Returns the blob
   *
   * @param contentHash - The content hash (e.g., book's fileHash)
   * @param fileType - Type of file ('epub' or 'cover')
   * @param options - Optional settings (e.g., localOnly)
   * @returns The file blob and metadata
   * @throws Error if file not found locally and network fetch fails
   */
  async getFile(
    contentHash: string,
    fileType: FileType,
    options: FileGetOptions = {},
  ): Promise<FileFetchResult> {
    // Check local storage first
    const localFile = await fileStorage.get(contentHash, fileType);
    if (localFile) {
      return {
        blob: localFile.blob,
        mediaType: localFile.mediaType,
        fromCache: true,
      };
    }

    // If local-only mode, throw error
    if (options.localOnly) {
      throw new Error(`File not found locally: ${fileType}:${contentHash}`);
    }

    // Check for in-flight request to deduplicate
    const requestKey = `${fileType}:${contentHash}`;
    const existingRequest = this.inFlightRequests.get(requestKey);
    if (existingRequest) {
      return existingRequest;
    }

    // Fetch from network
    const fetchPromise = this.fetchAndStore(contentHash, fileType);

    // Store in-flight request for deduplication
    this.inFlightRequests.set(requestKey, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      // Clean up in-flight request
      this.inFlightRequests.delete(requestKey);
    }
  }

  /**
   * Check if a file exists locally (no network request)
   */
  async hasLocal(contentHash: string, fileType: FileType): Promise<boolean> {
    return fileStorage.has(contentHash, fileType);
  }

  /**
   * Store a file locally (used after processing, e.g., after EPUB extraction)
   */
  async storeFile(
    contentHash: string,
    fileType: FileType,
    blob: Blob,
    mediaType: string,
  ): Promise<void> {
    await fileStorage.store(contentHash, fileType, blob, mediaType);
  }

  /**
   * Delete a file from local storage
   */
  async deleteFile(contentHash: string, fileType: FileType): Promise<void> {
    await fileStorage.delete(contentHash, fileType);
  }

  /**
   * Delete all files associated with a content hash
   */
  async deleteAllForContent(contentHash: string): Promise<void> {
    await fileStorage.deleteAllForContent(contentHash);
  }

  /**
   * Get a file as an object URL (for use in img src, etc.)
   * Remember to revoke the URL when done!
   */
  async getFileUrl(
    contentHash: string,
    fileType: FileType,
    options: FileGetOptions = {},
  ): Promise<string> {
    const result = await this.getFile(contentHash, fileType, options);
    return URL.createObjectURL(result.blob);
  }

  /**
   * Queue a file for upload
   */
  async queueUpload(
    contentHash: string,
    fileType: FileType,
    blob: Blob,
    options?: { priority?: Priority },
  ): Promise<string> {
    return transferQueue.queueUpload(contentHash, fileType, blob, options);
  }

  /**
   * Queue a file for download
   */
  async queueDownload(
    contentHash: string,
    fileType: FileType,
    options?: { priority?: Priority },
  ): Promise<string> {
    return transferQueue.queueDownload(contentHash, fileType, options);
  }

  /**
   * Subscribe to transfer progress
   */
  onProgress(
    contentHash: string,
    fileType: FileType,
    callback: (progress: TransferProgress) => void,
  ): () => void {
    return transferQueue.onProgress(contentHash, fileType, callback);
  }

  /**
   * Fetch a file from the network and store it locally
   */
  private async fetchAndStore(
    contentHash: string,
    fileType: FileType,
  ): Promise<FileFetchResult> {
    const url = this.buildFileUrl(fileType, contentHash);

    const response = await fetch(url, {
      credentials: "include",
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`File not found on server: ${fileType}:${contentHash}`);
      }
      throw new Error(
        `Failed to fetch file: ${response.status} ${response.statusText}`,
      );
    }

    const blob = await response.blob();
    const mediaType =
      response.headers.get("Content-Type") || "application/octet-stream";

    // Store locally for future access
    await fileStorage.store(contentHash, fileType, blob, mediaType);

    return {
      blob,
      mediaType,
      fromCache: false,
    };
  }

  /**
   * Build the API URL for fetching a file
   */
  private buildFileUrl(fileType: FileType, contentHash: string): string {
    // The server endpoint pattern: /api/files/{fileType}/{contentHash}
    return `/api/files/${fileType}/${contentHash}`;
  }
}

export const fileManager = new FileManager();
export { FileManager };

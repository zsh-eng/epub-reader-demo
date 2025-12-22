/**
 * File Storage
 *
 * Thin wrapper around IndexedDB for storing and retrieving files.
 * This is the "disk" layer - it only knows how to read/write blobs by ID.
 */

import { db } from "@/lib/db";
import {
  createFileId,
  type FileType,
  type StoredFile,
} from "@/lib/files/types";

/**
 * FileStorage provides low-level file storage operations using IndexedDB.
 * It handles the persistence layer without any knowledge of network operations.
 */
class FileStorage {
  /**
   * Store a file locally
   */
  async store(
    contentHash: string,
    fileType: FileType,
    blob: Blob,
    mediaType: string,
  ): Promise<void> {
    const id = createFileId(fileType, contentHash);

    const storedFile: StoredFile = {
      id,
      contentHash,
      fileType,
      blob,
      mediaType,
      size: blob.size,
      storedAt: Date.now(),
    };

    await db.files.put(storedFile);
  }

  /**
   * Retrieve a file from local storage
   */
  async get(
    contentHash: string,
    fileType: FileType,
  ): Promise<StoredFile | undefined> {
    const id = createFileId(fileType, contentHash);
    return db.files.get(id);
  }

  /**
   * Check if a file exists locally
   */
  async has(contentHash: string, fileType: FileType): Promise<boolean> {
    const id = createFileId(fileType, contentHash);
    const file = await db.files.get(id);
    return !!file;
  }

  /**
   * Delete a file from local storage
   */
  async delete(contentHash: string, fileType: FileType): Promise<void> {
    const id = createFileId(fileType, contentHash);
    await db.files.delete(id);
  }

  /**
   * Delete all files of a specific type for a given content hash
   * Useful when removing a book and all its associated files
   */
  async deleteAllForContent(contentHash: string): Promise<void> {
    const fileTypes: FileType[] = ["epub", "cover"];
    await Promise.all(
      fileTypes.map((fileType) => this.delete(contentHash, fileType)),
    );
  }

  /**
   * Get total storage used by files (in bytes)
   */
  async getTotalSize(): Promise<number> {
    const files = await db.files.toArray();
    return files.reduce((total, file) => total + file.size, 0);
  }

  /**
   * Get all stored files (for debugging/admin purposes)
   */
  async getAllFiles(): Promise<StoredFile[]> {
    return db.files.toArray();
  }
}

// Export singleton instance
export const fileStorage = new FileStorage();

// Export class for testing
export { FileStorage };

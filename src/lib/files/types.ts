/**
 * File Management Types
 *
 * Types for the generic file storage and transfer system.
 */

/**
 * Supported file types for routing to correct storage paths
 */
export type FileType = "epub" | "cover";

/**
 * A stored file in local IndexedDB
 */
export interface StoredFile {
  /** Composite key: `${fileType}:${contentHash}` */
  id: string;
  /** Content hash (e.g., book's fileHash) */
  contentHash: string;
  /** Type of file for routing */
  fileType: FileType;
  /** The actual file content */
  blob: Blob;
  /** MIME type (e.g., 'application/epub+zip', 'image/jpeg') */
  mediaType: string;
  /** File size in bytes */
  size: number;
  /** Timestamp when stored locally */
  storedAt: number;
}

/**
 * Result of a file fetch operation
 */
export interface FileFetchResult {
  blob: Blob;
  mediaType: string;
  /** Whether the file was served from local cache */
  fromCache: boolean;
}

/**
 * Options for file operations
 */
export interface FileGetOptions {
  /** Skip network fetch, only check local storage */
  localOnly?: boolean;
}

/**
 * Creates a composite file ID from type and content hash
 */
export function createFileId(fileType: FileType, contentHash: string): string {
  return `${fileType}:${contentHash}`;
}

/**
 * Parses a composite file ID into its components
 */
export function parseFileId(
  fileId: string,
): { fileType: FileType; contentHash: string } | null {
  const [fileType, contentHash] = fileId.split(":");
  if (!fileType || !contentHash) {
    return null;
  }
  return { fileType: fileType as FileType, contentHash };
}

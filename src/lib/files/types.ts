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
 * Transfer direction
 */
export type TransferDirection = "upload" | "download";

/**
 * Transfer task status
 */
export type TransferStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Priority levels for transfer tasks
 */
export type Priority = "low" | "normal" | "high";

/**
 * A transfer task in the queue
 */
export interface TransferTask {
  /** UUID */
  id: string;
  /** Transfer direction */
  direction: TransferDirection;
  /** Content hash (fileHash for books) */
  contentHash: string;
  /** Type of file */
  fileType: FileType;
  /** Current status */
  status: TransferStatus;
  /** Priority (higher = more urgent) */
  priority: number;
  /** Creation timestamp */
  createdAt: number;
  /** Retry count */
  retryCount: number;
  /** Maximum retries */
  maxRetries: number;
  /** Last attempt timestamp */
  lastAttempt?: number;
  /** Error message if failed */
  error?: string;
  /** Bytes transferred (for progress tracking) */
  bytesTransferred?: number;
  /** Total bytes (for progress tracking) */
  totalBytes?: number;
}

/**
 * Progress callback data
 */
export interface TransferProgress {
  contentHash: string;
  fileType: FileType;
  status: TransferStatus;
  bytesTransferred?: number;
  totalBytes?: number;
  error?: string;
}

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

/**
 * Convert priority string to number
 */
export function priorityToNumber(priority: Priority): number {
  switch (priority) {
    case "low":
      return 1;
    case "normal":
      return 5;
    case "high":
      return 10;
  }
}

/**
 * Create a composite key for transfer tasks
 */
export function createTransferKey(
  direction: TransferDirection,
  contentHash: string,
  fileType: FileType,
): string {
  return `${direction}:${fileType}:${contentHash}`;
}

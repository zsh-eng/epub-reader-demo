/**
 * Shared types for sync services
 */

import type { Book } from "@/lib/db";

/**
 * Server book response from API
 */
export interface ServerBook {
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

/**
 * Response from sync books pull endpoint
 */
export interface SyncBooksResponse {
  books: ServerBook[];
  serverTimestamp: number;
}

/**
 * Result of pushing a single book to server
 */
export interface BookSyncResult {
  fileHash: string;
  status: "created" | "updated" | "exists";
  serverId: string;
  epubUploadUrl: string | null;
  coverUploadUrl: string | null;
}

/**
 * Response from sync books push endpoint
 */
export interface PushBooksResponse {
  results: BookSyncResult[];
}

/**
 * Options for downloading a book
 */
export interface DownloadBookOptions {
  fileHash: string;
  remoteEpubUrl: string;
  book: Book;
}

/**
 * Options for downloading cover images
 */
export interface DownloadCoverOptions {
  fileHashes?: string[];
}

/**
 * Result of a download operation
 */
export interface DownloadResult {
  success: boolean;
  fileHash: string;
  error?: string;
}

/**
 * Options for uploading book files
 */
export interface UploadBookOptions {
  book: Book;
}

/**
 * Result of an upload operation
 */
export interface UploadResult {
  success: boolean;
  fileHash: string;
  epubUploaded: boolean;
  coverUploaded: boolean;
  error?: string;
}

/**
 * Error types for better error handling
 */
export const SyncErrorType = {
  NETWORK: "network",
  NOT_FOUND: "not_found",
  UNAUTHORIZED: "unauthorized",
  SERVER_ERROR: "server_error",
  UNKNOWN: "unknown",
} as const;

export type SyncErrorType = (typeof SyncErrorType)[keyof typeof SyncErrorType];

/**
 * Sync error with type information
 */
export class SyncError extends Error {
  public type: SyncErrorType;
  public retryable: boolean;

  constructor(
    message: string,
    type: SyncErrorType,
    retryable: boolean = false,
  ) {
    super(message);
    this.name = "SyncError";
    this.type = type;
    this.retryable = retryable;
  }
}

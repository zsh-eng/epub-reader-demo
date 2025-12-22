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
  /** Whether the server has the EPUB file in R2 storage */
  hasEpub: boolean;
  /** Whether the server has a cover image in R2 storage */
  hasCover: boolean;
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

/**
 * Server progress entry from API
 */
export interface ServerProgressEntry {
  id: string;
  fileHash: string;
  spineIndex: number;
  scrollProgress: number;
  clientSeq: number;
  clientTimestamp: number;
  serverSeq: number;
  serverTimestamp: number;
  deviceId: string;
}

/**
 * Response from sync progress pull endpoint
 */
export interface SyncProgressResponse {
  entries: ServerProgressEntry[];
  serverTimestamp: number;
}

/**
 * Result of pushing a single progress entry to server
 */
export interface ProgressSyncResult {
  id: string;
  serverSeq: number;
  status: "created" | "duplicate";
}

/**
 * Response from sync progress push endpoint
 */
export interface PushProgressResponse {
  results: ProgressSyncResult[];
}

/**
 * Progress entry to push to server
 */
export interface ProgressEntryToSync {
  id: string;
  fileHash: string;
  spineIndex: number;
  scrollProgress: number;
  clientSeq: number;
  clientTimestamp: number;
}

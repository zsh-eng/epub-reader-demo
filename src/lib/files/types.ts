declare const fileIdBrand: unique symbol;

/** Opaque, content-derived identity owned by the files implementation. */
export type FileId = string & { readonly [fileIdBrand]: true };

export interface FileMetadata {
  mediaType?: string;
}

export interface LocalFile {
  id: FileId;
  blob: Blob;
  mediaType: string;
  size: number;
  storedAt: number;
  remotePresent: boolean;
}

export interface RemoteFile {
  id: FileId;
  fileSize: number;
  mediaType: string;
  createdAt: number;
}

export type FileUploadFailure =
  | { kind: "none" }
  | { kind: "failed"; message: string; failedAt: number };

export interface FileUploadOperation {
  id: FileId;
  createdAt: number;
  retryCount: number;
  lastFailure: FileUploadFailure;
}

export interface Files {
  put(blob: Blob, metadata?: FileMetadata): Promise<FileId>;
  get(id: FileId): Promise<Blob>;
  hasLocal(id: FileId): Promise<boolean>;
  ensureLocal(id: FileId): Promise<void>;
  listLocal(): Promise<LocalFile[]>;
  listRemote(): Promise<RemoteFile[]>;
  deleteRemote(id: FileId): Promise<void>;
}

// Temporary application compatibility types. Step 3 removes these after Book
// call sites use opaque FileId values directly.
export type FileType = "epub" | "cover";
export type Priority = "low" | "normal" | "high";

export interface FileFetchResult {
  blob: Blob;
  mediaType: string;
  fromCache: boolean;
}

export interface FileGetOptions {
  localOnly?: boolean;
}

/** Legacy v2 row shape used only by the Dexie migration and Book cutover. */
export interface StoredFile {
  id: string;
  contentHash: string;
  fileType: FileType;
  blob: Blob;
  mediaType: string;
  size: number;
  storedAt: number;
}

/** Legacy v2 transfer shape used only by the Dexie migration. */
export interface TransferTask {
  id: string;
  direction: "upload" | "download";
  contentHash: string;
  fileType: FileType;
  status: "pending" | "processing" | "completed" | "failed";
  priority: number;
  createdAt: number;
  retryCount: number;
  maxRetries: number;
  lastAttempt?: number;
  error?: string;
}

export function createFileId(fileType: FileType, contentHash: string): string {
  return `${fileType}:${contentHash}`;
}

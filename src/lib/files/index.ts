/**
 * File Management Module
 *
 * Provides a unified interface for file storage and retrieval.
 * Abstracts local (IndexedDB) and remote (server/R2) file access.
 */

// Main facade - use this for all file operations
export { fileManager, FileManager } from "./file-manager";

// Low-level storage - usually not needed directly
export { fileStorage, FileStorage } from "./file-storage";

// Types
export type {
  FileFetchResult,
  FileGetOptions,
  FileType,
  StoredFile,
} from "./types";

export { createFileId, parseFileId } from "./types";

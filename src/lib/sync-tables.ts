/**
 * Sync Table Definitions
 *
 * Defines which tables should be synced and their schema configuration.
 * Uses the new schema generator from @/lib/sync/hlc/schema.ts
 */

import type { SyncTableDef } from "@/lib/sync/hlc/schema";

/**
 * Tables that are synced to the server
 * TODO: add some kind of typescript typing that prevents duplicate keys appearing in indices and unique indices?
 */
export const SYNC_TABLES = {
  books: {
    primaryKey: "id",
    indices: ["dateAdded", "lastOpened"],
    uniqueIndices: ["fileHash"],
  } satisfies SyncTableDef,

  readingProgress: {
    primaryKey: "id",
    indices: ["bookId", "lastRead"],
    compoundIndices: [["bookId", "lastRead"]],
    entityKey: "bookId", // For scoped sync by book
  } satisfies SyncTableDef,

  highlights: {
    primaryKey: "id",
    indices: ["bookId", "spineItemId", "createdAt"],
    compoundIndices: [
      ["bookId", "spineItemId"],
      ["bookId", "createdAt"],
    ],
    entityKey: "bookId",
  } satisfies SyncTableDef,

  readingSettings: {
    primaryKey: "id",
    indices: [],
  } satisfies SyncTableDef,
} as const;

/**
 * Tables that don't need sync (local-only)
 */
export const LOCAL_TABLES = {
  // Book files are local-only (large binary data)
  // These are extracted EPUB contents for rendering
  bookFiles: "id, bookId, path",

  // Generic file storage (content-addressed)
  // Used for EPUBs, covers, and other files
  files: "id, contentHash, fileType, [fileType+contentHash]",

  // Transfer queue for managing file uploads/downloads
  transferQueue:
    "id, status, priority, createdAt, [status+priority], [contentHash+fileType+direction]",

  // Sync log is for debugging (optional)
  syncLog: "++id, timestamp, type, table",
} as const;

export type SyncTableName = keyof typeof SYNC_TABLES;
export type LocalTableName = keyof typeof LOCAL_TABLES;
export type TableName = SyncTableName | LocalTableName;

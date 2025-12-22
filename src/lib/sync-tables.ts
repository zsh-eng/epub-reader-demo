/**
 * Sync Table Definitions
 *
 * Defines which tables should be synced and their schema configuration.
 * Uses the new schema generator from @/lib/sync/hlc/schema.ts
 */

import type { SyncTableDef } from "@/lib/sync/hlc/schema";

/**
 * Tables that are synced to the server
 */
export const SYNC_TABLES = {
  books: {
    primaryKey: "id",
    indices: ["fileHash", "dateAdded", "lastOpened"],
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
  bookFiles: "id, bookId, path",

  // EPUB blobs are local-only (large binary data)
  epubBlobs: "fileHash, dateStored",

  // Sync log is for debugging (optional)
  syncLog: "++id, timestamp, type, table",
} as const;

export type SyncTableName = keyof typeof SYNC_TABLES;
export type LocalTableName = keyof typeof LOCAL_TABLES;
export type TableName = SyncTableName | LocalTableName;

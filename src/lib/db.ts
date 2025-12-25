/**
 * Database Layer
 *
 * Local database using Dexie (IndexedDB wrapper) with sync metadata.
 * This version uses the new sync architecture with HLC timestamps and middleware.
 *
 * Note: The sync middleware is registered by sync-service.ts to avoid circular imports.
 */

import type { StoredFile, TransferTask } from "@/lib/files/types";
import { isNotDeleted } from "@/lib/sync/hlc/middleware";
import type { WithSyncMetadata } from "@/lib/sync/hlc/schema";
import { generateDexieStores } from "@/lib/sync/hlc/schema";
import type { Highlight } from "@/types/highlight";
import Dexie, { type Table } from "dexie";
import { LOCAL_TABLES, SYNC_TABLES } from "./sync-tables";

// ============================================================================
// Type Definitions
// ============================================================================

export interface Book {
  id: string;
  fileHash: string; // Content hash of the EPUB file (also used to fetch via FileManager)
  title: string;
  author: string;
  fileSize: number;
  dateAdded: number;
  lastOpened?: number | null;
  metadata: Record<string, unknown>;
  manifest: ManifestItem[];
  spine: SpineItem[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toc: any[];
  isDownloaded: number; // Whether book files have been extracted locally
  coverContentHash?: string; // Content hash of the cover image (used to fetch via FileManager)
}

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

export interface SpineItem {
  idref: string; // References ManifestItem.id
  linear?: boolean;
  properties?: string;
}

export interface TOCItem {
  label: string;
  href: string;
  children?: TOCItem[];
}

export interface ReadingProgress {
  id: string; // Primary key (auto-generated UUID)
  bookId: string; // Foreign key to Book
  currentSpineIndex: number; // Current position in spine
  scrollProgress: number; // 0-1 for scroll mode
  pageNumber?: number; // For paginated mode
  lastRead: number; // Timestamp when this progress was recorded
  createdAt: number; // When this record was created
}

export interface ReadingSettings {
  id: string; // Primary key (single record, use 'default')
  fontSize: number; // In pixels (16-24)
  lineHeight: number; // Multiplier (1.2-2.0)
  mode: "scroll" | "paginated";
  theme?: "light" | "dark" | "sepia";
}

// Local-only tables (no sync)
export interface BookFile {
  id: string; // Primary key (matches Book.id)
  bookId: string; // Foreign key to Book
  path: string; // Path within the EPUB (e.g., "OEBPS/chapter1.xhtml")
  content: Blob; // The actual file content
  mediaType: string;
}

export interface SyncLog {
  id?: number;
  timestamp: number;
  type: "push" | "pull" | "sync";
  table: string;
  pushed?: number;
  pulled?: number;
  conflicts?: number;
  errors?: string[];
}

// Add sync metadata to synced types
export type SyncedBook = WithSyncMetadata<Book>;
export type SyncedReadingProgress = WithSyncMetadata<ReadingProgress>;
export type SyncedHighlight = WithSyncMetadata<Highlight>;
export type SyncedReadingSettings = WithSyncMetadata<ReadingSettings>;

// Re-export Highlight type for convenience
export type { Highlight };

// Re-export StoredFile type for convenience
export type { StoredFile, TransferTask };

// ============================================================================
// Database Class
// ============================================================================

class EPUBReaderDB extends Dexie {
  // Synced tables (with metadata)
  books!: Table<SyncedBook, string>;
  readingProgress!: Table<SyncedReadingProgress, string>;
  highlights!: Table<SyncedHighlight, string>;
  readingSettings!: Table<SyncedReadingSettings, string>;

  // Local-only tables
  bookFiles!: Table<BookFile, string>;
  files!: Table<StoredFile, string>;
  transferQueue!: Table<TransferTask, string>;
  syncLog!: Table<SyncLog, number>;

  constructor() {
    super("epub-reader-db");
    const syncSchemas = generateDexieStores(SYNC_TABLES);

    // Version 1: Initial schema
    this.version(1).stores({
      ...syncSchemas,
      bookFiles: "id, bookId, path",
      syncLog: "++id, timestamp, type, table",
    });

    // Version 2: Add generic files table
    this.version(2).stores({
      ...syncSchemas,
      ...LOCAL_TABLES,
    });

    // Version 3: Migrate readingProgress to use UUID primary keys for historical tracking
    this.version(3)
      .stores({
        ...syncSchemas,
        ...LOCAL_TABLES,
      })
      .upgrade(async (tx) => {
        // Migrate existing readingProgress records to use UUID instead of bookId as primary key
        const progressRecords = await tx.table("readingProgress").toArray();

        if (progressRecords.length > 0) {
          // Clear existing records
          await tx.table("readingProgress").clear();

          // Re-insert with new UUIDs and createdAt field
          const migratedRecords = progressRecords.map((record) => ({
            ...record,
            id: crypto.randomUUID(), // Generate new UUID for id
            createdAt: record.lastRead || Date.now(), // Use lastRead as createdAt
          }));

          await tx.table("readingProgress").bulkAdd(migratedRecords);
        }
      });

    // Note: Sync middleware is registered by sync-service.ts to avoid circular imports
  }
}

export const db = new EPUBReaderDB();

// ============================================================================
// Helper Functions (Book operations)
// ============================================================================
//
// NOTE: All query helper functions in this file automatically filter out
// soft-deleted records (where _isDeleted=1) using the isNotDeleted() helper.
// This ensures application code only sees active records.
//
// For sync operations, the storage adapter intentionally does NOT filter
// deleted records, as deletions need to be synced to the server.
// ============================================================================

export async function addBook(book: Book): Promise<string> {
  return db.books.add(book as SyncedBook);
}

/**
 * Add a book with its files atomically in a single transaction
 * This ensures all related data is stored together or not at all
 */
export async function addBookWithFiles(
  book: Book,
  bookFiles: BookFile[],
): Promise<string> {
  return db.transaction("rw", [db.books, db.bookFiles, db.files], async () => {
    // Add book first
    const bookId = await db.books.add(book as SyncedBook);

    // Add book files (extracted EPUB content)
    if (bookFiles.length > 0) {
      await db.bookFiles.bulkAdd(bookFiles);
    }

    return bookId;
  });
}

export async function getBook(id: string): Promise<SyncedBook | undefined> {
  const book = await db.books.get(id);
  return book && isNotDeleted(book) ? book : undefined;
}

export async function getAllBooks(): Promise<SyncedBook[]> {
  return db.books.filter(isNotDeleted).toArray();
}

export async function deleteBook(id: string): Promise<void> {
  const book = await db.books.get(id);
  if (!book) return;

  // Mark as deleted (tombstone) instead of hard delete
  await db.books.put({
    ...book,
    _isDeleted: 1,
  });

  // Clean up local-only data
  await db.bookFiles.where("bookId").equals(id).delete();
  await db.readingProgress.where("bookId").equals(id).delete();
  await db.highlights.where("bookId").equals(id).delete();
}

export async function getBookByFileHash(
  fileHash: string,
): Promise<SyncedBook | undefined> {
  const book = await db.books.where("fileHash").equals(fileHash).first();
  return book && isNotDeleted(book) ? book : undefined;
}

export async function updateBookLastOpened(id: string): Promise<void> {
  await db.books.update(id, { lastOpened: Date.now() });
}

// ============================================================================
// Helper Functions (Book Files)
// ============================================================================

export async function addBookFile(bookFile: BookFile): Promise<string> {
  return db.bookFiles.add(bookFile);
}

export async function getBookFile(
  bookId: string,
  path: string,
): Promise<BookFile | undefined> {
  return db.bookFiles
    .where("bookId")
    .equals(bookId)
    .and((file) => file.path === path)
    .first();
}

export async function getBookFiles(bookId: string): Promise<BookFile[]> {
  return db.bookFiles.where("bookId").equals(bookId).toArray();
}

// ============================================================================
// Helper Functions (Reading Progress)
// ============================================================================

export async function saveReadingProgress(
  progress: Omit<ReadingProgress, "id" | "createdAt">,
): Promise<string> {
  const record: ReadingProgress = {
    ...progress,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  return db.readingProgress.add(record as SyncedReadingProgress);
}

export async function getReadingProgress(
  bookId: string,
): Promise<SyncedReadingProgress | undefined> {
  const latestProgress = await db.readingProgress
    .where("[bookId+lastRead]")
    .between([bookId, Dexie.minKey], [bookId, Dexie.maxKey])
    .filter(isNotDeleted)
    .reverse()
    .first();

  return latestProgress;
}

export async function getReadingProgressHistory(
  bookId: string,
  limit?: number,
): Promise<SyncedReadingProgress[]> {
  // Get all progress history for a book, sorted by lastRead timestamp (oldest to newest)
  const results = await db.readingProgress
    .where("bookId")
    .equals(bookId)
    .filter(isNotDeleted)
    .sortBy("lastRead");

  // Reverse to get newest first (descending order by lastRead)
  const reversed = results.reverse();
  return limit ? reversed.slice(0, limit) : reversed;
}

// ============================================================================
// Helper Functions (Reading Settings)
// ============================================================================

export async function getReadingSettings(): Promise<SyncedReadingSettings> {
  const settings = await db.readingSettings.get("default");

  if (settings && isNotDeleted(settings)) {
    return settings;
  }

  const defaultSettings: ReadingSettings = {
    id: "default",
    fontSize: 18,
    lineHeight: 1.6,
    mode: "scroll",
    theme: "light",
  };

  await db.readingSettings.add(defaultSettings as SyncedReadingSettings);
  return (await db.readingSettings.get("default"))!;
}

export async function updateReadingSettings(
  settings: Partial<ReadingSettings>,
): Promise<void> {
  const current = await getReadingSettings();
  await db.readingSettings.put({
    ...current,
    ...settings,
  });
}

// ============================================================================
// Helper Functions (Highlights)
// ============================================================================

export async function addHighlight(highlight: Highlight): Promise<string> {
  return db.highlights.add(highlight as SyncedHighlight);
}

export async function getHighlights(
  bookId: string,
  spineItemId: string,
): Promise<SyncedHighlight[]> {
  return db.highlights
    .where("bookId")
    .equals(bookId)
    .and((h) => h.spineItemId === spineItemId && isNotDeleted(h))
    .toArray();
}

export async function deleteHighlight(id: string): Promise<void> {
  const highlight = await db.highlights.get(id);
  if (!highlight) return;

  // Mark as deleted (tombstone)
  await db.highlights.put({
    ...highlight,
    _isDeleted: 1,
  });
}

export async function updateHighlight(
  id: string,
  changes: Partial<Highlight>,
): Promise<void> {
  const highlight = await db.highlights.get(id);
  if (!highlight || isNotDeleted(highlight) === false) return;

  await db.highlights.put({
    ...highlight,
    ...changes,
    updatedAt: new Date(),
  });
}

// ============================================================================
// Helper Functions (Sync Log)
// ============================================================================

export async function addSyncLogs(logs: Omit<SyncLog, "id">[]) {
  return db.syncLog.bulkAdd(logs);
}

export async function getRecentSyncLogs(limit = 20): Promise<SyncLog[]> {
  return db.syncLog.orderBy("timestamp").reverse().limit(limit).toArray();
}

// ============================================================================
// Helper Functions (Book Queries - Compatibility)
// ============================================================================

export async function getNotDownloadedBooks(): Promise<SyncedBook[]> {
  return db.books
    .filter((book) => !book.isDownloaded && isNotDeleted(book))
    .toArray();
}

export async function markBookAsDownloaded(bookId: string): Promise<void> {
  await db.books.update(bookId, {
    isDownloaded: 1,
  });
}

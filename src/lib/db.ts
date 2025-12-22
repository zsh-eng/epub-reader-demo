/**
 * Database Layer
 *
 * Local database using Dexie (IndexedDB wrapper) with sync metadata.
 * This version uses the new sync architecture with HLC timestamps and middleware.
 */

import { createHLCService } from "@/lib/sync/hlc/hlc";
import { createSyncMiddleware, isNotDeleted } from "@/lib/sync/hlc/middleware";
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
  fileHash: string;
  title: string;
  author?: string | null;
  fileSize: number;
  dateAdded: number;
  lastOpened?: number | null;
  metadata?: Record<string, unknown>;
  manifest?: ManifestItem[];
  spine?: SpineItem[];
  toc?: TOCItem[];
  isDownloaded: boolean;
  remoteEpubUrl?: string | null;
  remoteCoverUrl?: string | null;
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
  children?: unknown[]; // Avoid recursive type for Dexie compatibility
}

export interface ReadingProgress {
  id: string; // Primary key (matches Book.id)
  bookId: string; // Foreign key to Book
  currentSpineIndex: number; // Current position in spine
  scrollProgress: number; // 0-1 for scroll mode
  pageNumber?: number; // For paginated mode
  lastRead: number;
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

export interface EpubBlob {
  fileHash: string; // Primary key (matches Book.fileHash)
  blob: Blob; // The original EPUB file
  dateStored: number;
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
  epubBlobs!: Table<EpubBlob, string>;
  syncLog!: Table<SyncLog, number>;

  constructor() {
    super("epub-reader-db");

    // Version 2: Original schema
    this.version(2).stores({
      books: "id, title, author, dateAdded, lastOpened",
      bookFiles: "id, bookId, path",
      readingProgress: "id, bookId, lastRead",
      readingSettings: "id",
      highlights: "id, bookId, spineItemId, createdAt",
    });

    // Version 3: Add fileHash field with unique index
    this.version(3).stores({
      books: "id, &fileHash, title, author, dateAdded, lastOpened",
      bookFiles: "id, bookId, path",
      readingProgress: "id, bookId, lastRead",
      readingSettings: "id",
      highlights: "id, bookId, spineItemId, createdAt",
    });

    // Version 4: Add sync tables and isDownloaded field
    this.version(4).stores({
      books:
        "id, &fileHash, title, author, dateAdded, lastOpened, isDownloaded",
      bookFiles: "id, bookId, path",
      readingProgress: "id, bookId, lastRead",
      readingSettings: "id",
      highlights: "id, bookId, spineItemId, createdAt",
      bookSyncState: "fileHash, status",
      syncLog: "id, timestamp, entityType, status",
      syncCursor: "id",
      epubBlobs: "fileHash, dateStored",
    });

    // Version 5: Add progress log tables
    this.version(5).stores({
      books:
        "id, &fileHash, title, author, dateAdded, lastOpened, isDownloaded",
      bookFiles: "id, bookId, path",
      readingProgress: "id, bookId, lastRead",
      readingSettings: "id",
      highlights: "id, bookId, spineItemId, createdAt",
      bookSyncState: "fileHash, status",
      syncLog: "id, timestamp, entityType, status",
      syncCursor: "id",
      epubBlobs: "fileHash, dateStored",
      progressLog: "id, fileHash, synced, clientSeq, serverSeq",
      progressSeqCounter: "fileHash",
    });

    // Version 6: NEW SYNC ARCHITECTURE
    // Remove old sync tables, add sync metadata to all synced tables
    const syncSchemas = generateDexieStores(SYNC_TABLES);

    this.version(6)
      .stores({
        ...syncSchemas,
        ...LOCAL_TABLES,
        // Delete old sync-specific tables
        bookSyncState: null,
        syncCursor: null,
        progressLog: null,
        progressSeqCounter: null,
      })
      .upgrade(async () => {
        // Migration logic: add sync metadata to existing records
        // This will be handled by the middleware on first write
        console.log("Upgraded to version 6: New sync architecture");
      });

    // Initialize HLC service and middleware
    const hlc = createHLCService();
    const syncedTableNames = new Set(Object.keys(SYNC_TABLES));

    this.use(
      createSyncMiddleware({
        hlc,
        syncedTables: syncedTableNames,
        onMutation: (event) => {
          // Optional: Can be used to trigger immediate sync
          // For now, we'll rely on periodic sync
          console.debug("Mutation:", event);
        },
      }),
    );
  }
}

export const db = new EPUBReaderDB();

// ============================================================================
// Helper Functions (Book operations)
// ============================================================================

export async function addBook(book: Book): Promise<string> {
  return db.books.add(book as SyncedBook);
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
  await db.epubBlobs.delete(book.fileHash);
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
  progress: ReadingProgress,
): Promise<string> {
  return db.readingProgress.put(progress as SyncedReadingProgress);
}

export async function getReadingProgress(
  bookId: string,
): Promise<SyncedReadingProgress | undefined> {
  const progress = await db.readingProgress.get(bookId);
  return progress && isNotDeleted(progress) ? progress : undefined;
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
// Helper Functions (Book Cover)
// ============================================================================

export async function getBookCoverUrl(bookId: string): Promise<string | null> {
  const bookFile = await db.bookFiles
    .where("bookId")
    .equals(bookId)
    .and((file) => file.path.includes("cover"))
    .first();

  return bookFile ? URL.createObjectURL(bookFile.content) : null;
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
// Helper Functions (EPUB Blobs)
// ============================================================================

export async function saveEpubBlob(
  fileHash: string,
  blob: Blob,
): Promise<string> {
  await db.epubBlobs.put({
    fileHash,
    blob,
    dateStored: Date.now(),
  });
  return fileHash;
}

export async function getEpubBlob(
  fileHash: string,
): Promise<EpubBlob | undefined> {
  return db.epubBlobs.get(fileHash);
}

export async function deleteEpubBlob(fileHash: string): Promise<void> {
  await db.epubBlobs.delete(fileHash);
}

export async function hasEpubBlob(fileHash: string): Promise<boolean> {
  const blob = await db.epubBlobs.get(fileHash);
  return !!blob;
}

// ============================================================================
// Helper Functions (Book Queries - Compatibility)
// ============================================================================

export async function getNotDownloadedBooks(): Promise<SyncedBook[]> {
  return db.books
    .filter((book) => !book.isDownloaded && isNotDeleted(book))
    .toArray();
}

export async function markBookAsDownloaded(
  bookId: string,
  remoteEpubUrl?: string,
  remoteCoverUrl?: string,
): Promise<void> {
  await db.books.update(bookId, {
    isDownloaded: true,
    remoteEpubUrl,
    remoteCoverUrl,
  });
}

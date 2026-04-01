/**
 * Database Layer
 *
 * Local database using Dexie (IndexedDB wrapper) with sync metadata.
 * This version uses the new sync architecture with HLC timestamps and middleware.
 *
 * Note: The sync middleware is registered by sync-service.ts to avoid circular imports.
 */

import type { StoredFile, TransferTask } from "@/lib/files/types";
import { extractImageDimensionsFromBlob } from "@/lib/image-dimensions";
import { isNotDeleted } from "@/lib/sync/hlc/middleware";
import type { WithSyncMetadata } from "@/lib/sync/hlc/schema";
import { generateDexieStores } from "@/lib/sync/hlc/schema";
import type { Highlight } from "@/types/highlight";
import type { Note } from "@/types/note";
import type { ReadingState } from "@/types/reading-state";
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

/**
 * Types of navigation that trigger reading progress saves.
 * Only "hop" triggers create meaningful jump-back points.
 */
export type ProgressTriggerType =
  | "periodic" // Normal interval save (default for old records)
  | "toc-navigation" // Used table of contents
  | "highlight-jump" // Jumped to highlight
  | "fragment-link" // Clicked internal book link
  | "manual-chapter" // Prev/next chapter buttons, escape key, or close button
  | "session-start" // Opening the book
  | "search-result-jump"; // Jumped to search result

export interface ReadingProgress {
  id: string; // Primary key (auto-generated UUID)
  bookId: string; // Foreign key to Book
  currentSpineIndex: number; // Current position in spine
  scrollProgress: number; // 0-1 for scroll mode
  pageNumber?: number; // For paginated mode
  lastRead: number; // Timestamp when this progress was recorded
  createdAt: number; // When this record was created
  /** What triggered this progress save (for filtering jump-back history) */
  triggerType?: ProgressTriggerType;
  /** Fragment or highlight ID for precise scroll restoration */
  targetElementId?: string;
}

export interface ReadingSettings {
  /**
   * Legacy settings shape kept for IndexedDB/sync schema compatibility.
   * The active reader UI currently uses `ReaderSettings` from
   * `src/types/reader.types.ts` via `useReaderSettings` (localStorage).
   */
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

/**
 * Cached plain text extracted from book chapters for full-text search.
 * This is local-only (not synced) since it can be regenerated from BookFile.
 */
export interface BookTextCache {
  bookId: string; // Primary key
  chapters: {
    path: string; // Matches BookFile.path
    title: string; // Chapter title from TOC (for display)
    plainText: string; // Extracted text content
    startOffset: number; // Cumulative character offset in book
  }[];
  totalCharacters: number;
  extractedAt: number; // For cache invalidation if needed
}

/**
 * Cached intrinsic dimensions for image resources inside an EPUB.
 * Local-only derived metadata used by pagination to avoid repeatedly decoding blobs.
 */
export interface BookImageDimension {
  id: string; // `${bookId}:${path}`
  bookId: string;
  path: string; // Canonical EPUB resource path
  width: number;
  height: number;
  updatedAt: number;
}

// Add sync metadata to synced types
export type SyncedBook = WithSyncMetadata<Book>;
export type SyncedReadingProgress = WithSyncMetadata<ReadingProgress>;
export type SyncedHighlight = WithSyncMetadata<Highlight>;
export type SyncedReadingSettings = WithSyncMetadata<ReadingSettings>;
export type SyncedReadingState = WithSyncMetadata<ReadingState>;
export type SyncedNote = WithSyncMetadata<Note>;

// Re-export Highlight and Note types for convenience
export type { Highlight };
export type { Note };
export type { ReadingState, ReadingStatus } from "@/types/reading-state";

// Re-export StoredFile type for convenience
export type { StoredFile, TransferTask };

export interface BookImageDimensionInput {
  bookId: string;
  path: string;
  width: number;
  height: number;
  updatedAt?: number;
}

const IMAGE_MEDIA_TYPE_PREFIX = "image/";
const SVG_MEDIA_TYPES = new Set(["image/svg+xml", "application/svg+xml"]);

function isImageBookFile(file: Pick<BookFile, "mediaType" | "path">): boolean {
  const mediaType = file.mediaType.toLowerCase();
  if (mediaType.startsWith(IMAGE_MEDIA_TYPE_PREFIX)) return true;
  if (SVG_MEDIA_TYPES.has(mediaType)) return true;
  return file.path.toLowerCase().endsWith(".svg");
}

export function createBookImageDimensionId(bookId: string, path: string): string {
  return `${bookId}:${path}`;
}

function createBookImageDimensionRow(
  entry: BookImageDimensionInput,
  fallbackTimestamp: number,
): BookImageDimension {
  return {
    id: createBookImageDimensionId(entry.bookId, entry.path),
    bookId: entry.bookId,
    path: entry.path,
    width: entry.width,
    height: entry.height,
    updatedAt: entry.updatedAt ?? fallbackTimestamp,
  };
}

export async function deriveImageDimensionsFromBookFiles(
  files: Pick<BookFile, "bookId" | "path" | "mediaType" | "content">[],
): Promise<BookImageDimensionInput[]> {
  const dimensions: BookImageDimensionInput[] = [];

  for (const file of files) {
    if (!isImageBookFile(file)) continue;

    const parsed = await extractImageDimensionsFromBlob(file.content, file.mediaType);
    if (!parsed) continue;

    dimensions.push({
      bookId: file.bookId,
      path: file.path,
      width: parsed.width,
      height: parsed.height,
    });
  }

  return dimensions;
}

export async function buildBookImageDimensionRowsFromBookFiles(
  files: Pick<BookFile, "bookId" | "path" | "mediaType" | "content">[],
  fallbackTimestamp: number = Date.now(),
): Promise<BookImageDimension[]> {
  const extracted = await deriveImageDimensionsFromBookFiles(files);
  return extracted.map((entry) =>
    createBookImageDimensionRow(entry, fallbackTimestamp),
  );
}

// ============================================================================
// Database Class
// ============================================================================

class EPUBReaderDB extends Dexie {
  // Synced tables (with metadata)
  books!: Table<SyncedBook, string>;
  readingProgress!: Table<SyncedReadingProgress, string>;
  highlights!: Table<SyncedHighlight, string>;
  readingSettings!: Table<SyncedReadingSettings, string>;
  readingState!: Table<SyncedReadingState, string>;
  notes!: Table<SyncedNote, string>;

  // Local-only tables
  bookFiles!: Table<BookFile, string>;
  files!: Table<StoredFile, string>;
  transferQueue!: Table<TransferTask, string>;
  syncLog!: Table<SyncLog, number>;
  bookTextCache!: Table<BookTextCache, string>;
  bookImageDimensions!: Table<BookImageDimension, string>;

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
          const deletedRecords = progressRecords.map((record) => ({
            ...record,
            _deleted: 1,
          }));

          // Re-insert with new UUIDs and createdAt field
          const migratedRecords = progressRecords.map((record) => ({
            ...record,
            id: crypto.randomUUID(), // Generate new UUID for id
            createdAt: record.lastRead || Date.now(), // Use lastRead as createdAt
          }));

          await tx.table("readingProgress").bulkPut(migratedRecords);
          await tx.table("readingProgress").bulkPut(deletedRecords);
        }
      });

    // Version 4: Add readingState table for tracking reading status history
    this.version(4).stores({
      ...syncSchemas,
      ...LOCAL_TABLES,
    });

    // Version 5: Add notes table for threaded annotations
    this.version(5).stores({
      ...syncSchemas,
      ...LOCAL_TABLES,
    });

    // Version 6: Add bookTextCache table for full-text search
    this.version(6).stores({
      ...syncSchemas,
      ...LOCAL_TABLES,
    });

    // Version 7: Add local image-dimensions metadata and backfill existing books
    this.version(7)
      .stores({
        ...syncSchemas,
        ...LOCAL_TABLES,
      })
      .upgrade(async (tx) => {
        const existingBookFiles = (await tx
          .table("bookFiles")
          .toArray()) as BookFile[];

        if (existingBookFiles.length === 0) return;

        const rows = await buildBookImageDimensionRowsFromBookFiles(
          existingBookFiles,
          Date.now(),
        );
        if (rows.length === 0) return;

        await tx.table("bookImageDimensions").bulkPut(rows);
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
  const imageDimensionRows = await buildBookImageDimensionRowsFromBookFiles(
    bookFiles,
    Date.now(),
  );

  return db.transaction(
    "rw",
    [db.books, db.bookFiles, db.files, db.bookImageDimensions],
    async () => {
      // Add book first
      const bookId = await db.books.add(book as SyncedBook);

      // Add book files (extracted EPUB content)
      if (bookFiles.length > 0) {
        await db.bookFiles.bulkAdd(bookFiles);
      }

      if (imageDimensionRows.length > 0) {
        await db.bookImageDimensions.bulkPut(imageDimensionRows);
      }

      return bookId;
    },
  );
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
  await db.bookImageDimensions.where("bookId").equals(id).delete();
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

export async function getBookImageDimensionsMap(
  bookId: string,
): Promise<Map<string, { width: number; height: number }>> {
  const rows = await db.bookImageDimensions.where("bookId").equals(bookId).toArray();
  return new Map(rows.map((row) => [row.path, { width: row.width, height: row.height }]));
}

export async function upsertBookImageDimensions(
  entries: BookImageDimensionInput[],
): Promise<void> {
  if (entries.length === 0) return;

  const timestamp = Date.now();
  const rows: BookImageDimension[] = entries.map((entry) =>
    createBookImageDimensionRow(entry, timestamp),
  );

  await db.bookImageDimensions.bulkPut(rows);
}

export async function getBookFilesByPaths(
  bookId: string,
  paths: string[],
): Promise<Map<string, BookFile>> {
  if (paths.length === 0) {
    return new Map<string, BookFile>();
  }

  const uniquePaths = [...new Set(paths)];
  const files = await db.transaction("r", [db.bookFiles], async () => {
    return db.bookFiles
      .where("path")
      .anyOf(uniquePaths)
      .and((file) => file.bookId === bookId)
      .toArray();
  });

  return new Map(files.map((file) => [file.path, file]));
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

export async function getAllHighlights(): Promise<SyncedHighlight[]> {
  return db.highlights.filter(isNotDeleted).toArray();
}

// ============================================================================
// Helper Functions (Notes)
// ============================================================================

export async function addNote(note: Note): Promise<string> {
  return db.notes.add(note as SyncedNote);
}

export async function getNotesByAnnotation(
  annotationId: string,
): Promise<SyncedNote[]> {
  return db.notes
    .where("annotationId")
    .equals(annotationId)
    .filter(isNotDeleted)
    .sortBy("createdAt");
}

export async function getChapterNotes(
  bookId: string,
  spineItemId: string,
): Promise<SyncedNote[]> {
  return db.notes
    .where("[bookId+spineItemId]")
    .equals([bookId, spineItemId])
    .filter((n) => n.annotationType === "chapter" && isNotDeleted(n))
    .sortBy("createdAt");
}

export async function updateNote(id: string, content: string): Promise<void> {
  const note = await db.notes.get(id);
  if (!note || !isNotDeleted(note)) return;

  await db.notes.put({
    ...note,
    content,
    updatedAt: new Date(),
  });
}

export async function deleteNote(id: string): Promise<void> {
  const note = await db.notes.get(id);
  if (!note) return;

  await db.notes.put({
    ...note,
    _isDeleted: 1,
  });
}

export async function getAllNotes(): Promise<SyncedNote[]> {
  return db.notes.filter(isNotDeleted).toArray();
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
// Helper Functions (Reading State)
// ============================================================================

export async function setReadingStatus(
  bookId: string,
  status: ReadingState["status"],
): Promise<string> {
  const entry: ReadingState = {
    id: crypto.randomUUID(),
    bookId,
    status,
    timestamp: Date.now(),
    createdAt: Date.now(),
  };
  return db.readingState.add(entry as SyncedReadingState);
}

export async function getReadingStatus(
  bookId: string,
): Promise<ReadingState["status"] | null> {
  const latest = await db.readingState
    .where("[bookId+timestamp]")
    .between([bookId, Dexie.minKey], [bookId, Dexie.maxKey])
    .filter(isNotDeleted)
    .reverse()
    .first();

  return latest?.status ?? null;
}

export async function getAllReadingStatuses(): Promise<
  Map<string, ReadingState["status"]>
> {
  // Get all reading state entries, grouped by bookId, return latest per book
  const allEntries = await db.readingState.filter(isNotDeleted).toArray();

  // Group by bookId and find latest for each
  const latestByBook = new Map<string, SyncedReadingState>();
  for (const entry of allEntries) {
    const existing = latestByBook.get(entry.bookId);
    if (!existing || entry.timestamp > existing.timestamp) {
      latestByBook.set(entry.bookId, entry);
    }
  }

  // Convert to status-only map
  const result = new Map<string, ReadingState["status"]>();
  for (const [bookId, entry] of latestByBook) {
    result.set(bookId, entry.status);
  }
  return result;
}

export async function getReadingHistory(
  bookId: string,
): Promise<SyncedReadingState[]> {
  return db.readingState
    .where("bookId")
    .equals(bookId)
    .filter(isNotDeleted)
    .sortBy("timestamp");
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

/**
 * Database Layer
 *
 * Local database helpers over the clean sync v2 Dexie schema.
 */

import type { BookCoverRef } from "@/lib/book-file-references";
import type { FileId } from "@/lib/files/types";
import {
  syncV2Db,
  type SyncV2Highlight,
  type SyncV2Note,
  type SyncV2ReadingState,
} from "@/lib/sync-v2/db";
import {
  optionalTimestampMs,
  toTimestampMs,
  type TimestampInput,
} from "@/lib/timestamps";
import type { Highlight } from "@/types/highlight";
import type { Note } from "@/types/note";
import type { ReadingState } from "@/types/reading-state";
import Dexie from "dexie";
import { getOrCreateDeviceId } from "./device";

// ============================================================================
// Type Definitions
// ============================================================================

export interface Book {
  id: string;
  sourceFileId: FileId;
  title: string;
  author: string;
  fileSize: number;
  dateAdded: number;
  metadata: Record<string, unknown>;
  manifest: ManifestItem[];
  spine: SpineItem[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toc: any[];
  cover: BookCoverRef | null;
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

export interface ReadingCheckpoint {
  id: string; // Stable primary key: `resume:${deviceId}:${bookId}`
  bookId: string; // Foreign key to Book
  deviceId: string; // Device that owns this checkpoint
  currentSpineIndex: number; // Current chapter/spine index
  scrollProgress: number; // Chapter-local percentage in the range 0-100
  lastRead: number; // Timestamp when this checkpoint was last updated
}

export const READING_SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export interface ReadingSession {
  id: string; // UUID primary key for this reader-open session
  bookId: string; // Foreign key to Book
  deviceId: string; // Device that owns this session
  readerInstanceId: string; // Ephemeral mounted reader/window instance
  startedAt: number; // Timestamp when the reader session began
  /**
   * Best-effort timestamp for when the reader session ended.
   *
   * Browser unload/pagehide writes are not guaranteed to complete. Future
   * cleanup/reporting should treat `lastActiveAt` as the practical end for
   * stale sessions where this remains null.
   */
  endedAt: number | null;
  lastActiveAt: number; // Last timestamp we considered plausibly active
  activeMs: number; // Accumulated active reading time, excluding idle gaps
  startSpineIndex: number;
  startScrollProgress: number; // Chapter-local percentage in the range 0-100
  endSpineIndex: number;
  endScrollProgress: number; // Chapter-local percentage in the range 0-100
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
  id: string; // Deterministic primary key derived from bookId and path
  bookId: string; // Foreign key to Book
  path: string; // Path within the EPUB (e.g., "OEBPS/chapter1.xhtml")
  content: Blob; // The actual file content
  mediaType: string;
}

/** Durable proof that the current source EPUB was expanded completely. */
export interface BookMaterialization {
  bookId: string;
  sourceFileId: FileId;
  recipeVersion: number;
  completedAt: number;
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

export interface BookChapterSourceCacheEntry {
  bodyHtml: string;
  canonicalText: {
    fullText: string;
    blockStarts: ReadonlyMap<string, number>;
  };
  bookStylesheets?: {
    cssText: string;
    basePath: string;
  }[];
  publisherFontFaces?: {
    family: string;
    src: string;
    descriptors: FontFaceDescriptors;
  }[];
}

/**
 * Local-only reader source cache.
 *
 * This stores normalized chapter body HTML and canonical text in one row per
 * book so reader startup can avoid repeatedly reading EPUB blobs and rebuilding
 * the same DOM-derived source strings.
 */
export interface BookChapterSourceCache {
  bookId: string;
  sourceFileId: FileId;
  cacheVersion: number;
  publisherResourcesLoaded?: boolean;
  publisherBodyScaleLoaded?: boolean;
  publisherBodyFontScale?: number;
  chaptersByPath: Record<string, BookChapterSourceCacheEntry>;
  publisherFontFaces?: {
    family: string;
    src: string;
    descriptors: FontFaceDescriptors;
  }[];
  updatedAt: number;
}

type StoredHighlight = SyncV2Highlight;
type StoredReadingState = SyncV2ReadingState;
type StoredNote = SyncV2Note;

// Re-export Highlight and Note types for convenience
export type { ReadingState, ReadingStatus } from "@/types/reading-state";
export type { Highlight, Note };

export type { BookCoverRef };

type LegacyStoredHighlight = Omit<
  StoredHighlight,
  "createdAt" | "updatedAt"
> & {
  createdAt: TimestampInput;
  updatedAt?: TimestampInput;
};

type LegacyStoredNote = Omit<StoredNote, "createdAt" | "updatedAt"> & {
  createdAt: TimestampInput;
  updatedAt?: TimestampInput;
};

function normalizeHighlightTimestamps(
  highlight: StoredHighlight,
): StoredHighlight {
  const legacyHighlight = highlight as LegacyStoredHighlight;
  const updatedAt = optionalTimestampMs(legacyHighlight.updatedAt);

  return {
    ...highlight,
    createdAt: toTimestampMs(legacyHighlight.createdAt),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

function normalizeNoteTimestamps(note: StoredNote): StoredNote {
  const legacyNote = note as LegacyStoredNote;
  const updatedAt = optionalTimestampMs(legacyNote.updatedAt);

  return {
    ...note,
    createdAt: toTimestampMs(legacyNote.createdAt),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

function compareCreatedAtAscending(
  a: { id: string; createdAt: number },
  b: { id: string; createdAt: number },
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

export const db = syncV2Db;

function isNotDeleted(record: { isDeleted: boolean }): boolean {
  return !record.isDeleted;
}

export function createReadingCheckpointId(
  bookId: string,
  deviceId: string,
): string {
  return `resume:${deviceId}:${bookId}`;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function normalizeCheckpointScrollProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;

  // Accept fractional checkpoint values created by early clients.
  if (value >= 0 && value <= 1) {
    return clampPercentage(value * 100);
  }

  return clampPercentage(value);
}

// ============================================================================
// Helper Functions (Book operations)
// ============================================================================
//
// NOTE: All query helper functions in this file automatically filter out
// soft-deleted records using the isNotDeleted() helper.
// This ensures application code only sees active records.
//
// The raw sync connection can read soft-deleted records when it applies and
// reconciles remote winners.
// ============================================================================

export async function addBook(book: Book): Promise<string> {
  return db.books.add({ ...book, isDeleted: false });
}

/**
 * Add a book with its files atomically in a single transaction
 * This ensures all related data is stored together or not at all
 */
export async function addBookWithFiles(
  book: Book,
  bookFiles: BookFile[],
): Promise<string> {
  return db.transaction("rw", [db.books, db.bookFiles], async () => {
    // Add book first
    const bookId = await db.books.add({ ...book, isDeleted: false });

    // Add book files (extracted EPUB content)
    if (bookFiles.length > 0) {
      await db.bookFiles.bulkAdd(bookFiles);
    }

    return bookId;
  });
}

export async function getBook(id: string): Promise<Book | undefined> {
  const book = await db.books.get(id);
  return book && isNotDeleted(book) ? book : undefined;
}

export async function getAllBooks(): Promise<Book[]> {
  return db.books.filter(isNotDeleted).toArray();
}

export async function deleteBook(id: string): Promise<void> {
  const book = await db.books.get(id);
  if (!book || book.isDeleted) return;

  await db.transaction(
    "rw",
    [
      db.books,
      db.readingCheckpoints,
      db.readingSessions,
      db.highlights,
      db.readingState,
      db.notes,
      db.bookFiles,
      db.bookMaterializations,
      db.bookTextCache,
      db.bookChapterSourceCache,
    ],
    async () => {
      await db.books.delete(id);
      await db.readingCheckpoints.where("bookId").equals(id).delete();
      await db.readingSessions.where("bookId").equals(id).delete();
      await db.highlights.where("bookId").equals(id).delete();
      await db.readingState.where("bookId").equals(id).delete();
      await db.notes.where("bookId").equals(id).delete();
      await db.bookFiles.where("bookId").equals(id).delete();
      await db.bookMaterializations.delete(id);
      await db.bookTextCache.delete(id);
      await db.bookChapterSourceCache.delete(id);
    },
  );
}

export async function getBookBySourceFileId(
  sourceFileId: FileId,
): Promise<Book | undefined> {
  const book = await db.books
    .where("sourceFileId")
    .equals(sourceFileId)
    .first();
  return book && isNotDeleted(book) ? book : undefined;
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
  return db.bookFiles.where("[bookId+path]").equals([bookId, path]).first();
}

export async function getBookFiles(bookId: string): Promise<BookFile[]> {
  return db.bookFiles.where("bookId").equals(bookId).toArray();
}

export async function hasBookFiles(bookId: string): Promise<boolean> {
  return (await db.bookFiles.where("bookId").equals(bookId).count()) > 0;
}

export async function getBookMaterialization(
  bookId: string,
): Promise<BookMaterialization | undefined> {
  return db.bookMaterializations.get(bookId);
}

/**
 * Replace all source-derived local rows and write the completion marker last.
 * The transaction makes partial extraction indistinguishable from no result.
 */
export async function replaceBookMaterialization(options: {
  book: Book;
  bookFiles: BookFile[];
  recipeVersion: number;
  writeBook: boolean;
}): Promise<void> {
  const { book, bookFiles, recipeVersion, writeBook } = options;

  await db.transaction(
    "rw",
    [
      db.books,
      db.bookFiles,
      db.bookMaterializations,
      db.bookTextCache,
      db.bookChapterSourceCache,
    ],
    async () => {
      await db.bookFiles.where("bookId").equals(book.id).delete();
      await db.bookTextCache.delete(book.id);
      await db.bookChapterSourceCache.delete(book.id);

      if (bookFiles.length > 0) {
        await db.bookFiles.bulkPut(bookFiles);
      }
      if (writeBook) {
        await db.books.put({ ...book, isDeleted: false });
      }

      await db.bookMaterializations.put({
        bookId: book.id,
        sourceFileId: book.sourceFileId,
        recipeVersion,
        completedAt: Date.now(),
      });
    },
  );
}

export async function getBookFilesByPaths(
  bookId: string,
  paths: string[],
): Promise<Map<string, BookFile>> {
  if (paths.length === 0) {
    return new Map<string, BookFile>();
  }

  const uniquePaths = [...new Set(paths)];
  const files = await db.bookFiles
    .where("[bookId+path]")
    .anyOf(uniquePaths.map((path) => [bookId, path]))
    .toArray();

  return new Map(files.map((file) => [file.path, file]));
}

export async function getBookChapterSourceCache(
  bookId: string,
): Promise<BookChapterSourceCache | undefined> {
  return db.bookChapterSourceCache.get(bookId);
}

export async function putBookChapterSourceCache(
  bookId: string,
  sourceFileId: FileId,
  chaptersByPath: Record<string, BookChapterSourceCacheEntry>,
  cacheVersion: number,
  publisherResourcesLoaded: boolean,
  publisherFontFaces: BookChapterSourceCache["publisherFontFaces"] = [],
  publisherBodyScaleLoaded = false,
  publisherBodyFontScale?: number,
): Promise<string> {
  await db.bookChapterSourceCache.put({
    bookId,
    sourceFileId,
    cacheVersion,
    publisherResourcesLoaded,
    publisherBodyScaleLoaded,
    ...(publisherBodyFontScale !== undefined ? { publisherBodyFontScale } : {}),
    chaptersByPath,
    publisherFontFaces,
    updatedAt: Date.now(),
  });
  return bookId;
}

// ============================================================================
// Helper Functions (Reading Checkpoints)
// ============================================================================

export async function getReadingCheckpointForDevice(
  bookId: string,
  deviceId: string,
): Promise<ReadingCheckpoint | undefined> {
  const checkpoint = await db.readingCheckpoints.get(
    createReadingCheckpointId(bookId, deviceId),
  );
  return checkpoint && isNotDeleted(checkpoint) ? checkpoint : undefined;
}

export async function getCurrentDeviceReadingCheckpoint(
  bookId: string,
): Promise<ReadingCheckpoint | undefined> {
  return getReadingCheckpointForDevice(bookId, getOrCreateDeviceId());
}

export async function getReadingCheckpointsForBook(
  bookId: string,
): Promise<ReadingCheckpoint[]> {
  return db.readingCheckpoints
    .where("bookId")
    .equals(bookId)
    .filter(isNotDeleted)
    .toArray();
}

/**
 * Returns the latest "lastRead" timestamp per book across all devices.
 *
 * This is the source of truth for "most recently read" ordering in the
 * library: reading checkpoints are written while reading (page turns,
 * periodic flushes, and tab hide). Taking the max across devices means a book
 * read on another device still sorts by its most recent activity.
 */
export async function getAllReadingCheckpointLastReads(): Promise<
  Map<string, number>
> {
  const checkpoints = await db.readingCheckpoints
    .filter(isNotDeleted)
    .toArray();

  const lastReadByBook = new Map<string, number>();
  for (const checkpoint of checkpoints) {
    const existing = lastReadByBook.get(checkpoint.bookId);
    if (existing === undefined || checkpoint.lastRead > existing) {
      lastReadByBook.set(checkpoint.bookId, checkpoint.lastRead);
    }
  }
  return lastReadByBook;
}

export async function upsertReadingCheckpoint(
  checkpoint: Omit<ReadingCheckpoint, "id">,
): Promise<string> {
  const normalizedCheckpoint: ReadingCheckpoint = {
    ...checkpoint,
    id: createReadingCheckpointId(checkpoint.bookId, checkpoint.deviceId),
    scrollProgress: normalizeCheckpointScrollProgress(
      checkpoint.scrollProgress,
    ),
  };

  await db.readingCheckpoints.put({
    ...normalizedCheckpoint,
    isDeleted: false,
  });
  return normalizedCheckpoint.id;
}

export async function upsertCurrentDeviceReadingCheckpoint(
  checkpoint: Omit<ReadingCheckpoint, "id" | "deviceId">,
): Promise<string> {
  return upsertReadingCheckpoint({
    ...checkpoint,
    deviceId: getOrCreateDeviceId(),
  });
}

// ============================================================================
// Helper Functions (Reading Sessions)
// ============================================================================

type CurrentDeviceReadingSessionInput = Omit<ReadingSession, "deviceId">;

function withCurrentDeviceReadingSession(
  session: CurrentDeviceReadingSessionInput,
): ReadingSession {
  return {
    ...session,
    deviceId: getOrCreateDeviceId(),
  };
}

export async function createCurrentDeviceReadingSession(
  session: CurrentDeviceReadingSessionInput,
): Promise<string> {
  const record = withCurrentDeviceReadingSession(session);
  return db.readingSessions.add({ ...record, isDeleted: false });
}

export async function updateCurrentDeviceReadingSession(
  session: CurrentDeviceReadingSessionInput,
): Promise<string> {
  const record = withCurrentDeviceReadingSession(session);
  await db.readingSessions.put({ ...record, isDeleted: false });
  return record.id;
}

export async function endCurrentDeviceReadingSession(
  session: CurrentDeviceReadingSessionInput & { endedAt: number },
): Promise<string> {
  return updateCurrentDeviceReadingSession(session);
}

export async function closeStaleReadingSessionsForCurrentDevice(
  staleBefore: number,
): Promise<number> {
  const deviceId = getOrCreateDeviceId();
  const staleSessions = await db.readingSessions
    .where("[deviceId+lastActiveAt]")
    .between([deviceId, Dexie.minKey], [deviceId, staleBefore])
    .filter((session) => session.endedAt === null && isNotDeleted(session))
    .toArray();

  if (staleSessions.length === 0) return 0;

  await db.readingSessions.bulkPut(
    staleSessions.map((session) => ({
      ...session,
      endedAt: session.lastActiveAt,
    })),
  );

  return staleSessions.length;
}

// ============================================================================
// Helper Functions (Reading Settings)
// ============================================================================

export async function getReadingSettings(): Promise<ReadingSettings> {
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

  await db.readingSettings.add({ ...defaultSettings, isDeleted: false });
  return (await db.readingSettings.get("default"))!;
}

export async function updateReadingSettings(
  settings: Partial<ReadingSettings>,
): Promise<void> {
  const current = await getReadingSettings();
  await db.readingSettings.put({
    ...current,
    ...settings,
    isDeleted: false,
  });
}

// ============================================================================
// Helper Functions (Highlights)
// ============================================================================

export async function addHighlight(highlight: Highlight): Promise<string> {
  return db.highlights.add({ ...highlight, isDeleted: false });
}

export async function getHighlights(
  bookId: string,
  spineItemId: string,
): Promise<Highlight[]> {
  const highlights = await db.highlights
    .where("bookId")
    .equals(bookId)
    .and((h) => h.spineItemId === spineItemId && isNotDeleted(h))
    .toArray();

  return highlights.map(normalizeHighlightTimestamps);
}

export async function getBookHighlights(bookId: string): Promise<Highlight[]> {
  const highlights = await db.highlights
    .where("bookId")
    .equals(bookId)
    .filter(isNotDeleted)
    .toArray();

  return highlights.map(normalizeHighlightTimestamps);
}

export async function deleteHighlight(id: string): Promise<void> {
  const highlight = await db.highlights.get(id);
  if (!highlight || highlight.isDeleted) return;

  await db.highlights.delete(id);
}

export async function updateHighlight(
  id: string,
  changes: Partial<Highlight>,
): Promise<void> {
  const highlight = await db.highlights.get(id);
  if (!highlight || isNotDeleted(highlight) === false) return;

  await db.highlights.put({
    ...normalizeHighlightTimestamps(highlight),
    ...changes,
    updatedAt: Date.now(),
  });
}

export async function getAllHighlights(): Promise<Highlight[]> {
  const highlights = await db.highlights.filter(isNotDeleted).toArray();
  return highlights.map(normalizeHighlightTimestamps);
}

// ============================================================================
// Helper Functions (Notes)
// ============================================================================

export async function addNote(note: Note): Promise<string> {
  return db.notes.add({ ...note, isDeleted: false });
}

export async function getNotesByAnnotation(
  annotationId: string,
): Promise<Note[]> {
  const notes = await db.notes
    .where("annotationId")
    .equals(annotationId)
    .filter(isNotDeleted)
    .toArray();

  return notes.map(normalizeNoteTimestamps).sort(compareCreatedAtAscending);
}

export async function getChapterNotes(
  bookId: string,
  spineItemId: string,
): Promise<Note[]> {
  const notes = await db.notes
    .where("[bookId+spineItemId]")
    .equals([bookId, spineItemId])
    .filter((n) => n.annotationType === "chapter" && isNotDeleted(n))
    .toArray();

  return notes.map(normalizeNoteTimestamps).sort(compareCreatedAtAscending);
}

export async function updateNote(id: string, content: string): Promise<void> {
  const note = await db.notes.get(id);
  if (!note || !isNotDeleted(note)) return;

  await db.notes.put({
    ...normalizeNoteTimestamps(note),
    content,
    updatedAt: Date.now(),
  });
}

export async function deleteNote(id: string): Promise<void> {
  const note = await db.notes.get(id);
  if (!note || note.isDeleted) return;

  await db.notes.delete(id);
}

export async function getAllNotes(): Promise<Note[]> {
  const notes = await db.notes.filter(isNotDeleted).toArray();
  return notes.map(normalizeNoteTimestamps);
}

// ============================================================================
// Helper Functions (Reading State)
// ============================================================================

export async function setReadingStatus(
  bookId: string,
  status: ReadingState["status"],
): Promise<string> {
  const now = Date.now();
  const entry: ReadingState = {
    id: crypto.randomUUID(),
    bookId,
    status,
    timestamp: now,
    createdAt: now,
  };
  return db.readingState.add({ ...entry, isDeleted: false });
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
  const latestByBook = new Map<string, StoredReadingState>();
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
): Promise<ReadingState[]> {
  return db.readingState
    .where("bookId")
    .equals(bookId)
    .filter(isNotDeleted)
    .sortBy("timestamp");
}

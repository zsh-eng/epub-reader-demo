/**
 * Database Layer
 *
 * Local database helpers over the clean sync v2 Dexie schema.
 */

import type { StoredFile, TransferTask } from "@/lib/files/types";
import {
  syncV2Db,
  type SyncV2Highlight,
  type SyncV2Note,
  type SyncV2ReadingProgress,
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
  fileHash: string; // Content hash of the EPUB file (also used to fetch via FileManager)
  title: string;
  author: string;
  fileSize: number;
  dateAdded: number;
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
  scrollProgress: number; // Legacy data may be either 0-1 fraction or 0-100 percentage
  pageNumber?: number; // For paginated mode
  lastRead: number; // Timestamp when this progress was recorded
  createdAt: number; // When this record was created
  deviceId: string; // Device that recorded this historical position
  /** What triggered this progress save (for filtering jump-back history) */
  triggerType?: ProgressTriggerType;
  /** Fragment or highlight ID for precise scroll restoration */
  targetElementId?: string;
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
  id: string; // Primary key (matches Book.id)
  bookId: string; // Foreign key to Book
  path: string; // Path within the EPUB (e.g., "OEBPS/chapter1.xhtml")
  content: Blob; // The actual file content
  mediaType: string;
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
  fileHash: string;
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

type StoredReadingProgress = SyncV2ReadingProgress;
type StoredHighlight = SyncV2Highlight;
type StoredReadingState = SyncV2ReadingState;
type StoredNote = SyncV2Note;

// Re-export Highlight and Note types for convenience
export type { ReadingState, ReadingStatus } from "@/types/reading-state";
export type { Highlight, Note };

// Re-export StoredFile type for convenience
export type { StoredFile, TransferTask };

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

  // Legacy readingProgress rows may still store fractional 0-1 values.
  if (value >= 0 && value <= 1) {
    return clampPercentage(value * 100);
  }

  return clampPercentage(value);
}

function isLegacyProgressNewer(
  candidate: StoredReadingProgress,
  current: StoredReadingProgress,
): boolean {
  if (candidate.lastRead !== current.lastRead) {
    return candidate.lastRead > current.lastRead;
  }

  if (candidate.createdAt !== current.createdAt) {
    return candidate.createdAt > current.createdAt;
  }

  return candidate.id > current.id;
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
  return db.transaction("rw", [db.books, db.bookFiles, db.files], async () => {
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
      db.readingProgress,
      db.readingCheckpoints,
      db.readingSessions,
      db.highlights,
      db.readingState,
      db.notes,
      db.bookFiles,
      db.bookTextCache,
      db.bookChapterSourceCache,
    ],
    async () => {
      await db.books.delete(id);
      await db.readingProgress.where("bookId").equals(id).delete();
      await db.readingCheckpoints.where("bookId").equals(id).delete();
      await db.readingSessions.where("bookId").equals(id).delete();
      await db.highlights.where("bookId").equals(id).delete();
      await db.readingState.where("bookId").equals(id).delete();
      await db.notes.where("bookId").equals(id).delete();
      await db.bookFiles.where("bookId").equals(id).delete();
      await db.bookTextCache.delete(id);
      await db.bookChapterSourceCache.delete(id);
    },
  );
}

export async function getBookByFileHash(
  fileHash: string,
): Promise<Book | undefined> {
  const book = await db.books.where("fileHash").equals(fileHash).first();
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
  fileHash: string,
  chaptersByPath: Record<string, BookChapterSourceCacheEntry>,
  cacheVersion: number,
  publisherResourcesLoaded: boolean,
  publisherFontFaces: BookChapterSourceCache["publisherFontFaces"] = [],
  publisherBodyScaleLoaded = false,
  publisherBodyFontScale?: number,
): Promise<string> {
  await db.bookChapterSourceCache.put({
    bookId,
    fileHash,
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
// Helper Functions (Reading Progress)
// ============================================================================

export async function saveReadingProgress(
  progress: Omit<ReadingProgress, "id" | "createdAt" | "deviceId">,
): Promise<string> {
  const record: ReadingProgress = {
    ...progress,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    deviceId: getOrCreateDeviceId(),
  };
  return db.readingProgress.add({ ...record, isDeleted: false });
}

export async function getReadingProgress(
  bookId: string,
): Promise<ReadingProgress | undefined> {
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
): Promise<ReadingProgress[]> {
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

export interface BackfillLegacyReadingProgressCheckpointsOptions {
  /** Build the checkpoint rows and summary without mutating IndexedDB. */
  dryRun?: boolean;
}

export interface BackfillLegacyReadingProgressCheckpointsBookSummary {
  bookId: string;
  title: string | null;
  progressRowsConsidered: number;
  checkpointsGenerated: number;
  devicesConsidered: number;
  latestLastRead: number | null;
}

export interface BackfillLegacyReadingProgressCheckpointsResult {
  dryRun: boolean;
  progressRowsRead: number;
  progressRowsConsidered: number;
  progressRowsSkipped: number;
  checkpointsGenerated: number;
  existingCheckpointsOverwritten: number;
  bookSummaries: BackfillLegacyReadingProgressCheckpointsBookSummary[];
}

type MutableCheckpointBookSummary =
  BackfillLegacyReadingProgressCheckpointsBookSummary & {
    deviceIds: Set<string>;
  };

function createCheckpointFromLegacyProgress(
  row: StoredReadingProgress,
): ReadingCheckpoint {
  return {
    id: createReadingCheckpointId(row.bookId, row.deviceId),
    bookId: row.bookId,
    deviceId: row.deviceId,
    currentSpineIndex: row.currentSpineIndex,
    scrollProgress: normalizeCheckpointScrollProgress(row.scrollProgress),
    lastRead: row.lastRead,
  };
}

/**
 * Rebuilds per-device resume checkpoints from the legacy append-only
 * `readingProgress` stream.
 *
 * This helper is intentionally manual and rerunnable. It should run only after
 * legacy progress has synced locally, then it overwrites the latest checkpoint
 * for each book/device pair as a normal local write so the sync middleware can
 * push the generated rows to the server.
 */
export async function backfillLegacyReadingProgressCheckpoints(
  options: BackfillLegacyReadingProgressCheckpointsOptions = {},
): Promise<BackfillLegacyReadingProgressCheckpointsResult> {
  const dryRun = options.dryRun ?? false;

  return db.transaction(
    "rw",
    [db.books, db.readingProgress, db.readingCheckpoints],
    async () => {
      const activeBooks = await db.books.filter(isNotDeleted).toArray();
      const activeBookIds = new Set(activeBooks.map((book) => book.id));
      const bookTitles = new Map(
        activeBooks.map((book) => [book.id, book.title]),
      );
      const progressRows = await db.readingProgress
        .filter(isNotDeleted)
        .toArray();
      const latestByCheckpointId = new Map<string, StoredReadingProgress>();
      const bookSummariesById = new Map<string, MutableCheckpointBookSummary>();

      for (const row of progressRows) {
        if (!row.bookId || !row.deviceId) continue;
        if (!activeBookIds.has(row.bookId)) continue;

        const summary = bookSummariesById.get(row.bookId) ?? {
          bookId: row.bookId,
          title: bookTitles.get(row.bookId) ?? null,
          progressRowsConsidered: 0,
          checkpointsGenerated: 0,
          devicesConsidered: 0,
          latestLastRead: null,
          deviceIds: new Set<string>(),
        };

        summary.progressRowsConsidered += 1;
        summary.latestLastRead =
          summary.latestLastRead === null
            ? row.lastRead
            : Math.max(summary.latestLastRead, row.lastRead);
        summary.deviceIds.add(row.deviceId);
        summary.devicesConsidered = summary.deviceIds.size;
        bookSummariesById.set(row.bookId, summary);

        const checkpointId = createReadingCheckpointId(
          row.bookId,
          row.deviceId,
        );
        const existing = latestByCheckpointId.get(checkpointId);

        if (!existing || isLegacyProgressNewer(row, existing)) {
          latestByCheckpointId.set(checkpointId, row);
        }
      }

      const checkpoints = Array.from(latestByCheckpointId.values()).map(
        createCheckpointFromLegacyProgress,
      );
      const existingCheckpoints = await db.readingCheckpoints.bulkGet(
        checkpoints.map((checkpoint) => checkpoint.id),
      );
      const existingCheckpointsOverwritten =
        existingCheckpoints.filter(Boolean).length;

      for (const checkpoint of checkpoints) {
        const summary = bookSummariesById.get(checkpoint.bookId);
        if (summary) {
          summary.checkpointsGenerated += 1;
        }
      }

      const bookSummaries = Array.from(bookSummariesById.values())
        .map(({ deviceIds: _deviceIds, ...summary }) => summary)
        .sort((a, b) => {
          if (b.checkpointsGenerated !== a.checkpointsGenerated) {
            return b.checkpointsGenerated - a.checkpointsGenerated;
          }
          return a.bookId.localeCompare(b.bookId);
        });

      const progressRowsConsidered = Array.from(
        bookSummariesById.values(),
      ).reduce((total, summary) => total + summary.progressRowsConsidered, 0);
      const result: BackfillLegacyReadingProgressCheckpointsResult = {
        dryRun,
        progressRowsRead: progressRows.length,
        progressRowsConsidered,
        progressRowsSkipped: progressRows.length - progressRowsConsidered,
        checkpointsGenerated: checkpoints.length,
        existingCheckpointsOverwritten,
        bookSummaries,
      };

      if (dryRun || checkpoints.length === 0) return result;

      await db.readingCheckpoints.bulkPut(
        checkpoints.map((checkpoint) => ({
          ...checkpoint,
          isDeleted: false,
        })),
      );

      return result;
    },
  );
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

const LEGACY_READING_PROGRESS_SESSION_ID_PREFIX = "legacy-reading-progress:v1:";

export interface BackfillLegacyReadingProgressSessionsOptions {
  /**
   * Gap after which old progress rows are treated as separate sessions.
   * Gaps over this threshold are excluded entirely from active time.
   */
  idleTimeoutMs?: number;
  /** Build the inferred sessions and summary without mutating IndexedDB. */
  dryRun?: boolean;
}

export interface BackfillLegacyReadingProgressSessionsBookSummary {
  bookId: string;
  title: string | null;
  progressRowsConsidered: number;
  sessionsGenerated: number;
  activeMs: number;
  firstStartedAt: number | null;
  lastActiveAt: number | null;
}

export interface BackfillLegacyReadingProgressSessionsResult {
  dryRun: boolean;
  progressRowsRead: number;
  progressRowsConsidered: number;
  progressRowsSkipped: number;
  sessionsGenerated: number;
  existingLegacySessions: number;
  legacySessionsSoftDeleted: number;
  activeMs: number;
  bookSummaries: BackfillLegacyReadingProgressSessionsBookSummary[];
}

interface LegacyReadingProgressSessionDraft {
  bookId: string;
  deviceId: string;
  startedAt: number;
  lastActiveAt: number;
  activeMs: number;
  startSpineIndex: number;
  startScrollProgress: number;
  endSpineIndex: number;
  endScrollProgress: number;
}

function createLegacyReadingProgressSessionId(
  deviceId: string,
  bookId: string,
  startedAt: number,
): string {
  return `${LEGACY_READING_PROGRESS_SESSION_ID_PREFIX}${deviceId}:${bookId}:${startedAt}`;
}

function createLegacyReadingProgressReaderInstanceId(
  deviceId: string,
  bookId: string,
  startedAt: number,
): string {
  return `legacy-import:${deviceId}:${bookId}:${startedAt}`;
}

function isLegacyReadingProgressSession(session: ReadingSession): boolean {
  return session.id.startsWith(LEGACY_READING_PROGRESS_SESSION_ID_PREFIX);
}

function compareLegacyReadingProgressRows(
  a: StoredReadingProgress,
  b: StoredReadingProgress,
): number {
  const deviceCompare = a.deviceId.localeCompare(b.deviceId);
  if (deviceCompare !== 0) return deviceCompare;

  const bookCompare = a.bookId.localeCompare(b.bookId);
  if (bookCompare !== 0) return bookCompare;

  if (a.lastRead !== b.lastRead) return a.lastRead - b.lastRead;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

function createLegacyReadingProgressSessionDraft(
  row: StoredReadingProgress,
): LegacyReadingProgressSessionDraft {
  const scrollProgress = normalizeCheckpointScrollProgress(row.scrollProgress);

  return {
    bookId: row.bookId,
    deviceId: row.deviceId,
    startedAt: row.lastRead,
    lastActiveAt: row.lastRead,
    activeMs: 0,
    startSpineIndex: row.currentSpineIndex,
    startScrollProgress: scrollProgress,
    endSpineIndex: row.currentSpineIndex,
    endScrollProgress: scrollProgress,
  };
}

function appendLegacyReadingProgressRowToSessionDraft(
  draft: LegacyReadingProgressSessionDraft,
  row: StoredReadingProgress,
): void {
  const gap = row.lastRead - draft.lastActiveAt;
  if (gap >= 0) {
    draft.activeMs += gap;
  }

  draft.lastActiveAt = row.lastRead;
  draft.endSpineIndex = row.currentSpineIndex;
  draft.endScrollProgress = normalizeCheckpointScrollProgress(
    row.scrollProgress,
  );
}

function createReadingSessionFromLegacyDraft(
  draft: LegacyReadingProgressSessionDraft,
): ReadingSession {
  return {
    id: createLegacyReadingProgressSessionId(
      draft.deviceId,
      draft.bookId,
      draft.startedAt,
    ),
    bookId: draft.bookId,
    deviceId: draft.deviceId,
    readerInstanceId: createLegacyReadingProgressReaderInstanceId(
      draft.deviceId,
      draft.bookId,
      draft.startedAt,
    ),
    startedAt: draft.startedAt,
    endedAt: draft.lastActiveAt,
    lastActiveAt: draft.lastActiveAt,
    activeMs: draft.activeMs,
    startSpineIndex: draft.startSpineIndex,
    startScrollProgress: draft.startScrollProgress,
    endSpineIndex: draft.endSpineIndex,
    endScrollProgress: draft.endScrollProgress,
  };
}

function inferLegacyReadingProgressSessions(
  rows: StoredReadingProgress[],
  idleTimeoutMs: number,
): ReadingSession[] {
  const sessions: ReadingSession[] = [];
  let current: LegacyReadingProgressSessionDraft | null = null;

  for (const row of rows) {
    if (!current) {
      current = createLegacyReadingProgressSessionDraft(row);
      continue;
    }

    const shouldStartNewSession =
      current.bookId !== row.bookId ||
      current.deviceId !== row.deviceId ||
      row.lastRead - current.lastActiveAt > idleTimeoutMs;

    if (shouldStartNewSession) {
      sessions.push(createReadingSessionFromLegacyDraft(current));

      current = createLegacyReadingProgressSessionDraft(row);
      continue;
    }

    appendLegacyReadingProgressRowToSessionDraft(current, row);
  }

  if (current) {
    sessions.push(createReadingSessionFromLegacyDraft(current));
  }

  return sessions;
}

/**
 * Rebuilds inferred reading sessions from the legacy append-only
 * `readingProgress` stream.
 *
 * This is intentionally a manual, rerunnable helper rather than an IndexedDB
 * version migration: it should run only after the old progress table has had a
 * chance to sync. Reruns soft-delete previous legacy-imported sessions, then
 * write the freshly inferred set so newly synced rows can bridge or remove
 * earlier inferred sessions deterministically.
 */
export async function backfillLegacyReadingProgressSessions(
  options: BackfillLegacyReadingProgressSessionsOptions = {},
): Promise<BackfillLegacyReadingProgressSessionsResult> {
  const idleTimeoutMs =
    options.idleTimeoutMs ?? READING_SESSION_IDLE_TIMEOUT_MS;
  const dryRun = options.dryRun ?? false;

  return db.transaction(
    "rw",
    [db.books, db.readingProgress, db.readingSessions],
    async () => {
      const activeBooks = await db.books.filter(isNotDeleted).toArray();
      const activeBookIds = new Set(activeBooks.map((book) => book.id));
      const bookTitles = new Map(
        activeBooks.map((book) => [book.id, book.title]),
      );
      const progressRows = await db.readingProgress
        .filter(isNotDeleted)
        .toArray();
      const usableRows = progressRows
        .filter((row) => activeBookIds.has(row.bookId))
        .sort(compareLegacyReadingProgressRows);
      const inferredSessions = inferLegacyReadingProgressSessions(
        usableRows,
        idleTimeoutMs,
      );
      const existingLegacySessions = await db.readingSessions
        .filter(
          (session) =>
            isLegacyReadingProgressSession(session) && isNotDeleted(session),
        )
        .toArray();
      const activeMs = inferredSessions.reduce(
        (total, session) => total + session.activeMs,
        0,
      );
      const bookSummariesById = new Map<
        string,
        BackfillLegacyReadingProgressSessionsBookSummary
      >();

      for (const row of usableRows) {
        const summary = bookSummariesById.get(row.bookId) ?? {
          bookId: row.bookId,
          title: bookTitles.get(row.bookId) ?? null,
          progressRowsConsidered: 0,
          sessionsGenerated: 0,
          activeMs: 0,
          firstStartedAt: null,
          lastActiveAt: null,
        };

        summary.progressRowsConsidered += 1;
        bookSummariesById.set(row.bookId, summary);
      }

      for (const session of inferredSessions) {
        const summary = bookSummariesById.get(session.bookId) ?? {
          bookId: session.bookId,
          title: bookTitles.get(session.bookId) ?? null,
          progressRowsConsidered: 0,
          sessionsGenerated: 0,
          activeMs: 0,
          firstStartedAt: null,
          lastActiveAt: null,
        };

        summary.sessionsGenerated += 1;
        summary.activeMs += session.activeMs;
        summary.firstStartedAt =
          summary.firstStartedAt === null
            ? session.startedAt
            : Math.min(summary.firstStartedAt, session.startedAt);
        summary.lastActiveAt =
          summary.lastActiveAt === null
            ? session.lastActiveAt
            : Math.max(summary.lastActiveAt, session.lastActiveAt);
        bookSummariesById.set(session.bookId, summary);
      }

      const bookSummaries = Array.from(bookSummariesById.values()).sort(
        (a, b) => b.activeMs - a.activeMs,
      );

      const result: BackfillLegacyReadingProgressSessionsResult = {
        dryRun,
        progressRowsRead: progressRows.length,
        progressRowsConsidered: usableRows.length,
        progressRowsSkipped: progressRows.length - usableRows.length,
        sessionsGenerated: inferredSessions.length,
        existingLegacySessions: existingLegacySessions.length,
        legacySessionsSoftDeleted: dryRun ? 0 : existingLegacySessions.length,
        activeMs,
        bookSummaries,
      };

      if (dryRun) return result;

      if (existingLegacySessions.length > 0) {
        await db.readingSessions.bulkDelete(
          existingLegacySessions.map((session) => session.id),
        );
      }

      if (inferredSessions.length > 0) {
        await db.readingSessions.bulkPut(
          inferredSessions.map((session) => ({
            ...session,
            isDeleted: false,
          })),
        );
      }

      return result;
    },
  );
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

// ============================================================================
// Helper Functions (Book Queries - Compatibility)
// ============================================================================

export async function getNotDownloadedBooks(): Promise<Book[]> {
  return db.books
    .filter((book) => !book.isDownloaded && isNotDeleted(book))
    .toArray();
}

export async function markBookAsDownloaded(bookId: string): Promise<void> {
  await db.books.update(bookId, {
    isDownloaded: 1,
  });
}

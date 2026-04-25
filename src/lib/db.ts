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
import { getHLCService } from "@/lib/sync/hlc/hlc";
import {
  UNSYNCED_TIMESTAMP,
  type WithSyncMetadata,
} from "@/lib/sync/hlc/schema";
import { generateDexieStores } from "@/lib/sync/hlc/schema";
import type { Highlight } from "@/types/highlight";
import type { Note } from "@/types/note";
import type { ReadingState } from "@/types/reading-state";
import Dexie, { type Table } from "dexie";
import { getOrCreateDeviceId } from "./device";
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
  scrollProgress: number; // Legacy data may be either 0-1 fraction or 0-100 percentage
  pageNumber?: number; // For paginated mode
  lastRead: number; // Timestamp when this progress was recorded
  createdAt: number; // When this record was created
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
export const READER_V2_READING_SESSION_SOURCE = "reader-v2" as const;
export const LEGACY_READING_PROGRESS_SESSION_SOURCE =
  "legacy-reading-progress" as const;

export type ReadingSessionSource =
  | typeof READER_V2_READING_SESSION_SOURCE
  | typeof LEGACY_READING_PROGRESS_SESSION_SOURCE;

export interface ReadingSession {
  id: string; // UUID primary key for this reader-open session
  bookId: string; // Foreign key to Book
  deviceId: string; // Device that owns this session
  readerInstanceId: string; // Ephemeral mounted reader/window instance
  source: ReadingSessionSource; // Native reader session or inferred legacy backfill
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
export type SyncedReadingCheckpoint = WithSyncMetadata<ReadingCheckpoint>;
export type SyncedReadingSession = WithSyncMetadata<ReadingSession>;
export type SyncedHighlight = WithSyncMetadata<Highlight>;
export type SyncedReadingSettings = WithSyncMetadata<ReadingSettings>;
export type SyncedReadingState = WithSyncMetadata<ReadingState>;
export type SyncedNote = WithSyncMetadata<Note>;

// Re-export Highlight and Note types for convenience
export type { ReadingState, ReadingStatus } from "@/types/reading-state";
export type { Highlight, Note };

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

export function createBookImageDimensionId(
  bookId: string,
  path: string,
): string {
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

    const parsed = await extractImageDimensionsFromBlob(
      file.content,
      file.mediaType,
    );
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
  readingCheckpoints!: Table<SyncedReadingCheckpoint, string>;
  readingSessions!: Table<SyncedReadingSession, string>;
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

    // Version 8: Add per-device reading checkpoints.
    //
    // Legacy progress import is intentionally manual instead of an IndexedDB
    // migration because remote `readingProgress` rows may only arrive after the
    // normal sync service starts.
    this.version(8).stores({
      ...syncSchemas,
      ...LOCAL_TABLES,
    });

    // Version 9: Add mutable reading session rows for active-time analytics
    this.version(9).stores({
      ...syncSchemas,
      ...LOCAL_TABLES,
    });

    // Note: Sync middleware is registered by sync-service.ts to avoid circular imports
  }
}

export const db = new EPUBReaderDB();

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
  candidate: SyncedReadingProgress,
  current: SyncedReadingProgress,
): boolean {
  if (candidate.lastRead !== current.lastRead) {
    return candidate.lastRead > current.lastRead;
  }

  if (candidate.createdAt !== current.createdAt) {
    return candidate.createdAt > current.createdAt;
  }

  return candidate._hlc > current._hlc;
}

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
  const rows = await db.bookImageDimensions
    .where("bookId")
    .equals(bookId)
    .toArray();
  return new Map(
    rows.map((row) => [row.path, { width: row.width, height: row.height }]),
  );
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
// Helper Functions (Reading Checkpoints)
// ============================================================================

export async function getReadingCheckpointForDevice(
  bookId: string,
  deviceId: string,
): Promise<SyncedReadingCheckpoint | undefined> {
  const checkpoint = await db.readingCheckpoints.get(
    createReadingCheckpointId(bookId, deviceId),
  );
  return checkpoint && isNotDeleted(checkpoint) ? checkpoint : undefined;
}

export async function getCurrentDeviceReadingCheckpoint(
  bookId: string,
): Promise<SyncedReadingCheckpoint | undefined> {
  return getReadingCheckpointForDevice(bookId, getOrCreateDeviceId());
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

  await db.readingCheckpoints.put(
    normalizedCheckpoint as SyncedReadingCheckpoint,
  );
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
  row: SyncedReadingProgress,
): ReadingCheckpoint {
  return {
    id: createReadingCheckpointId(row.bookId, row._deviceId),
    bookId: row.bookId,
    deviceId: row._deviceId,
    currentSpineIndex: row.currentSpineIndex,
    scrollProgress: normalizeCheckpointScrollProgress(row.scrollProgress),
    lastRead: row.lastRead,
  };
}

function addFallbackSyncMetadataToCheckpoints(
  checkpoints: ReadingCheckpoint[],
): SyncedReadingCheckpoint[] {
  const writerDeviceId = getOrCreateDeviceId();
  const hlcTimestamps = getHLCService().nextBatch(checkpoints.length);

  return checkpoints.map((checkpoint, index) => ({
    ...checkpoint,
    _hlc: hlcTimestamps[index],
    _deviceId: writerDeviceId,
    _serverTimestamp: UNSYNCED_TIMESTAMP,
    _isDeleted: 0,
  }));
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
      const progressRows = (await db.readingProgress
        .filter(isNotDeleted)
        .toArray()) as SyncedReadingProgress[];
      const latestByCheckpointId = new Map<string, SyncedReadingProgress>();
      const bookSummariesById = new Map<string, MutableCheckpointBookSummary>();

      for (const row of progressRows) {
        if (!row.bookId || !row._deviceId) continue;
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
        summary.deviceIds.add(row._deviceId);
        summary.devicesConsidered = summary.deviceIds.size;
        bookSummariesById.set(row.bookId, summary);

        const checkpointId = createReadingCheckpointId(
          row.bookId,
          row._deviceId,
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
      const existingCheckpointsOverwritten = existingCheckpoints.filter(
        Boolean,
      ).length;

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
        addFallbackSyncMetadataToCheckpoints(checkpoints),
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
  return db.readingSessions.add(record as SyncedReadingSession);
}

export async function updateCurrentDeviceReadingSession(
  session: CurrentDeviceReadingSessionInput,
): Promise<string> {
  const record = withCurrentDeviceReadingSession(session);
  await db.readingSessions.put(record as SyncedReadingSession);
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

const LEGACY_READING_PROGRESS_SESSION_ID_PREFIX = `${LEGACY_READING_PROGRESS_SESSION_SOURCE}:v1:`;

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
  return session.source === LEGACY_READING_PROGRESS_SESSION_SOURCE;
}

function compareLegacyReadingProgressRows(
  a: SyncedReadingProgress,
  b: SyncedReadingProgress,
): number {
  const deviceCompare = a._deviceId.localeCompare(b._deviceId);
  if (deviceCompare !== 0) return deviceCompare;

  const bookCompare = a.bookId.localeCompare(b.bookId);
  if (bookCompare !== 0) return bookCompare;

  if (a.lastRead !== b.lastRead) return a.lastRead - b.lastRead;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

function createLegacyReadingProgressSessionDraft(
  row: SyncedReadingProgress,
): LegacyReadingProgressSessionDraft {
  const scrollProgress = normalizeCheckpointScrollProgress(row.scrollProgress);

  return {
    bookId: row.bookId,
    deviceId: row._deviceId,
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
  row: SyncedReadingProgress,
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
    source: LEGACY_READING_PROGRESS_SESSION_SOURCE,
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
  rows: SyncedReadingProgress[],
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
      current.deviceId !== row._deviceId ||
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
      const progressRows = (await db.readingProgress
        .filter(isNotDeleted)
        .toArray()) as SyncedReadingProgress[];
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
        await db.readingSessions.bulkPut(
          existingLegacySessions.map((session) => ({
            ...session,
            _isDeleted: 1,
          })),
        );
      }

      if (inferredSessions.length > 0) {
        await db.readingSessions.bulkPut(
          inferredSessions as SyncedReadingSession[],
        );
      }

      return result;
    },
  );
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

export async function getBookHighlights(
  bookId: string,
): Promise<SyncedHighlight[]> {
  return db.highlights
    .where("bookId")
    .equals(bookId)
    .filter(isNotDeleted)
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

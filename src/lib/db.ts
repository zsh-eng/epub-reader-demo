import type { Highlight } from "@/types/highlight";
import Dexie, { type Table } from "dexie";

// Database interfaces matching the spec
export interface Book {
  id: string; // Primary key (UUID)
  fileHash: string; // xxhash 64-bit hex string (unique)
  title: string;
  author: string;
  coverImagePath?: string; // Path to cover image file within the EPUB
  dateAdded: Date;
  lastOpened?: Date;
  fileSize: number;
  manifest: ManifestItem[];
  spine: SpineItem[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toc: any[]; // TOCItem[] - using any to avoid Dexie recursive type issues
  metadata: {
    publisher?: string;
    language?: string;
    isbn?: string;
    description?: string;
    publicationDate?: string;
  };
  // Sync-related fields
  isDownloaded: number; // Whether the EPUB file is stored locally
  remoteEpubUrl?: string; // URL to download the EPUB from server (if not downloaded)
  remoteCoverUrl?: string; // URL to the cover image on server (if not downloaded)
}

// Sync state tracking for each book
export interface BookSyncState {
  fileHash: string; // PK, matches Book.fileHash
  status:
    | "pending_upload"
    | "uploading"
    | "synced"
    | "error"
    | "pending_download";
  lastSyncedAt?: Date; // When we last successfully synced
  lastServerTimestamp?: number; // Server's updatedAt when we last synced
  epubUploaded: boolean; // Whether the EPUB file is on R2
  coverUploaded: boolean; // Whether the cover is on R2
  errorMessage?: string;
  retryCount: number;
}

// Sync log for debugging
export interface SyncLog {
  id: string; // UUID
  timestamp: Date;
  direction: "push" | "pull";
  entityType: "book" | "progress" | "highlight";
  entityId: string; // fileHash for books
  action: "create" | "update" | "delete" | "download" | "upload";
  status: "success" | "failure";
  errorMessage?: string;
  durationMs?: number;
}

// Cursor for pagination in sync
export interface SyncCursor {
  id: string; // 'books' | 'progress' | etc.
  lastServerTimestamp: number; // The timestamp for pagination
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
  dateStored: Date;
}

export interface ReadingProgress {
  id: string; // Primary key (matches Book.id)
  bookId: string; // Foreign key to Book
  currentSpineIndex: number; // Current position in spine
  scrollProgress: number; // 0-1 for scroll mode
  pageNumber?: number; // For paginated mode
  lastRead: Date;
}

// TODO: Update the reading settings types to reflect the current settings
export interface ReadingSettings {
  id: string; // Primary key (single record, use 'default')
  fontSize: number; // In pixels (16-24)
  lineHeight: number; // Multiplier (1.2-2.0)
  mode: "scroll" | "paginated";
  theme?: "light" | "dark" | "sepia";
}

// Database class
class EPUBReaderDB extends Dexie {
  books!: Table<Book, string>;
  bookFiles!: Table<BookFile, string>;
  readingProgress!: Table<ReadingProgress, string>;
  readingSettings!: Table<ReadingSettings, string>;
  highlights!: Table<Highlight, string>;
  // Sync tables
  bookSyncState!: Table<BookSyncState, string>;
  syncLog!: Table<SyncLog, string>;
  syncCursor!: Table<SyncCursor, string>;
  epubBlobs!: Table<EpubBlob, string>;

  constructor() {
    super("epub-reader-db");

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
    this.version(4)
      .stores({
        books:
          "id, &fileHash, title, author, dateAdded, lastOpened, isDownloaded",
        bookFiles: "id, bookId, path",
        readingProgress: "id, bookId, lastRead",
        readingSettings: "id",
        highlights: "id, bookId, spineItemId, createdAt",
        // New sync tables
        bookSyncState: "fileHash, status",
        syncLog: "id, timestamp, entityType, status",
        syncCursor: "id",
      })
      .upgrade((tx) => {
        // Migrate existing books to have isDownloaded = true (they are local)
        return tx
          .table("books")
          .toCollection()
          .modify((book) => {
            book.isDownloaded = 1;
          });
      });

    // Version 5: Add epubBlobs table for storing original EPUB files
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
    });
  }
}

// Create and export database instance
export const db = new EPUBReaderDB();

// Helper functions for common operations
export async function addBook(book: Book): Promise<string> {
  return await db.books.add(book);
}

export async function getBook(id: string): Promise<Book | undefined> {
  return await db.books.get(id);
}

export async function getAllBooks(): Promise<Book[]> {
  return await db.books.orderBy("dateAdded").reverse().toArray();
}

export async function deleteBook(id: string): Promise<void> {
  // Get the book first to find its fileHash for sync state cleanup
  const book = await db.books.get(id);

  await db.transaction(
    "rw",
    [
      db.books,
      db.bookFiles,
      db.readingProgress,
      db.highlights,
      db.bookSyncState,
      db.epubBlobs,
    ],
    async () => {
      await db.books.delete(id);
      await db.bookFiles.where("bookId").equals(id).delete();
      await db.readingProgress.delete(id);
      await db.highlights.where("bookId").equals(id).delete();
      // Also clean up sync state and EPUB blob if we have the fileHash
      if (book?.fileHash) {
        await db.bookSyncState.delete(book.fileHash);
        await db.epubBlobs.delete(book.fileHash);
      }
    },
  );
}

export async function getBookByFileHash(
  fileHash: string,
): Promise<Book | undefined> {
  return await db.books.where("fileHash").equals(fileHash).first();
}

export async function updateBookLastOpened(id: string): Promise<void> {
  await db.books.update(id, { lastOpened: new Date() });
}

export async function addBookFile(bookFile: BookFile): Promise<string> {
  return await db.bookFiles.add(bookFile);
}

export async function getBookFile(
  bookId: string,
  path: string,
): Promise<BookFile | undefined> {
  return await db.bookFiles
    .where("bookId")
    .equals(bookId)
    .and((file) => file.path === path)
    .first();
}

export async function getBookFiles(bookId: string): Promise<BookFile[]> {
  return await db.bookFiles.where("bookId").equals(bookId).toArray();
}

export async function saveReadingProgress(
  progress: ReadingProgress,
): Promise<void> {
  await db.readingProgress.put(progress);
}

export async function getReadingProgress(
  bookId: string,
): Promise<ReadingProgress | undefined> {
  return await db.readingProgress.get(bookId);
}

export async function getReadingSettings(): Promise<ReadingSettings> {
  const settings = await db.readingSettings.get("default");
  if (!settings) {
    // Return default settings
    const defaultSettings: ReadingSettings = {
      id: "default",
      fontSize: 18,
      lineHeight: 1.6,
      mode: "scroll",
      theme: "light",
    };
    await db.readingSettings.put(defaultSettings);
    return defaultSettings;
  }
  return settings;
}

export async function updateReadingSettings(
  settings: Partial<ReadingSettings>,
): Promise<void> {
  const current = await getReadingSettings();
  await db.readingSettings.put({ ...current, ...settings });
}

/**
 * Get the cover image blob URL for a book
 * Creates a fresh blob URL from stored BookFile data
 */
export async function getBookCoverUrl(
  bookId: string,
  coverPath: string,
): Promise<string | undefined> {
  const bookFile = await getBookFile(bookId, coverPath);
  if (!bookFile) {
    return undefined;
  }
  return URL.createObjectURL(bookFile.content);
}

// Highlight operations
export async function addHighlight(highlight: Highlight): Promise<string> {
  return await db.highlights.add(highlight);
}

export async function getHighlights(
  bookId: string,
  spineItemId: string,
): Promise<Highlight[]> {
  return await db.highlights
    .where("bookId")
    .equals(bookId)
    .and((h) => h.spineItemId === spineItemId)
    .toArray();
}

export async function deleteHighlight(id: string): Promise<void> {
  await db.highlights.delete(id);
}

export async function updateHighlight(
  id: string,
  changes: Partial<Highlight>,
): Promise<void> {
  await db.highlights.update(id, { ...changes, updatedAt: new Date() });
}

// Sync state operations
export async function getBookSyncState(
  fileHash: string,
): Promise<BookSyncState | undefined> {
  return await db.bookSyncState.get(fileHash);
}

export async function setBookSyncState(
  syncState: BookSyncState,
): Promise<void> {
  await db.bookSyncState.put(syncState);
}

export async function getBooksSyncState(): Promise<BookSyncState[]> {
  return await db.bookSyncState.toArray();
}

export async function getPendingUploadBooks(): Promise<BookSyncState[]> {
  return await db.bookSyncState
    .where("status")
    .anyOf(["pending_upload", "error"])
    .toArray();
}

export async function getSyncCursor(
  id: string,
): Promise<SyncCursor | undefined> {
  return await db.syncCursor.get(id);
}

export async function setSyncCursor(cursor: SyncCursor): Promise<void> {
  await db.syncCursor.put(cursor);
}

export async function addSyncLog(log: SyncLog): Promise<void> {
  await db.syncLog.add(log);
}

export async function getRecentSyncLogs(limit = 100): Promise<SyncLog[]> {
  return await db.syncLog.orderBy("timestamp").reverse().limit(limit).toArray();
}

export async function getLocalOnlyBooks(): Promise<Book[]> {
  // Get all books that don't have a sync state yet (never synced)
  const allBooks = await db.books.toArray();
  const syncStates = await db.bookSyncState.toArray();
  const syncedHashes = new Set(syncStates.map((s) => s.fileHash));
  return allBooks.filter((book) => !syncedHashes.has(book.fileHash));
}

export async function getBooksNeedingUpload(): Promise<Book[]> {
  // Books with sync state indicating they need upload
  const pendingStates = await db.bookSyncState
    .where("status")
    .anyOf(["pending_upload", "error"])
    .toArray();
  const pendingHashes = pendingStates.map((s) => s.fileHash);
  if (pendingHashes.length === 0) return [];
  return await db.books.where("fileHash").anyOf(pendingHashes).toArray();
}

export async function getNotDownloadedBooks(): Promise<Book[]> {
  return await db.books.where("isDownloaded").equals(0).toArray();
}

export async function markBookAsDownloaded(
  bookId: string,
  isDownloaded: number,
): Promise<void> {
  await db.books.update(bookId, { isDownloaded });
}

export async function deleteBookSyncState(fileHash: string): Promise<void> {
  await db.bookSyncState.delete(fileHash);
}

// EpubBlob operations
export async function saveEpubBlob(
  fileHash: string,
  blob: Blob,
): Promise<void> {
  await db.epubBlobs.put({
    fileHash,
    blob,
    dateStored: new Date(),
  });
}

export async function getEpubBlob(
  fileHash: string,
): Promise<EpubBlob | undefined> {
  return await db.epubBlobs.get(fileHash);
}

export async function deleteEpubBlob(fileHash: string): Promise<void> {
  await db.epubBlobs.delete(fileHash);
}

export async function hasEpubBlob(fileHash: string): Promise<boolean> {
  const blob = await db.epubBlobs.get(fileHash);
  return !!blob;
}

import Dexie, { type Table } from "dexie";

// Database interfaces matching the spec
export interface Book {
  id: string; // Primary key (UUID)
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

export interface ReadingProgress {
  id: string; // Primary key (matches Book.id)
  bookId: string; // Foreign key to Book
  currentSpineIndex: number; // Current position in spine
  scrollProgress: number; // 0-1 for scroll mode
  pageNumber?: number; // For paginated mode
  lastRead: Date;
}

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

  constructor() {
    super("epub-reader-db");

    this.version(1).stores({
      books: "id, title, author, dateAdded, lastOpened",
      bookFiles: "id, bookId, path",
      readingProgress: "id, bookId, lastRead",
      readingSettings: "id",
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
  await db.transaction(
    "rw",
    db.books,
    db.bookFiles,
    db.readingProgress,
    async () => {
      await db.books.delete(id);
      await db.bookFiles.where("bookId").equals(id).delete();
      await db.readingProgress.delete(id);
    },
  );
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

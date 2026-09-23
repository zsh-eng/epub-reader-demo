/** Expanded EPUB files, materialization markers, and regenerable Reader caches. */
import type { FileId } from "@/lib/files/types";
import type { Book } from "./books";
import { db } from "./database";

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

export async function getBookFile(
  bookId: string,
  path: string,
): Promise<BookFile | undefined> {
  return db.bookFiles.where("[bookId+path]").equals([bookId, path]).first();
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

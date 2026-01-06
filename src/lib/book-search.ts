/**
 * Book Search Utilities
 *
 * Simple, regex-based full-text search for ebooks.
 * Extracts plain text from HTML chapters and provides search functionality.
 */

import { db, type Book, type BookTextCache } from "@/lib/db";

// ============================================================================
// Types
// ============================================================================

export interface SearchMatch {
  chapterIndex: number;
  chapterPath: string;
  chapterTitle: string;
  /** Character offset within the chapter */
  position: number;
  /** Character offset within the entire book */
  globalPosition: number;
  /** Surrounding text with match highlighted */
  context: string;
}

export interface ChapterSearchResult {
  chapterIndex: number;
  chapterTitle: string;
  chapterPath: string;
  matches: SearchMatch[];
}

export interface SearchResult {
  query: string;
  totalMatches: number;
  byChapter: ChapterSearchResult[];
}

export interface SearchOptions {
  /** Match case exactly (default: false) */
  caseSensitive?: boolean;
  /** Match whole words only (default: false) */
  wholeWord?: boolean;
}

// ============================================================================
// Text Extraction
// ============================================================================

/**
 * Extracts plain text from HTML content.
 * Removes scripts, styles, and other non-content elements.
 */
export function extractPlainText(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Remove non-content elements
  const elementsToRemove = doc.querySelectorAll(
    "script, style, noscript, template, svg, math",
  );
  elementsToRemove.forEach((el) => el.remove());

  // Get text content and normalize whitespace
  const text = doc.body?.textContent || "";
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Finds the chapter title from the book's TOC for a given chapter path.
 */
function findChapterTitle(book: Book, chapterPath: string): string {
  // Helper to search TOC recursively
  function searchToc(items: Book["toc"], path: string): string | null {
    for (const item of items) {
      // TOC href may have fragment, so compare base path
      const tocPath = item.href?.split("#")[0];
      if (tocPath === path || path.endsWith(tocPath)) {
        return item.label;
      }
      if (item.children) {
        const found = searchToc(item.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  return searchToc(book.toc, chapterPath) || `Chapter`;
}

/**
 * Progress callback for text extraction
 */
export type ExtractionProgressCallback = (progress: number) => void;

/**
 * Extracts and caches plain text from all chapters of a book.
 * Uses requestIdleCallback to avoid blocking the UI.
 */
export async function extractBookText(
  bookId: string,
  onProgress?: ExtractionProgressCallback,
): Promise<BookTextCache> {
  // Get the book metadata
  const book = await db.books.get(bookId);
  if (!book) {
    throw new Error(`Book not found: ${bookId}`);
  }

  // Get all HTML/XHTML files from bookFiles
  const allFiles = await db.bookFiles.where("bookId").equals(bookId).toArray();

  // Filter to only content files (HTML/XHTML) that are in the spine
  const spineHrefs = new Set(
    book.spine
      .map((spineItem) => {
        const manifestItem = book.manifest.find(
          (m) => m.id === spineItem.idref,
        );
        return manifestItem?.href;
      })
      .filter(Boolean),
  );

  const contentFiles = allFiles.filter(
    (file) =>
      spineHrefs.has(file.path) &&
      (file.mediaType.includes("html") || file.mediaType.includes("xhtml")),
  );

  // Sort by spine order
  const spineOrder = book.spine.map((s) => {
    const m = book.manifest.find((item) => item.id === s.idref);
    return m?.href;
  });
  contentFiles.sort((a, b) => {
    const aIndex = spineOrder.indexOf(a.path);
    const bIndex = spineOrder.indexOf(b.path);
    return aIndex - bIndex;
  });

  // Extract text from each chapter
  const chapters: BookTextCache["chapters"] = [];
  let cumulativeOffset = 0;

  for (let i = 0; i < contentFiles.length; i++) {
    const file = contentFiles[i];

    // Convert blob to text
    const html = await file.content.text();
    const plainText = extractPlainText(html);
    const title = findChapterTitle(book, file.path);

    chapters.push({
      path: file.path,
      title,
      plainText,
      startOffset: cumulativeOffset,
    });

    cumulativeOffset += plainText.length;

    // Report progress
    if (onProgress) {
      onProgress(Math.round(((i + 1) / contentFiles.length) * 100));
    }

    // Yield to main thread between chapters to avoid blocking UI
    if (i < contentFiles.length - 1) {
      await new Promise<void>((resolve) => {
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(() => resolve(), { timeout: 50 });
        } else {
          setTimeout(resolve, 0);
        }
      });
    }
  }

  const cache: BookTextCache = {
    bookId,
    chapters,
    totalCharacters: cumulativeOffset,
    extractedAt: Date.now(),
  };

  // Store in IndexedDB
  await db.bookTextCache.put(cache);

  return cache;
}

/**
 * Gets cached book text, or null if not cached.
 */
export async function getBookTextCache(
  bookId: string,
): Promise<BookTextCache | null> {
  const cache = await db.bookTextCache.get(bookId);
  return cache || null;
}

/**
 * Gets cached book text, extracting it if necessary.
 */
export async function getOrExtractBookText(
  bookId: string,
  onProgress?: ExtractionProgressCallback,
): Promise<BookTextCache> {
  const cached = await getBookTextCache(bookId);
  if (cached) {
    return cached;
  }
  return extractBookText(bookId, onProgress);
}

/**
 * Clears the text cache for a book.
 */
export async function clearBookTextCache(bookId: string): Promise<void> {
  await db.bookTextCache.delete(bookId);
}

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Extracts context around a match position.
 * Returns surrounding text with the match position indicated.
 */
export function extractContext(
  text: string,
  position: number,
  queryLength: number,
  contextRadius: number = 40,
): string {
  const start = Math.max(0, position - contextRadius);
  const end = Math.min(text.length, position + queryLength + contextRadius);

  let context = text.slice(start, end);

  // Add ellipsis if truncated
  if (start > 0) {
    context = "..." + context;
  }
  if (end < text.length) {
    context = context + "...";
  }

  return context;
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Searches through cached book text.
 * Pure function with no side effects.
 */
export function searchBook(
  chapters: BookTextCache["chapters"],
  query: string,
  options: SearchOptions = {},
): SearchResult {
  const { caseSensitive = false, wholeWord = false } = options;

  // Return empty results for empty query
  if (!query.trim()) {
    return { query, totalMatches: 0, byChapter: [] };
  }

  // Build regex pattern
  const escaped = escapeRegex(query);
  const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
  const flags = caseSensitive ? "g" : "gi";
  const regex = new RegExp(pattern, flags);

  const byChapter: ChapterSearchResult[] = [];
  let totalMatches = 0;

  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
    const chapter = chapters[chapterIndex];
    const matches: SearchMatch[] = [];
    let match: RegExpExecArray | null;

    // Find all matches in this chapter
    while ((match = regex.exec(chapter.plainText)) !== null) {
      matches.push({
        chapterIndex,
        chapterPath: chapter.path,
        chapterTitle: chapter.title,
        position: match.index,
        globalPosition: chapter.startOffset + match.index,
        context: extractContext(chapter.plainText, match.index, query.length),
      });
    }

    if (matches.length > 0) {
      byChapter.push({
        chapterIndex,
        chapterTitle: chapter.title,
        chapterPath: chapter.path,
        matches,
      });
      totalMatches += matches.length;
    }
  }

  return { query, totalMatches, byChapter };
}

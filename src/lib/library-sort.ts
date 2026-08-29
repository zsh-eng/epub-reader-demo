import type { Book } from "@/lib/db";

/**
 * Library sorting rules.
 *
 * - Books currently being read ("Continue Reading") sort by most recently
 *   read, using the latest reading-checkpoint timestamp per book (max across
 *   devices). Books with no checkpoint yet fall back to most recently added.
 * - Books not currently being read (library and finished sections) sort by
 *   most recently added.
 *
 * These comparators are pure so the ordering rules can be unit-tested without
 * a database.
 */

/**
 * Compares books by when they were added to the library, most recent first.
 * The book id provides a deterministic tie-break.
 */
export function compareBooksByDateAddedDesc(a: Book, b: Book): number {
  if (a.dateAdded !== b.dateAdded) return b.dateAdded - a.dateAdded;
  return a.id.localeCompare(b.id);
}

/**
 * Builds a comparator for "most recently read first".
 *
 * The "lastReadByBook" map holds the latest reading timestamp per book id.
 * Books without a checkpoint sort below any book that has been read, falling
 * back to most recently added so a freshly imported, never-opened book still
 * sits at the top of the never-read group.
 */
export function compareBooksByLastReadDesc(
  lastReadByBook: ReadonlyMap<string, number>,
): (a: Book, b: Book) => number {
  return (a, b) => {
    const aLastRead = lastReadByBook.get(a.id) ?? 0;
    const bLastRead = lastReadByBook.get(b.id) ?? 0;
    if (aLastRead !== bLastRead) return bLastRead - aLastRead;
    return compareBooksByDateAddedDesc(a, b);
  };
}

export interface RecentlyReadBook {
  book: Book;
  lastRead: number;
}

/**
 * Finds the book with the latest reading activity across all statuses.
 */
export function findMostRecentlyReadBook(
  books: readonly Book[],
  lastReadByBook: ReadonlyMap<string, number>,
): RecentlyReadBook | null {
  let mostRecent: RecentlyReadBook | null = null;

  for (const book of books) {
    const lastRead = lastReadByBook.get(book.id) ?? 0;
    if (lastRead <= 0) continue;

    if (!mostRecent || lastRead > mostRecent.lastRead) {
      mostRecent = { book, lastRead };
      continue;
    }

    if (
      lastRead === mostRecent.lastRead &&
      compareBooksByDateAddedDesc(book, mostRecent.book) < 0
    ) {
      mostRecent = { book, lastRead };
    }
  }

  return mostRecent;
}

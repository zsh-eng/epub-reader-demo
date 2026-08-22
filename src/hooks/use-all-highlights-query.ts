/**
 * Hook for fetching all highlights across all books
 *
 * Groups highlights by book and sorts by most recent activity.
 */

import {
  getAllBooks,
  getAllHighlights,
  type SyncedBook,
  type SyncedHighlight,
} from "@/lib/db";
import { useQuery } from "@tanstack/react-query";

export interface BookHighlightGroup {
  book: SyncedBook;
  highlights: SyncedHighlight[];
  mostRecentHighlight: number;
}

/**
 * Query keys for all highlights
 */
export const allHighlightsKeys = {
  all: ["highlights", "all"] as const,
};

/**
 * Groups highlights by book and sorts by most recent activity
 */
function groupHighlightsByBook(
  highlights: SyncedHighlight[],
  books: SyncedBook[],
): BookHighlightGroup[] {
  const bookMap = new Map<string, SyncedBook>();
  for (const book of books) {
    bookMap.set(book.id, book);
  }

  // Group highlights by bookId
  const groupedMap = new Map<string, SyncedHighlight[]>();
  for (const highlight of highlights) {
    const existing = groupedMap.get(highlight.bookId) ?? [];
    existing.push(highlight);
    groupedMap.set(highlight.bookId, existing);
  }

  // Convert to array and add book info
  const groups: BookHighlightGroup[] = [];
  for (const [bookId, bookHighlights] of groupedMap) {
    const book = bookMap.get(bookId);
    if (!book) continue; // Skip orphaned highlights

    // Sort highlights within group by createdAt descending (most recent first)
    bookHighlights.sort((a, b) => {
      return b.createdAt - a.createdAt;
    });

    groups.push({
      book,
      highlights: bookHighlights,
      mostRecentHighlight: bookHighlights[0].createdAt,
    });
  }

  // Sort groups by most recent highlight (most recent first)
  groups.sort((a, b) => b.mostRecentHighlight - a.mostRecentHighlight);

  return groups;
}

/**
 * Hook for fetching all highlights grouped by book
 */
export function useAllHighlightsQuery() {
  return useQuery({
    queryKey: allHighlightsKeys.all,
    queryFn: async () => {
      const [highlights, books] = await Promise.all([
        getAllHighlights(),
        getAllBooks(),
      ]);
      return groupHighlightsByBook(highlights, books);
    },
  });
}

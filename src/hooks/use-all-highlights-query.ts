/**
 * Hook for fetching all highlights across all books
 *
 * Groups highlights by book and sorts by most recent activity.
 */

import { getAllBooks, getAllHighlights, type SyncedBook, type SyncedHighlight } from "@/lib/db";
import type { HighlightColor } from "@/types/highlight";
import { useQuery } from "@tanstack/react-query";

export interface HighlightWithBook extends SyncedHighlight {
  book: SyncedBook;
}

export interface BookHighlightGroup {
  book: SyncedBook;
  highlights: SyncedHighlight[];
  mostRecentHighlight: Date;
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
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime;
    });

    groups.push({
      book,
      highlights: bookHighlights,
      mostRecentHighlight: new Date(bookHighlights[0].createdAt),
    });
  }

  // Sort groups by most recent highlight (most recent first)
  groups.sort((a, b) => b.mostRecentHighlight.getTime() - a.mostRecentHighlight.getTime());

  return groups;
}

/**
 * Filter highlights by color
 */
export function filterByColors(
  groups: BookHighlightGroup[],
  selectedColors: HighlightColor[],
): BookHighlightGroup[] {
  if (selectedColors.length === 0) {
    return groups; // No filter = show all
  }

  return groups
    .map((group) => ({
      ...group,
      highlights: group.highlights.filter((h) => selectedColors.includes(h.color)),
    }))
    .filter((group) => group.highlights.length > 0);
}

/**
 * Filter highlights by search query
 */
export function filterBySearch(
  groups: BookHighlightGroup[],
  query: string,
): BookHighlightGroup[] {
  if (!query.trim()) {
    return groups;
  }

  const lowerQuery = query.toLowerCase();

  return groups
    .map((group) => {
      // Check if book title/author matches
      const bookMatches =
        group.book.title.toLowerCase().includes(lowerQuery) ||
        group.book.author.toLowerCase().includes(lowerQuery);

      if (bookMatches) {
        return group; // Return all highlights if book matches
      }

      // Filter highlights by text content and notes
      const filteredHighlights = group.highlights.filter(
        (h) =>
          h.selectedText.toLowerCase().includes(lowerQuery) ||
          (h.note && h.note.toLowerCase().includes(lowerQuery)),
      );

      return {
        ...group,
        highlights: filteredHighlights,
      };
    })
    .filter((group) => group.highlights.length > 0);
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

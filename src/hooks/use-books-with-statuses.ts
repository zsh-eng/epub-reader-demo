/**
 * Combined hook for fetching books with their reading statuses
 * This prevents flicker by loading both data sources together
 */

import {
  getAllBooks,
  getAllReadingStatuses,
  type SyncedBook,
  type ReadingStatus,
} from "@/lib/db";
import { useQuery } from "@tanstack/react-query";
import { bookKeys } from "./use-book-loader";
import { readingStatusKeys } from "./use-reading-status";

export interface CategorizedBooks {
  /** Books currently being read */
  continueReading: SyncedBook[];
  /** Books in the library (not started or want-to-read) */
  library: SyncedBook[];
  /** Books that have been finished */
  finished: SyncedBook[];
  /** All books for counting/filtering purposes */
  all: SyncedBook[];
}

/**
 * Hook for fetching all books with their reading statuses in a single query.
 * Returns books already categorized by reading status.
 * This prevents the flicker that occurs when books and statuses load separately.
 */
export function useBooksWithStatuses() {
  return useQuery({
    // Combine query keys since this depends on both data sources
    queryKey: [...bookKeys.list(), ...readingStatusKeys.allStatuses()],
    queryFn: async (): Promise<{
      books: SyncedBook[];
      statuses: Map<string, ReadingStatus>;
      categorized: CategorizedBooks;
    }> => {
      // Fetch both in parallel
      const [books, statuses] = await Promise.all([
        getAllBooks(),
        getAllReadingStatuses(),
      ]);

      // Categorize books by status
      const continueReading: SyncedBook[] = [];
      const library: SyncedBook[] = [];
      const finished: SyncedBook[] = [];

      for (const book of books) {
        const status = statuses.get(book.id);

        if (status === "reading") {
          continueReading.push(book);
        } else if (status === "finished") {
          finished.push(book);
        } else {
          // null, "want-to-read", or "dnf" go to library section
          library.push(book);
        }
      }

      return {
        books,
        statuses,
        categorized: {
          continueReading,
          library,
          finished,
          all: books,
        },
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
  });
}

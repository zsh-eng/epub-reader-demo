/**
 * Hook for fetching reading statuses for all books
 * Used for Library organization into sections
 */

import { getAllReadingStatuses, type ReadingStatus } from "@/lib/db";
import { useQuery } from "@tanstack/react-query";
import { readingStatusKeys } from "./use-reading-status";

/**
 * Hook for querying reading statuses for all books
 * Returns a Map<bookId, status> for efficient lookup
 */
export function useAllReadingStatuses() {
  return useQuery({
    queryKey: readingStatusKeys.allStatuses(),
    queryFn: async () => {
      return await getAllReadingStatuses();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

/**
 * Utility function to get categorized book IDs from status map
 */
export function categorizeBooksByStatus(
  statuses: Map<string, ReadingStatus>,
  allBookIds: string[],
): {
  reading: string[];
  library: string[];
  finished: string[];
} {
  const reading: string[] = [];
  const library: string[] = [];
  const finished: string[] = [];

  for (const bookId of allBookIds) {
    const status = statuses.get(bookId);

    if (status === "reading") {
      reading.push(bookId);
    } else if (status === "finished") {
      finished.push(bookId);
    } else {
      // null, "want-to-read", or "dnf" go to library section
      library.push(bookId);
    }
  }

  return { reading, library, finished };
}

/**
 * Hook for managing reading status for a single book
 */

import {
  getReadingStatus,
  setReadingStatus,
  type ReadingStatus,
} from "@/lib/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bookKeys } from "./use-book-loader";

/**
 * Query key factory for reading status queries
 */
export const readingStatusKeys = {
  all: ["readingStatus"] as const,
  allStatuses: () => [...readingStatusKeys.all, "all"] as const,
  book: (bookId: string) => [...readingStatusKeys.all, bookId] as const,
};

/**
 * Updates one reading status and refreshes every query that derives library
 * placement from that status.
 */
export function useSetReadingStatus(bookId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (status: ReadingStatus) => {
      if (!bookId) throw new Error("No book ID provided");
      return await setReadingStatus(bookId, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: readingStatusKeys.book(bookId ?? ""),
      });
      queryClient.invalidateQueries({
        queryKey: readingStatusKeys.allStatuses(),
      });
      queryClient.invalidateQueries({
        queryKey: bookKeys.list(),
      });
    },
  });
}

/**
 * Hook for querying and mutating reading status for a single book
 */
export function useReadingStatus(bookId: string | undefined) {
  const query = useQuery({
    queryKey: readingStatusKeys.book(bookId ?? ""),
    queryFn: async () => {
      if (!bookId) return null;
      return await getReadingStatus(bookId);
    },
    enabled: !!bookId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });

  const mutation = useSetReadingStatus(bookId);

  return {
    status: query.data ?? null,
    isLoading: query.isLoading,
    setStatus: mutation.mutate,
    setStatusAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
}

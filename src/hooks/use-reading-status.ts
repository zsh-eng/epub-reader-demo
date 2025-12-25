/**
 * Hook for managing reading status for a single book
 */

import {
  getReadingStatus,
  setReadingStatus,
  type ReadingStatus,
} from "@/lib/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Query key factory for reading status queries
 */
export const readingStatusKeys = {
  all: ["readingStatus"] as const,
  allStatuses: () => [...readingStatusKeys.all, "all"] as const,
  book: (bookId: string) => [...readingStatusKeys.all, bookId] as const,
};

/**
 * Hook for querying and mutating reading status for a single book
 */
export function useReadingStatus(bookId: string | undefined) {
  const queryClient = useQueryClient();

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

  const mutation = useMutation({
    mutationFn: async (status: ReadingStatus) => {
      if (!bookId) throw new Error("No book ID provided");
      return await setReadingStatus(bookId, status);
    },
    onSuccess: () => {
      // Invalidate both this book's status and the all-statuses query
      queryClient.invalidateQueries({
        queryKey: readingStatusKeys.book(bookId ?? ""),
      });
      queryClient.invalidateQueries({
        queryKey: readingStatusKeys.allStatuses(),
      });
    },
  });

  return {
    status: query.data ?? null,
    isLoading: query.isLoading,
    setStatus: mutation.mutate,
    setStatusAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
}

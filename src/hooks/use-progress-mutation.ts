import { bookKeys } from "@/hooks/use-book-loader";
import {
  saveReadingProgress,
  type ReadingProgress,
  type SyncedReadingProgress,
} from "@/lib/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Hook for saving reading progress with optimistic updates.
 *
 * Handles:
 * - Saving progress to the database
 * - Optimistic updates to the query cache
 * - Error handling and rollback
 * - Query invalidation after mutation
 *
 * @param bookId - The book ID for which to save progress
 * @returns Mutation object for saving reading progress
 */
export function useProgressMutation(bookId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (progress: Omit<ReadingProgress, "id" | "createdAt">) => {
      await saveReadingProgress(progress);
      return progress;
    },
    onMutate: async (newProgress) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({
        queryKey: bookKeys.progress(bookId),
      });

      // Snapshot the previous value
      const previousProgress =
        queryClient.getQueryData<SyncedReadingProgress | null>(
          bookKeys.progress(bookId),
        );

      // Optimistically update to the new value (keeping existing sync metadata)
      queryClient.setQueryData<SyncedReadingProgress | null>(
        bookKeys.progress(bookId),
        previousProgress
          ? { ...previousProgress, ...newProgress }
          : (newProgress as SyncedReadingProgress),
      );

      // Return context with previous value for rollback
      return { previousProgress };
    },
    onError: (err, _newProgress, context) => {
      // Rollback to previous value on error
      if (context?.previousProgress !== undefined) {
        queryClient.setQueryData(
          bookKeys.progress(bookId),
          context.previousProgress,
        );
      }
      console.error("Failed to save reading progress:", err);
    },
    onSettled: () => {
      // Always refetch after error or success to ensure we have the latest data
      queryClient.invalidateQueries({
        queryKey: bookKeys.progress(bookId),
      });
    },
  });
}

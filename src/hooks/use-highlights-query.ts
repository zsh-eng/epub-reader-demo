import {
  addHighlight as addHighlightToDb,
  deleteHighlight as deleteHighlightFromDb,
  getHighlights,
  updateHighlight as updateHighlightInDb,
} from "@/lib/db";
import type { Highlight } from "@/types/highlight";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Query keys for highlights
 */
export const highlightKeys = {
  all: ["highlights"] as const,
  chapter: (bookId: string, spineItemId: string) =>
    [...highlightKeys.all, bookId, spineItemId] as const,
};

/**
 * Hook for fetching highlights for a specific chapter
 */
export function useHighlightsQuery(
  bookId: string | undefined,
  spineItemId: string | undefined,
) {
  return useQuery({
    queryKey: highlightKeys.chapter(bookId ?? "", spineItemId ?? ""),
    queryFn: () => getHighlights(bookId!, spineItemId!),
    enabled: !!bookId && !!spineItemId,
  });
}

/**
 * Hook for adding a highlight with optimistic updates
 */
export function useAddHighlightMutation(
  bookId: string | undefined,
  spineItemId: string | undefined,
) {
  const queryClient = useQueryClient();
  const queryKey = highlightKeys.chapter(bookId ?? "", spineItemId ?? "");

  return useMutation({
    mutationFn: async (highlight: Highlight) => {
      await addHighlightToDb(highlight);
      return highlight;
    },
    onMutate: async (newHighlight) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the previous value
      const previousHighlights =
        queryClient.getQueryData<Highlight[]>(queryKey);

      // Optimistically add the new highlight
      queryClient.setQueryData<Highlight[]>(queryKey, (old = []) => [
        ...old,
        newHighlight,
      ]);

      // Return context with previous value for rollback
      return { previousHighlights };
    },
    onError: (err, _newHighlight, context) => {
      // Rollback to previous value on error
      if (context?.previousHighlights) {
        queryClient.setQueryData(queryKey, context.previousHighlights);
      }
      console.error("Failed to add highlight:", err);
    },
    onSettled: () => {
      // Refetch after error or success to ensure consistency
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

/**
 * Hook for deleting a highlight with optimistic updates
 */
export function useDeleteHighlightMutation(
  bookId: string | undefined,
  spineItemId: string | undefined,
) {
  const queryClient = useQueryClient();
  const queryKey = highlightKeys.chapter(bookId ?? "", spineItemId ?? "");

  return useMutation({
    mutationFn: async (highlightId: string) => {
      await deleteHighlightFromDb(highlightId);
      return highlightId;
    },
    onMutate: async (highlightId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the previous value
      const previousHighlights =
        queryClient.getQueryData<Highlight[]>(queryKey);

      // Optimistically remove the highlight
      queryClient.setQueryData<Highlight[]>(queryKey, (old = []) =>
        old.filter((h) => h.id !== highlightId),
      );

      return { previousHighlights };
    },
    onError: (err, _highlightId, context) => {
      // Rollback on error
      if (context?.previousHighlights) {
        queryClient.setQueryData(queryKey, context.previousHighlights);
      }
      console.error("Failed to delete highlight:", err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

/**
 * Hook for updating a highlight with optimistic updates
 */
export function useUpdateHighlightMutation(
  bookId: string | undefined,
  spineItemId: string | undefined,
) {
  const queryClient = useQueryClient();
  const queryKey = highlightKeys.chapter(bookId ?? "", spineItemId ?? "");

  return useMutation({
    mutationFn: async ({
      id,
      changes,
    }: {
      id: string;
      changes: Partial<Highlight>;
    }) => {
      await updateHighlightInDb(id, changes);
      return { id, changes };
    },
    onMutate: async ({ id, changes }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the previous value
      const previousHighlights =
        queryClient.getQueryData<Highlight[]>(queryKey);

      // Optimistically update the highlight
      queryClient.setQueryData<Highlight[]>(queryKey, (old = []) =>
        old.map((h) => (h.id === id ? { ...h, ...changes } : h)),
      );

      return { previousHighlights };
    },
    onError: (err, _variables, context) => {
      // Rollback on error
      if (context?.previousHighlights) {
        queryClient.setQueryData(queryKey, context.previousHighlights);
      }
      console.error("Failed to update highlight:", err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

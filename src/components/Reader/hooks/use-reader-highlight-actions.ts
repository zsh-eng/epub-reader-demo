import { useAddHighlightMutation } from "@/hooks/use-highlights-query";
import type { Highlight } from "@/types/highlight";
import { useCallback, useMemo } from "react";

export interface ReaderHighlightActions {
  createHighlight: (highlight: Highlight) => void;
}

/**
 * Keeps highlight data mutations out of UI interaction hooks. Consumers can
 * depend on a narrow action surface instead of importing React Query directly.
 */
export function useReaderHighlightActions(
  bookId?: string,
): ReaderHighlightActions {
  const addHighlightMutation = useAddHighlightMutation(bookId);

  const createHighlight = useCallback(
    (highlight: Highlight) => {
      addHighlightMutation.mutate(highlight);
    },
    [addHighlightMutation],
  );

  return useMemo(
    () => ({
      createHighlight,
    }),
    [createHighlight],
  );
}

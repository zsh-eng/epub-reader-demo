import {
  addHighlight as addHighlightToDb,
  deleteHighlight as deleteHighlightFromDb,
  getHighlights,
  updateHighlight as updateHighlightInDb,
} from "@/lib/db";
import type { Highlight } from "@/types/highlight";
import { useCallback, useEffect, useState } from "react";

export function useHighlights(
  bookId: string | undefined,
  spineItemId: string | undefined,
) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load highlights when chapter changes
  useEffect(() => {
    if (!bookId || !spineItemId) {
      setHighlights([]);
      return;
    }

    let mounted = true;
    setIsLoading(true);

    getHighlights(bookId, spineItemId).then((data) => {
      if (mounted) {
        setHighlights(data);
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
    };
  }, [bookId, spineItemId]);

  const addHighlight = useCallback(async (highlight: Highlight) => {
    // Optimistic update
    setHighlights((prev) => [...prev, highlight]);
    // DB update
    try {
      await addHighlightToDb(highlight);
    } catch (error) {
      console.error("Failed to save highlight:", error);
      // Rollback? For now, just log.
    }
  }, []);

  const deleteHighlight = useCallback(async (id: string) => {
    // Optimistic update
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    // DB update
    try {
      await deleteHighlightFromDb(id);
    } catch (error) {
      console.error("Failed to delete highlight:", error);
    }
  }, []);

  const updateHighlight = useCallback(
    async (id: string, changes: Partial<Highlight>) => {
      console.log("updating highlight for", id, changes);
      // Optimistic update
      setHighlights((prev) =>
        prev.map((h) => (h.id === id ? { ...h, ...changes } : h)),
      );
      // DB update
      try {
        await updateHighlightInDb(id, changes);
      } catch (error) {
        console.error("Failed to update highlight:", error);
      }
    },
    [],
  );

  return {
    highlights,
    isLoading,
    addHighlight,
    deleteHighlight,
    updateHighlight,
  };
}

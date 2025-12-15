import { useProgressMutation } from "@/hooks/use-progress-mutation";
import { type Book, type ReadingProgress } from "@/lib/db";
import { findSpineIndexByHref } from "@/lib/toc-utils";
import { useCallback } from "react";

export interface UseChapterNavigationReturn {
  goToPreviousChapter: () => Promise<void>;
  goToNextChapter: () => Promise<void>;
  goToChapterByHref: (href: string) => Promise<void>;
}

function newReadingProgress(
  bookId: string,
  currentSpineIndex: number,
): ReadingProgress {
  return {
    id: bookId,
    bookId,
    currentSpineIndex,
    scrollProgress: 0,
    lastRead: new Date(),
  };
}

export function useChapterNavigation(
  book: Book | null,
  bookId: string | undefined,
  currentChapterIndex: number,
  setCurrentChapterIndex: (index: number) => void,
): UseChapterNavigationReturn {
  // Use the progress mutation hook for saving progress
  const saveProgressMutation = useProgressMutation(bookId ?? "");

  const goToPreviousChapter = useCallback(async () => {
    if (!bookId) return;

    if (currentChapterIndex < 0) return;

    const newIndex = currentChapterIndex - 1;
    setCurrentChapterIndex(newIndex);

    const progress = newReadingProgress(bookId, newIndex);
    saveProgressMutation.mutate(progress);
    window.scrollTo({
      top: 0,
      behavior: "instant",
    });
  }, [
    currentChapterIndex,
    bookId,
    setCurrentChapterIndex,
    saveProgressMutation,
  ]);

  const goToNextChapter = useCallback(async () => {
    if (!bookId) return;
    if (!book) return;
    if (currentChapterIndex >= book.spine.length - 1) return;

    const newIndex = currentChapterIndex + 1;
    setCurrentChapterIndex(newIndex);

    const progress = newReadingProgress(bookId, newIndex);
    saveProgressMutation.mutate(progress);

    window.scrollTo({
      top: 0,
      behavior: "instant",
    });
  }, [
    book,
    currentChapterIndex,
    bookId,
    setCurrentChapterIndex,
    saveProgressMutation,
  ]);

  const goToChapterByHref = useCallback(
    async (href: string) => {
      if (!book || !bookId) return;

      // Find the spine index for this href
      const spineIndex = findSpineIndexByHref(book, href);
      if (spineIndex === null) return;

      setCurrentChapterIndex(spineIndex);
      // Save progress immediately on chapter change
      const progress = newReadingProgress(bookId, spineIndex);
      const { mutate } = saveProgressMutation;
      mutate(progress);

      window.scrollTo({
        top: 0,
        behavior: "instant",
      });
    },
    [book, bookId, setCurrentChapterIndex, saveProgressMutation],
  );

  return {
    goToPreviousChapter,
    goToNextChapter,
    goToChapterByHref,
  };
}

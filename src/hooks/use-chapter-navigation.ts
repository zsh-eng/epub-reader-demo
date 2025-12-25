import { useProgressMutation } from "@/hooks/use-progress-mutation";
import { type Book, type ReadingProgress } from "@/lib/db";
import { findSpineIndexByHref } from "@/lib/toc-utils";
import { type ScrollTarget } from "@/types/scroll-target";
import { useCallback } from "react";

export interface UseChapterNavigationReturn {
  goToPreviousChapter: () => void;
  goToNextChapter: () => void;
  goToChapterByHref: (href: string) => void;
  goToChapterWithFragment: (href: string, fragment?: string) => void;
}

function newReadingProgress(
  bookId: string,
  currentSpineIndex: number,
): Omit<ReadingProgress, "id" | "createdAt"> {
  return {
    bookId,
    currentSpineIndex,
    scrollProgress: 0,
    lastRead: new Date().getTime(),
  };
}

export function useChapterNavigation(
  book: Book | null,
  bookId: string | undefined,
  currentChapterIndex: number,
  setCurrentChapterIndex: (index: number) => void,
  setScrollTarget: (target: ScrollTarget) => void,
): UseChapterNavigationReturn {
  // Use the progress mutation hook for saving progress
  const saveProgressMutation = useProgressMutation(bookId ?? "");

  const goToPreviousChapter = useCallback(() => {
    if (!bookId) return;
    if (currentChapterIndex <= 0) return;

    const newIndex = currentChapterIndex - 1;
    setCurrentChapterIndex(newIndex);
    setScrollTarget({ type: "top" });

    const progress = newReadingProgress(bookId, newIndex);
    saveProgressMutation.mutate(progress);
  }, [
    currentChapterIndex,
    bookId,
    setCurrentChapterIndex,
    setScrollTarget,
    saveProgressMutation,
  ]);

  const goToNextChapter = useCallback(() => {
    if (!bookId) return;
    if (!book) return;
    if (currentChapterIndex >= book.spine.length - 1) return;

    const newIndex = currentChapterIndex + 1;
    setCurrentChapterIndex(newIndex);
    setScrollTarget({ type: "top" });

    const progress = newReadingProgress(bookId, newIndex);
    saveProgressMutation.mutate(progress);
  }, [
    book,
    currentChapterIndex,
    bookId,
    setCurrentChapterIndex,
    setScrollTarget,
    saveProgressMutation,
  ]);

  const goToChapterByHref = useCallback(
    (href: string) => {
      if (!book || !bookId) return;

      // Find the spine index for this href
      const spineIndex = findSpineIndexByHref(book, href);
      if (spineIndex === null) return;

      setCurrentChapterIndex(spineIndex);
      setScrollTarget({ type: "top" });

      // Save progress immediately on chapter change
      const progress = newReadingProgress(bookId, spineIndex);
      saveProgressMutation.mutate(progress);
    },
    [
      book,
      bookId,
      setCurrentChapterIndex,
      setScrollTarget,
      saveProgressMutation,
    ],
  );

  const goToChapterWithFragment = useCallback(
    (href: string, fragment?: string) => {
      if (!book || !bookId) return;

      // Find the spine index for this href
      const spineIndex = findSpineIndexByHref(book, href);
      if (spineIndex === null) return;

      // Same chapter with fragment - just scroll to the fragment
      if (spineIndex === currentChapterIndex && fragment) {
        setScrollTarget({ type: "fragment", id: fragment });
        return;
      }

      // Different chapter - navigate and set scroll target
      setCurrentChapterIndex(spineIndex);
      setScrollTarget(
        fragment ? { type: "fragment", id: fragment } : { type: "top" },
      );

      // Save progress immediately on chapter change
      const progress = newReadingProgress(bookId, spineIndex);
      saveProgressMutation.mutate(progress);
    },
    [
      book,
      bookId,
      currentChapterIndex,
      setCurrentChapterIndex,
      setScrollTarget,
      saveProgressMutation,
    ],
  );

  return {
    goToPreviousChapter,
    goToNextChapter,
    goToChapterByHref,
    goToChapterWithFragment,
  };
}

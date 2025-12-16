import { useProgressMutation } from "@/hooks/use-progress-mutation";
import { type Book, type ReadingProgress } from "@/lib/db";
import { findSpineIndexByHref } from "@/lib/toc-utils";
import { useCallback, useRef } from "react";

export interface UseChapterNavigationReturn {
  goToPreviousChapter: () => Promise<void>;
  goToNextChapter: () => Promise<void>;
  goToChapterByHref: (href: string) => Promise<void>;
  goToChapterWithFragment: (href: string, fragment?: string) => Promise<void>;
  /** Ref containing the pending fragment to scroll to after chapter navigation */
  pendingFragmentRef: React.RefObject<string | null>;
  /** Clear the pending fragment after it has been used */
  clearPendingFragment: () => void;
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

  // Ref to store pending fragment for cross-chapter navigation
  const pendingFragmentRef = useRef<string | null>(null);

  const clearPendingFragment = useCallback(() => {
    pendingFragmentRef.current = null;
  }, []);

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

  const goToChapterWithFragment = useCallback(
    async (href: string, fragment?: string) => {
      if (!book || !bookId) return;

      // Find the spine index for this href
      const spineIndex = findSpineIndexByHref(book, href);
      if (spineIndex === null) return;

      const isNavigatingToSameChapterFragment =
        spineIndex === currentChapterIndex && fragment;
      if (isNavigatingToSameChapterFragment) {
        const element = document.getElementById(fragment);
        if (element) {
          element.scrollIntoView({ behavior: "instant" });
        }
        return;
      }

      console.log("going to chapter with the following fragment:", fragment);
      // Store the fragment to scroll to after navigation (handled by ScrollRestoration)
      if (fragment) {
        pendingFragmentRef.current = fragment;
      }
      setCurrentChapterIndex(spineIndex);
      // Save progress immediately on chapter change
      const progress = newReadingProgress(bookId, spineIndex);
      const { mutate } = saveProgressMutation;
      mutate(progress);
    },
    [
      book,
      bookId,
      currentChapterIndex,
      setCurrentChapterIndex,
      saveProgressMutation,
    ],
  );

  return {
    goToPreviousChapter,
    goToNextChapter,
    goToChapterByHref,
    goToChapterWithFragment,
    pendingFragmentRef,
    clearPendingFragment,
  };
}

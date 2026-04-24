import { useProgressMutation } from "@/hooks/use-progress-mutation";
import {
  type Book,
  type ProgressTriggerType,
  type ReadingProgress,
} from "@/lib/db";
import { splitHrefFragment } from "@/lib/epub-resource-utils";
import { findSpineIndexByHref } from "@/lib/toc-utils";
import { type ScrollTarget } from "@/types/scroll-target";
import { useCallback } from "react";

export interface UseChapterNavigationReturn {
  goToPreviousChapter: () => void;
  goToNextChapter: () => void;
  goToChapterByHref: (href: string) => void;
  goToChapterWithFragment: (href: string) => void;
  goToHighlight: (spineItemId: string, highlightId: string) => void;
  goToSearchResult: (chapterPath: string, textOffset: number) => void;
}

function newReadingProgress(
  bookId: string,
  currentSpineIndex: number,
  triggerType: ProgressTriggerType,
  targetElementId?: string,
): Omit<ReadingProgress, "id" | "createdAt"> {
  return {
    bookId,
    currentSpineIndex,
    scrollProgress: 0,
    lastRead: new Date().getTime(),
    triggerType,
    targetElementId,
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
  // Extract mutate for stable reference - the mutation object changes each render,
  // but mutate is stable and won't cause useCallback dependencies to change
  const { mutate: saveProgress } = useProgressMutation(bookId ?? "");

  const goToPreviousChapter = useCallback(() => {
    if (!bookId) return;
    if (currentChapterIndex <= 0) return;

    const newIndex = currentChapterIndex - 1;
    setCurrentChapterIndex(newIndex);
    setScrollTarget({ type: "top" });

    const progress = newReadingProgress(bookId, newIndex, "manual-chapter");
    saveProgress(progress);
  }, [
    currentChapterIndex,
    bookId,
    setCurrentChapterIndex,
    setScrollTarget,
    saveProgress,
  ]);

  const goToNextChapter = useCallback(() => {
    if (!bookId) return;
    if (!book) return;
    if (currentChapterIndex >= book.spine.length - 1) return;

    const newIndex = currentChapterIndex + 1;
    setCurrentChapterIndex(newIndex);
    setScrollTarget({ type: "top" });

    const progress = newReadingProgress(bookId, newIndex, "manual-chapter");
    saveProgress(progress);
  }, [
    book,
    currentChapterIndex,
    bookId,
    setCurrentChapterIndex,
    setScrollTarget,
    saveProgress,
  ]);

  const goToChapterByHref = useCallback(
    (href: string) => {
      if (!book || !bookId) return;
      const { path } = splitHrefFragment(href);

      // Find the spine index for this href
      const spineIndex = findSpineIndexByHref(book, path);
      if (spineIndex === null) return;

      setCurrentChapterIndex(spineIndex);
      setScrollTarget({ type: "top" });

      // Save progress immediately on chapter change
      const progress = newReadingProgress(bookId, spineIndex, "toc-navigation");
      saveProgress(progress);
    },
    [book, bookId, setCurrentChapterIndex, setScrollTarget, saveProgress],
  );

  const goToChapterWithFragment = useCallback(
    (href: string) => {
      if (!book || !bookId) return;
      const { path, fragment } = splitHrefFragment(href);

      // Find the spine index for this href
      const spineIndex = findSpineIndexByHref(book, path);
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
      const progress = newReadingProgress(
        bookId,
        spineIndex,
        "fragment-link",
        fragment,
      );
      saveProgress(progress);
    },
    [
      book,
      bookId,
      currentChapterIndex,
      setCurrentChapterIndex,
      setScrollTarget,
      saveProgress,
    ],
  );

  const goToHighlight = useCallback(
    (spineItemId: string, highlightId: string) => {
      if (!book || !bookId) return;

      // Find spine index by spineItemId (idref)
      const spineIndex = book.spine.findIndex(
        (item) => item.idref === spineItemId,
      );
      if (spineIndex === -1) return;

      // Same chapter - just scroll to the highlight
      if (spineIndex === currentChapterIndex) {
        setScrollTarget({ type: "highlight", highlightId });
        return;
      }

      // Navigate to chapter with highlight scroll target
      setCurrentChapterIndex(spineIndex);
      setScrollTarget({ type: "highlight", highlightId });

      // Save progress
      const progress = newReadingProgress(
        bookId,
        spineIndex,
        "highlight-jump",
        highlightId,
      );
      saveProgress(progress);
    },
    [
      book,
      bookId,
      currentChapterIndex,
      setCurrentChapterIndex,
      setScrollTarget,
      saveProgress,
    ],
  );

  const goToSearchResult = useCallback(
    (chapterPath: string, textOffset: number) => {
      if (!book || !bookId) return;

      // Find the spine index for this chapter path
      const spineIndex = findSpineIndexByHref(book, chapterPath);
      if (spineIndex === null) return;

      // Same chapter - just scroll to the text offset
      if (spineIndex === currentChapterIndex) {
        setScrollTarget({ type: "textOffset", offset: textOffset });
        return;
      }

      // Navigate to chapter with text offset scroll target
      setCurrentChapterIndex(spineIndex);
      setScrollTarget({ type: "textOffset", offset: textOffset });

      // Save progress
      const progress = newReadingProgress(
        bookId,
        spineIndex,
        "search-result-jump",
      );
      saveProgress(progress);
    },
    [
      book,
      bookId,
      currentChapterIndex,
      setCurrentChapterIndex,
      setScrollTarget,
      saveProgress,
    ],
  );

  return {
    goToPreviousChapter,
    goToNextChapter,
    goToChapterByHref,
    goToChapterWithFragment,
    goToHighlight,
    goToSearchResult,
  };
}

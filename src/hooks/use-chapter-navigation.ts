import { type Book } from "@/lib/db";
import { saveCurrentProgress } from "@/lib/scroll-anchor";
import { findSpineIndexByHref } from "@/lib/toc-utils";
import { useCallback } from "react";

export interface UseChapterNavigationReturn {
  goToPreviousChapter: () => Promise<void>;
  goToNextChapter: () => Promise<void>;
  goToChapterByHref: (href: string) => Promise<void>;
}

export function useChapterNavigation(
  book: Book | null,
  bookId: string | undefined,
  currentChapterIndex: number,
  setCurrentChapterIndex: (index: number) => void,
): UseChapterNavigationReturn {
  const goToPreviousChapter = useCallback(async () => {
    if (!bookId) return;

    if (currentChapterIndex > 0) {
      const newIndex = currentChapterIndex - 1;
      setCurrentChapterIndex(newIndex);

      // Save progress immediately on chapter change
      await saveCurrentProgress(bookId, newIndex, 0);
    }

    window.scrollTo({
      top: 0,
      behavior: "instant",
    });
  }, [currentChapterIndex, bookId, setCurrentChapterIndex]);

  const goToNextChapter = useCallback(async () => {
    if (!bookId) return;

    if (book && currentChapterIndex < book.spine.length - 1) {
      const newIndex = currentChapterIndex + 1;
      setCurrentChapterIndex(newIndex);

      // Save progress immediately on chapter change
      await saveCurrentProgress(bookId, newIndex, 0);

      window.scrollTo({
        top: 0,
        behavior: "instant",
      });
    }
  }, [book, currentChapterIndex, bookId, setCurrentChapterIndex]);

  const goToChapterByHref = useCallback(
    async (href: string) => {
      if (!book || !bookId) return;

      // Find the spine index for this href
      const spineIndex = findSpineIndexByHref(book, href);
      if (spineIndex !== null) {
        setCurrentChapterIndex(spineIndex);

        // Save progress immediately on chapter change
        await saveCurrentProgress(bookId, spineIndex, 0);

        window.scrollTo({
          top: 0,
          behavior: "instant",
        });
      }
    },
    [book, bookId, setCurrentChapterIndex],
  );

  return {
    goToPreviousChapter,
    goToNextChapter,
    goToChapterByHref,
  };
}

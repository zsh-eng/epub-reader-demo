import { saveReadingProgress, type Book } from "@/lib/db";
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
      await saveReadingProgress({
        id: bookId,
        bookId,
        currentSpineIndex: newIndex,
        scrollProgress: 0,
        lastRead: new Date(),
      });
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
      await saveReadingProgress({
        id: bookId,
        bookId,
        currentSpineIndex: newIndex,
        scrollProgress: 0,
        lastRead: new Date(),
      });

      window.scrollTo({
        top: 0,
        behavior: "instant",
      });
    }
  }, [book, currentChapterIndex, bookId, setCurrentChapterIndex]);

  const goToChapterByHref = useCallback(
    async (href: string) => {
      if (!book) return;

      // Find the spine index for this href
      const manifestItem = book.manifest.find(
        (item) => item.href === href || item.href.endsWith(href),
      );
      if (!manifestItem) {
        console.error("Manifest item not found for href:", href);
        return;
      }

      const spineIndex = book.spine.findIndex(
        (item) => item.idref === manifestItem.id,
      );
      if (spineIndex !== -1) {
        setCurrentChapterIndex(spineIndex);

        // Save progress immediately on chapter change
        if (bookId) {
          await saveReadingProgress({
            id: bookId,
            bookId,
            currentSpineIndex: spineIndex,
            scrollProgress: 0,
            lastRead: new Date(),
          });
        }

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

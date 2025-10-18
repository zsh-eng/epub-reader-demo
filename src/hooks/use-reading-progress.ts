import { saveReadingProgress, type Book } from "@/lib/db";
import { useEffect } from "react";

export function useReadingProgress(
  bookId: string | undefined,
  book: Book | null,
  currentChapterIndex: number,
  lastScrollProgress: React.RefObject<number>,
): void {
  useEffect(() => {
    if (!bookId || !book) return;

    const saveProgress = async () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;

      const scrollProgress =
        scrollHeight > clientHeight
          ? scrollTop / (scrollHeight - clientHeight)
          : 0;

      // Only save if progress changed significantly (>1%)
      const hasScrollProgressChanged =
        Math.abs(scrollProgress - lastScrollProgress.current) > 0.01;
      if (!hasScrollProgressChanged) return;

      lastScrollProgress.current = scrollProgress;
      await saveReadingProgress({
        id: bookId,
        bookId,
        currentSpineIndex: currentChapterIndex,
        scrollProgress: isNaN(scrollProgress) ? 0 : scrollProgress,
        lastRead: new Date(),
      });
    };

    const interval = setInterval(saveProgress, 3000);
    return () => clearInterval(interval);
  }, [bookId, book, currentChapterIndex, lastScrollProgress]);
}

import { type Book } from "@/lib/db";
import {
  calculateScrollProgress,
  saveCurrentProgress,
} from "@/lib/progress-utils";
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
      const scrollProgress = calculateScrollProgress();

      // Only save if progress changed significantly (>1%)
      const hasScrollProgressChanged =
        Math.abs(scrollProgress - lastScrollProgress.current) > 0.01;
      if (!hasScrollProgressChanged) return;

      lastScrollProgress.current = scrollProgress;
      await saveCurrentProgress(bookId, currentChapterIndex, scrollProgress);
    };

    const interval = setInterval(saveProgress, 3000);
    return () => clearInterval(interval);
  }, [bookId, book, currentChapterIndex, lastScrollProgress]);
}

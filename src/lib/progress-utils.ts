import { saveReadingProgress } from "@/lib/db";

/**
 * Saves the current reading progress for a book.
 * Handles NaN values gracefully by defaulting to 0.
 */
export async function saveCurrentProgress(
  bookId: string,
  currentChapterIndex: number,
  scrollProgress: number = 0,
): Promise<void> {
  // Handle NaN values
  const validScrollProgress = isNaN(scrollProgress) ? 0 : scrollProgress;

  await saveReadingProgress({
    id: bookId,
    bookId,
    currentSpineIndex: currentChapterIndex,
    scrollProgress: validScrollProgress,
    lastRead: new Date(),
  });
}

/**
 * Calculates the current scroll progress as a percentage (0-100).
 * Returns 0 if the calculation results in NaN or invalid values.
 */
export function calculateScrollProgress(): number {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = document.documentElement.clientHeight;

  const scrollable = scrollHeight - clientHeight;
  if (scrollable <= 0) return 0;

  const progress = (scrollTop / scrollable) * 100;
  return isNaN(progress) ? 0 : progress;
}

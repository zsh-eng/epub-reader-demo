import type { ChapterEntry } from "@/components/ReaderV2/hooks/use-reader-v2-core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

interface FooterChapterRowProps {
  currentChapterIndex: number;
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentPage: number;
  totalPages: number;
  onGoToChapter: (chapterIndex: number) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
}

export function FooterChapterRow({
  currentChapterIndex,
  chapterEntries,
  chapterStartPages,
  currentPage,
  totalPages,
  onGoToChapter,
  onPrevChapter,
  onNextChapter,
}: FooterChapterRowProps) {
  const hasPrev = currentChapterIndex > 0;
  const hasNext = currentChapterIndex < chapterEntries.length - 1;

  const prevChapterStart = chapterStartPages[currentChapterIndex - 1];
  const currentChapterStart = chapterStartPages[currentChapterIndex];
  const nextChapterStart = chapterStartPages[currentChapterIndex + 1];

  const pagesFromCurrentChapterStart =
    currentChapterStart != null ? currentPage - currentChapterStart : null;
  const isPastCurrentChapterStart =
    pagesFromCurrentChapterStart != null && pagesFromCurrentChapterStart > 0;
  const pagesBack = isPastCurrentChapterStart
    ? pagesFromCurrentChapterStart
    : prevChapterStart != null
      ? currentPage - prevChapterStart
      : null;
  const pagesForward =
    nextChapterStart != null
      ? nextChapterStart - currentPage
      : hasNext
        ? null
        : totalPages - currentPage;

  const handlePrevClick = () => {
    if (isPastCurrentChapterStart) {
      onGoToChapter(currentChapterIndex);
      return;
    }
    onPrevChapter();
  };

  const currentChapterTitle = chapterEntries[currentChapterIndex]?.title ?? "";

  return (
    // relative container: buttons sit at edges, title is absolutely centered
    <div className="relative flex h-8 items-center">
      {/* Prev chapter — hidden entirely when not available */}
      {hasPrev && (
        <button
          onClick={handlePrevClick}
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          aria-label={
            isPastCurrentChapterStart
              ? "Start of current chapter"
              : "Previous chapter"
          }
        >
          <ChevronLeft className="size-3.5 flex-shrink-0" />
          {pagesBack !== null && pagesBack > 0 && (
            <span className="leading-none">
              {pagesBack}p
            </span>
          )}
        </button>
      )}

      {/* Chapter title — absolutely centered so it's unaffected by button presence */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center px-20">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={currentChapterIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="truncate text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground leading-tight"
          >
            {currentChapterTitle}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Next chapter — hidden entirely when not available */}
      {hasNext && (
        <button
          onClick={onNextChapter}
          className="ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          aria-label="Next chapter"
        >
          {pagesForward !== null && pagesForward > 0 && (
            <span className="leading-none">
              {pagesForward}p
            </span>
          )}
          <ChevronRight className="size-3.5 flex-shrink-0" />
        </button>
      )}
    </div>
  );
}

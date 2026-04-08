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
    <div className="relative flex items-center h-8 px-2">
      {/* Prev chapter — hidden entirely when not available */}
      {hasPrev && (
        <button
          onClick={handlePrevClick}
          className="flex items-center gap-0.5 px-1.5 py-1 rounded-md text-muted-foreground hover:bg-muted/60 transition-colors flex-shrink-0"
          aria-label={
            isPastCurrentChapterStart
              ? "Start of current chapter"
              : "Previous chapter"
          }
        >
          <ChevronLeft className="size-3.5 flex-shrink-0" />
          {pagesBack !== null && pagesBack > 0 && (
            <span className="text-[11px] leading-none tabular-nums">
              {pagesBack}p
            </span>
          )}
        </button>
      )}

      {/* Chapter title — absolutely centered so it's unaffected by button presence */}
      <div className="absolute inset-x-0 flex justify-center pointer-events-none px-16">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={currentChapterIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="text-[12px] font-medium text-foreground truncate leading-tight"
          >
            {currentChapterTitle}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Next chapter — hidden entirely when not available */}
      {hasNext && (
        <button
          onClick={onNextChapter}
          className="flex items-center gap-0.5 px-1.5 py-1 rounded-md text-muted-foreground hover:bg-muted/60 transition-colors flex-shrink-0 ml-auto"
          aria-label="Next chapter"
        >
          {pagesForward !== null && pagesForward > 0 && (
            <span className="text-[11px] leading-none tabular-nums">
              {pagesForward}p
            </span>
          )}
          <ChevronRight className="size-3.5 flex-shrink-0" />
        </button>
      )}
    </div>
  );
}

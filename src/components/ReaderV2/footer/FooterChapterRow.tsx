import type { ChapterEntry } from "@/components/ReaderV2/hooks/use-reader-v2-core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

interface FooterChapterRowProps {
  currentChapterIndex: number;
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentPage: number;
  totalPages: number;
  onPrevChapter: () => void;
  onNextChapter: () => void;
}

export function FooterChapterRow({
  currentChapterIndex,
  chapterEntries,
  chapterStartPages,
  currentPage,
  totalPages,
  onPrevChapter,
  onNextChapter,
}: FooterChapterRowProps) {
  const hasPrev = currentChapterIndex > 0;
  const hasNext = currentChapterIndex < chapterEntries.length - 1;

  const currentChapterStart = chapterStartPages[currentChapterIndex];
  const nextChapterStart = chapterStartPages[currentChapterIndex + 1];

  const pagesBack =
    currentChapterStart !== null && currentChapterStart !== undefined
      ? currentPage - currentChapterStart
      : null;
  const pagesForward =
    nextChapterStart !== null && nextChapterStart !== undefined
      ? nextChapterStart - currentPage
      : hasNext
        ? null
        : totalPages - currentPage;

  const currentChapterTitle =
    chapterEntries[currentChapterIndex]?.title ?? "";

  return (
    <div className="flex items-center px-2 py-1 gap-1">
      {/* Prev chapter */}
      <button
        onClick={onPrevChapter}
        disabled={!hasPrev}
        className="flex items-center gap-0.5 px-1.5 py-1.5 rounded-md text-muted-foreground hover:bg-muted/60 disabled:opacity-30 disabled:pointer-events-none transition-colors flex-shrink-0"
        aria-label="Previous chapter"
      >
        <ChevronLeft className="size-3.5 flex-shrink-0" />
        {pagesBack !== null && pagesBack > 0 && (
          <span className="text-[11px] leading-none tabular-nums">{pagesBack}p</span>
        )}
      </button>

      {/* Chapter title */}
      <div className="flex-1 min-w-0 text-center px-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={currentChapterIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="block text-[12px] font-medium text-foreground truncate leading-tight"
          >
            {currentChapterTitle}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Next chapter */}
      <button
        onClick={onNextChapter}
        disabled={!hasNext}
        className="flex items-center gap-0.5 px-1.5 py-1.5 rounded-md text-muted-foreground hover:bg-muted/60 disabled:opacity-30 disabled:pointer-events-none transition-colors flex-shrink-0"
        aria-label="Next chapter"
      >
        {pagesForward !== null && pagesForward > 0 && (
          <span className="text-[11px] leading-none tabular-nums">{pagesForward}p</span>
        )}
        <ChevronRight className="size-3.5 flex-shrink-0" />
      </button>
    </div>
  );
}

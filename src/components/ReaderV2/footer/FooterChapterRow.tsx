import type { ChapterEntry } from "@/components/ReaderV2/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { FOOTER_READY_DETAIL_DELAY } from "./FooterLoadingState";

interface FooterChapterRowProps {
  currentChapterIndex: number;
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentPage: number;
  totalPages: number;
  onGoToChapter: (chapterIndex: number) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  isLoading?: boolean;
  animateReadyDetails?: boolean;
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
  isLoading = false,
  animateReadyDetails = false,
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
      <AnimatePresence initial={false}>
        {hasPrev && !isLoading && (
          <motion.button
            key="prev"
            onClick={handlePrevClick}
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
            aria-label={
              isPastCurrentChapterStart
                ? "Start of current chapter"
                : "Previous chapter"
            }
            initial={
              animateReadyDetails
                ? { opacity: 0, x: -8, filter: "blur(4px)" }
                : false
            }
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -6, filter: "blur(3px)" }}
            transition={
              animateReadyDetails
                ? {
                    duration: 0.24,
                    delay: FOOTER_READY_DETAIL_DELAY,
                    ease: [0.22, 1, 0.36, 1],
                  }
                : undefined
            }
          >
            <ChevronLeft className="size-3.5 flex-shrink-0" />
            {pagesBack !== null && pagesBack > 0 && (
              <span className="leading-none">
                {pagesBack}p
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

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
      <AnimatePresence initial={false}>
        {hasNext && !isLoading && (
          <motion.button
            key="next"
            onClick={onNextChapter}
            className="ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
            aria-label="Next chapter"
            initial={
              animateReadyDetails
                ? { opacity: 0, x: 8, filter: "blur(4px)" }
                : false
            }
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: 6, filter: "blur(3px)" }}
            transition={
              animateReadyDetails
                ? {
                    duration: 0.24,
                    delay: FOOTER_READY_DETAIL_DELAY,
                    ease: [0.22, 1, 0.36, 1],
                  }
                : undefined
            }
          >
            {pagesForward !== null && pagesForward > 0 && (
              <span className="leading-none">
                {pagesForward}p
              </span>
            )}
            <ChevronRight className="size-3.5 flex-shrink-0" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

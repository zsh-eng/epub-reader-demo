import type { ChapterEntry } from "@/components/Reader/types";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { FOOTER_READY_DETAIL_DELAY } from "./FooterLoadingState";

interface FooterChapterRowProps {
  currentChapterIndex: number;
  currentTitleChapterIndex: number | null;
  detailCurrentChapterIndex?: number;
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentPage: number;
  totalPages: number;
  onGoToChapter: (chapterIndex: number) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  isLoading?: boolean;
  preserveDetailsWhileLoading?: boolean;
  animateReadyDetails?: boolean;
}

export function FooterChapterRow({
  currentChapterIndex,
  currentTitleChapterIndex,
  detailCurrentChapterIndex,
  chapterEntries,
  chapterStartPages,
  currentPage,
  totalPages,
  onGoToChapter,
  onPrevChapter,
  onNextChapter,
  isLoading = false,
  preserveDetailsWhileLoading = false,
  animateReadyDetails = false,
}: FooterChapterRowProps) {
  const metricsChapterIndex = detailCurrentChapterIndex ?? currentChapterIndex;
  const hasPrev = metricsChapterIndex > 0;
  const hasNext = metricsChapterIndex < chapterEntries.length - 1;
  const showBlurredLoadingDetails = isLoading && preserveDetailsWhileLoading;
  const showDetails = !isLoading || showBlurredLoadingDetails;

  const prevChapterStart = chapterStartPages[metricsChapterIndex - 1];
  const currentChapterStart = chapterStartPages[metricsChapterIndex];
  const nextChapterStart = chapterStartPages[metricsChapterIndex + 1];

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
      onGoToChapter(metricsChapterIndex);
      return;
    }
    onPrevChapter();
  };

  const currentChapterTitle =
    currentTitleChapterIndex != null
      ? chapterEntries[currentTitleChapterIndex]?.title ?? ""
      : "";

  return (
    // relative container: buttons sit at edges, title is absolutely centered
    <div className="relative flex h-8 items-center">
      {/* Prev chapter — hidden entirely when not available */}
      <AnimatePresence initial={false}>
        {hasPrev && showDetails && (
          <motion.button
            key="prev"
            onClick={handlePrevClick}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] tabular-nums text-muted-foreground transition-colors",
              showBlurredLoadingDetails
                ? "pointer-events-none"
                : "hover:bg-secondary/70 hover:text-foreground",
            )}
            aria-label={
              isPastCurrentChapterStart
                ? "Start of current chapter"
                : "Previous chapter"
            }
            disabled={showBlurredLoadingDetails}
            initial={
              animateReadyDetails
                ? { opacity: 0, filter: "blur(8px)" }
                : false
            }
            animate={{
              opacity: showBlurredLoadingDetails ? 0.76 : 1,
              filter: showBlurredLoadingDetails ? "blur(6px)" : "blur(0px)",
            }}
            exit={{ opacity: 0, filter: "blur(4px)" }}
            transition={
              animateReadyDetails || showBlurredLoadingDetails
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
            key={currentTitleChapterIndex ?? "unknown"}
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
        {hasNext && showDetails && (
          <motion.button
            key="next"
            onClick={onNextChapter}
            className={cn(
              "ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] tabular-nums text-muted-foreground transition-colors",
              showBlurredLoadingDetails
                ? "pointer-events-none"
                : "hover:bg-secondary/70 hover:text-foreground",
            )}
            aria-label="Next chapter"
            disabled={showBlurredLoadingDetails}
            initial={
              animateReadyDetails
                ? { opacity: 0, filter: "blur(8px)" }
                : false
            }
            animate={{
              opacity: showBlurredLoadingDetails ? 0.76 : 1,
              filter: showBlurredLoadingDetails ? "blur(6px)" : "blur(0px)",
            }}
            exit={{ opacity: 0, filter: "blur(4px)" }}
            transition={
              animateReadyDetails || showBlurredLoadingDetails
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

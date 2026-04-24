import type { ReaderChromeSurfaceProps } from "@/components/Reader/chrome";
import type { ChapterEntry } from "@/components/Reader/types";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FooterChapterRow } from "./FooterChapterRow";
import { FooterScrubberLoading } from "./FooterLoadingState";
import { FooterPageIndicator } from "./FooterPageIndicator";
import { FooterScrubberCanvas } from "./FooterScrubberCanvas";

const CHROME_ENTER_TRANSITION = {
  duration: 0.26,
  ease: [0.16, 1, 0.3, 1] as const,
};
const CHROME_EXIT_TRANSITION = {
  duration: 0.18,
  ease: [0.32, 0, 0.67, 0] as const,
};
const CHROME_FADE_IN_TRANSITION = {
  duration: 0.18,
  ease: "easeOut" as const,
};
const CHROME_FADE_OUT_TRANSITION = {
  duration: 0.14,
  ease: "easeIn" as const,
};

export interface ReaderFooterProps {
  chromeVisible: boolean;
  chromeSurfaceProps?: ReaderChromeSurfaceProps;
  currentPage: number;
  totalPages: number;
  currentChapterIndex: number;
  currentChapterEndIndex: number;
  currentTitleChapterIndex: number | null;
  isContentsOpen: boolean;
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  onScrubPreview: (page: number) => void;
  onScrubCommit: (page: number) => void;
  onGoToChapter: (chapterIndex: number) => void;
  onPrevChapter: () => void;
  onOpenContents: () => void;
  isLoading?: boolean;
}

export function ReaderFooter({
  chromeVisible,
  chromeSurfaceProps,
  currentPage,
  totalPages,
  currentChapterIndex,
  currentChapterEndIndex,
  currentTitleChapterIndex,
  isContentsOpen,
  chapterEntries,
  chapterStartPages,
  onScrubPreview,
  onScrubCommit,
  onGoToChapter,
  onPrevChapter,
  onOpenContents,
  isLoading = false,
}: ReaderFooterProps) {
  const [cancelMomentumSignal, setCancelMomentumSignal] = useState(0);
  const prevIsLoadingRef = useRef(isLoading);
  const [hasBeenReady, setHasBeenReady] = useState(!isLoading);
  const lastReadyDetailsRef = useRef<{
    currentPage: number;
    totalPages: number;
    currentChapterIndex: number;
    currentChapterEndIndex: number;
    chapterStartPages: (number | null)[];
  } | null>(
    !isLoading
      ? {
          currentPage,
          totalPages,
          currentChapterIndex,
          currentChapterEndIndex,
          chapterStartPages: [...chapterStartPages],
        }
      : null,
  );
  const animateReadyTransition = prevIsLoadingRef.current && !isLoading;
  const animateLoadingTransition = !prevIsLoadingRef.current && isLoading;
  const preserveDetailsWhileLoading =
    isLoading && hasBeenReady && !!lastReadyDetailsRef.current;

  useEffect(() => {
    prevIsLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading) {
      setHasBeenReady(true);
      lastReadyDetailsRef.current = {
        currentPage,
        totalPages,
        currentChapterIndex,
        currentChapterEndIndex,
        chapterStartPages: [...chapterStartPages],
      };
    }
  }, [
    chapterStartPages,
    currentChapterEndIndex,
    currentChapterIndex,
    currentPage,
    isLoading,
    totalPages,
  ]);

  const interruptScrubberMomentum = useCallback(() => {
    setCancelMomentumSignal((signal) => signal + 1);
  }, []);

  const handleGoToChapter = useCallback(
    (chapterIndex: number) => {
      interruptScrubberMomentum();
      onGoToChapter(chapterIndex);
    },
    [interruptScrubberMomentum, onGoToChapter],
  );

  const handlePrevChapter = useCallback(() => {
    interruptScrubberMomentum();
    onPrevChapter();
  }, [interruptScrubberMomentum, onPrevChapter]);

  const detailCurrentPage =
    preserveDetailsWhileLoading && lastReadyDetailsRef.current
      ? lastReadyDetailsRef.current.currentPage
      : currentPage;
  const detailTotalPages =
    preserveDetailsWhileLoading && lastReadyDetailsRef.current
      ? lastReadyDetailsRef.current.totalPages
      : totalPages;
  const detailCurrentChapterIndex =
    preserveDetailsWhileLoading && lastReadyDetailsRef.current
      ? lastReadyDetailsRef.current.currentChapterIndex
      : currentChapterIndex;
  const detailCurrentChapterEndIndex =
    preserveDetailsWhileLoading && lastReadyDetailsRef.current
      ? lastReadyDetailsRef.current.currentChapterEndIndex
      : currentChapterEndIndex;
  const detailChapterStartPages =
    preserveDetailsWhileLoading && lastReadyDetailsRef.current
      ? lastReadyDetailsRef.current.chapterStartPages
      : chapterStartPages;

  return (
    <AnimatePresence>
      {chromeVisible && (
        <motion.div
          key="footer"
          initial={{ y: "100%", opacity: 0 }}
          animate={{
            y: 0,
            opacity: 1,
            transition: {
              y: CHROME_ENTER_TRANSITION,
              opacity: CHROME_FADE_IN_TRANSITION,
            },
          }}
          exit={{
            y: "100%",
            opacity: 0,
            transition: {
              y: CHROME_EXIT_TRANSITION,
              opacity: CHROME_FADE_OUT_TRANSITION,
            },
          }}
          className="absolute inset-x-0 bottom-0 z-20 border-t border-border/70 bg-background/88 backdrop-blur-xl"
          {...chromeSurfaceProps}
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)",
          }}
        >
          <div className="mx-auto flex max-w-7xl flex-col px-3 pt-1 sm:px-4">
            <FooterChapterRow
              currentChapterIndex={currentChapterIndex}
              currentTitleChapterIndex={currentTitleChapterIndex}
              chapterEntries={chapterEntries}
              detailCurrentChapterIndex={detailCurrentChapterIndex}
              currentChapterEndIndex={currentChapterEndIndex}
              detailCurrentChapterEndIndex={detailCurrentChapterEndIndex}
              chapterStartPages={detailChapterStartPages}
              currentPage={detailCurrentPage}
              totalPages={detailTotalPages}
              onGoToChapter={handleGoToChapter}
              onPrevChapter={handlePrevChapter}
              onOpenContents={onOpenContents}
              isContentsOpen={isContentsOpen}
              isLoading={isLoading}
              preserveDetailsWhileLoading={preserveDetailsWhileLoading}
              animateReadyDetails={animateReadyTransition}
            />
            <div className="px-1">
              <div className="relative h-14">
                <AnimatePresence>
                  {isLoading ? (
                    <motion.div
                      key="loading"
                      className="absolute inset-0"
                      initial={
                        animateLoadingTransition
                          ? { opacity: 0, filter: "blur(6px)" }
                          : false
                      }
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, filter: "blur(6px)" }}
                      transition={
                        animateLoadingTransition
                          ? { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                          : undefined
                      }
                    >
                      <FooterScrubberLoading />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="ready"
                      className="absolute inset-0"
                      initial={
                        animateReadyTransition
                          ? {
                              opacity: 0,
                              filter: "blur(8px)",
                              clipPath: "inset(0 50% 0 50%)",
                            }
                          : false
                      }
                      animate={{
                        opacity: 1,
                        filter: "blur(0px)",
                        clipPath: "inset(0 0% 0 0%)",
                      }}
                      exit={{ opacity: 0, filter: "blur(4px)" }}
                      transition={
                        animateReadyTransition
                          ? {
                              opacity: {
                                duration: 0.22,
                                ease: [0.22, 1, 0.36, 1],
                              },
                              filter: {
                                duration: 0.22,
                                ease: [0.22, 1, 0.36, 1],
                              },
                              clipPath: {
                                duration: 0.46,
                                ease: [0.22, 1, 0.36, 1],
                              },
                            }
                          : undefined
                      }
                    >
                      <motion.div
                        initial={
                          animateReadyTransition ? { opacity: 0.72 } : false
                        }
                        animate={{ opacity: 1 }}
                        transition={
                          animateReadyTransition
                            ? { duration: 0.18 }
                            : undefined
                        }
                      >
                        <FooterScrubberCanvas
                          currentPage={currentPage}
                          totalPages={totalPages}
                          chapterStartPages={chapterStartPages}
                          onScrubCommit={onScrubCommit}
                          onScrubPreview={onScrubPreview}
                          cancelMomentumSignal={cancelMomentumSignal}
                        />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <FooterPageIndicator
              currentPage={detailCurrentPage}
              totalPages={detailTotalPages}
              isLoading={isLoading}
              preserveDetailsWhileLoading={preserveDetailsWhileLoading}
              animateReadyDetails={animateReadyTransition}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import type { ChapterEntry } from "@/components/ReaderV2/types";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { FooterChapterRow } from "./FooterChapterRow";
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

export interface ReaderV2FooterProps {
  chromeVisible: boolean;
  currentPage: number;
  totalPages: number;
  currentChapterIndex: number;
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  onGoToPage: (page: number) => void;
  onGoToChapter: (chapterIndex: number) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
}

export function ReaderV2Footer({
  chromeVisible,
  currentPage,
  totalPages,
  currentChapterIndex,
  chapterEntries,
  chapterStartPages,
  onGoToPage,
  onGoToChapter,
  onPrevChapter,
  onNextChapter,
}: ReaderV2FooterProps) {
  const [cancelMomentumSignal, setCancelMomentumSignal] = useState(0);

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

  const handleNextChapter = useCallback(() => {
    interruptScrubberMomentum();
    onNextChapter();
  }, [interruptScrubberMomentum, onNextChapter]);

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
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)",
          }}
        >
          <div className="mx-auto flex max-w-7xl flex-col px-3 pt-1 sm:px-4">
            <FooterChapterRow
              currentChapterIndex={currentChapterIndex}
              chapterEntries={chapterEntries}
              chapterStartPages={chapterStartPages}
              currentPage={currentPage}
              totalPages={totalPages}
              onGoToChapter={handleGoToChapter}
              onPrevChapter={handlePrevChapter}
              onNextChapter={handleNextChapter}
            />
            <div className="px-1">
              <FooterScrubberCanvas
                currentPage={currentPage}
                totalPages={totalPages}
                chapterStartPages={chapterStartPages}
                onScrubCommit={onGoToPage}
                onScrubPreview={onGoToPage}
                cancelMomentumSignal={cancelMomentumSignal}
              />
            </div>
            <FooterPageIndicator
              currentPage={currentPage}
              totalPages={totalPages}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

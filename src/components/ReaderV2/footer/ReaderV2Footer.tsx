import type { ChapterEntry } from "@/components/ReaderV2/hooks/use-reader-v2-core";
import { AnimatePresence, motion } from "motion/react";
import { FooterChapterRow } from "./FooterChapterRow";
import { FooterPageIndicator } from "./FooterPageIndicator";
import { FooterScrubberCanvas } from "./FooterScrubberCanvas";

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
  return (
    <AnimatePresence>
      {chromeVisible && (
        <motion.div
          key="footer"
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.32, 0, 0.67, 0] }}
          className="absolute bottom-0 inset-x-0 z-20 bg-background border-t border-border"
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)",
          }}
        >
          <FooterChapterRow
            currentChapterIndex={currentChapterIndex}
            chapterEntries={chapterEntries}
            chapterStartPages={chapterStartPages}
            currentPage={currentPage}
            totalPages={totalPages}
            onGoToChapter={onGoToChapter}
            onPrevChapter={onPrevChapter}
            onNextChapter={onNextChapter}
          />
          <FooterPageIndicator currentPage={currentPage} totalPages={totalPages} />
          <FooterScrubberCanvas
            currentPage={currentPage}
            totalPages={totalPages}
            chapterStartPages={chapterStartPages}
            onScrubCommit={onGoToPage}
            onScrubPreview={onGoToPage}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

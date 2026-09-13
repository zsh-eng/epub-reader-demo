import { motion, useTransform, type MotionValue } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import type { ChapterEntry } from "../types";
import { FooterChapterRow } from "./FooterChapterRow";
import { FooterScrubberCanvas } from "./FooterScrubberCanvas";
import { FooterPageIndicator } from "./FooterPageIndicator";

// The peek reuses the footer visuals, but its inert surface cannot navigate.
const ignorePeekAction = () => {};

interface ReaderProgressPeekProps {
  offset: MotionValue<number>;
  height: MotionValue<number>;
  currentPage: number;
  totalPages: number;
  currentChapterIndex: number;
  currentChapterEndIndex: number;
  displayChapterIndex: number | null;
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  available: boolean;
}

/**
 * A read-only glance at progress. The surface stays mounted below the viewport;
 * the gesture offset owns its translation during both dragging and return.
 * Measuring the full surface keeps the gesture capped at the visible edge.
 */
export function ReaderProgressPeek({
  offset,
  height,
  currentPage,
  totalPages,
  currentChapterIndex,
  currentChapterEndIndex,
  displayChapterIndex,
  chapterEntries,
  chapterStartPages,
  available,
}: ReaderProgressPeekProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const y = useTransform(() => -Math.min(offset.get(), height.get()));

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const measure = () => height.set(surface.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [height]);

  return (
    <motion.div
      ref={surfaceRef}
      data-reader-progress-peek=""
      aria-hidden="true"
      inert
      className="pointer-events-none absolute inset-x-0 top-full z-30 border-t border-border/70 bg-background/88 backdrop-blur-xl"
      style={{
        y,
        visibility: available ? "visible" : "hidden",
        // This passive peek needs less bottom clearance than the interactive footer.
        paddingBottom: "clamp(0.25rem, env(safe-area-inset-bottom), 1rem)",
      }}
    >
      <div className="mx-auto flex max-w-7xl flex-col px-3 pt-1 sm:px-4">
        <FooterChapterRow
          currentChapterIndex={currentChapterIndex}
          currentChapterEndIndex={currentChapterEndIndex}
          displayChapterIndex={displayChapterIndex}
          chapterEntries={chapterEntries}
          chapterStartPages={chapterStartPages}
          currentPage={currentPage}
          totalPages={totalPages}
          onGoToChapter={ignorePeekAction}
          onPrevChapter={ignorePeekAction}
          onOpenContents={ignorePeekAction}
          isContentsOpen={false}
        />
        <div className="px-1">
          <FooterScrubberCanvas
            currentPage={currentPage}
            totalPages={totalPages}
            chapterStartPages={chapterStartPages}
            onScrubCommit={ignorePeekAction}
            readOnly
          />
        </div>
        <FooterPageIndicator
          currentPage={currentPage}
          totalPages={totalPages}
          testId="reader-peek-page-indicator"
        />
      </div>
    </motion.div>
  );
}

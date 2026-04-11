import type { PaginationConfig } from "@/lib/pagination-v2";
import type { ResolvedSpread, SpreadConfig } from "@/lib/pagination-v2/types";
import { AnimatePresence, MotionConfig } from "motion/react";
import type { MouseEventHandler, RefObject } from "react";
import { AnimatedSpread, type NavDirection } from "./AnimatedSpread";

interface SpreadStageProps {
  spread: ResolvedSpread | null;
  spreadConfig: SpreadConfig;
  columnSpacingPx: number;
  paginationConfig: PaginationConfig;
  bookId: string;
  deferredImageCache: Map<string, string>;
  stageContentRef?: RefObject<HTMLDivElement | null>;
  onPageContentClick?: MouseEventHandler<HTMLDivElement>;
  showDebugOutlines?: boolean;
  paddingTopPx: number;
  paddingBottomPx: number;
  paddingLeftPx: number;
  paddingRightPx: number;
}

function toNavDirection(
  intent: ResolvedSpread["intent"] | undefined,
): NavDirection {
  if (intent?.kind === "linear" && intent.direction === "forward") {
    return "forward";
  }
  if (intent?.kind === "linear" && intent.direction === "backward") {
    return "backward";
  }
  return "instant";
}

export function SpreadStage({
  spread,
  spreadConfig,
  columnSpacingPx,
  paginationConfig,
  bookId,
  deferredImageCache,
  stageContentRef,
  onPageContentClick,
  showDebugOutlines = false,
  paddingTopPx,
  paddingBottomPx,
  paddingLeftPx,
  paddingRightPx,
}: SpreadStageProps) {
  const direction = toNavDirection(spread?.intent);

  return (
    <MotionConfig reducedMotion="user">
      {/* position:relative + overflow:hidden clips pages as they slide in/out */}
      <div
        ref={stageContentRef}
        onClick={onPageContentClick}
        className="relative h-full w-full overflow-hidden"
      >
        <AnimatePresence custom={direction} mode="sync">
          {spread && (
            <AnimatedSpread
              key={spread.currentSpread}
              spread={spread}
              spreadConfig={spreadConfig}
              columnSpacingPx={columnSpacingPx}
              paginationConfig={paginationConfig}
              bookId={bookId}
              deferredImageCache={deferredImageCache}
              showDebugOutlines={showDebugOutlines}
              paddingTopPx={paddingTopPx}
              paddingBottomPx={paddingBottomPx}
              paddingLeftPx={paddingLeftPx}
              paddingRightPx={paddingRightPx}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

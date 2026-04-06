import type { PaginationConfig } from "@/lib/pagination-v2";
import type { ResolvedSpread, SpreadConfig } from "@/lib/pagination-v2/types";
import { AnimatePresence, MotionConfig } from "motion/react";
import { AnimatedSpread, type NavDirection } from "./AnimatedSpread";

interface SpreadStageProps {
  spread: ResolvedSpread | null;
  spreadConfig: SpreadConfig;
  columnSpacingPx: number;
  paginationConfig: PaginationConfig;
  bookId: string;
  deferredImageCache: Map<string, string>;
}

function toNavDirection(cause: ResolvedSpread["cause"] | undefined): NavDirection {
  if (cause === "nextSpread") return "forward";
  if (cause === "prevSpread") return "backward";
  return "instant";
}

export function SpreadStage({
  spread,
  spreadConfig,
  columnSpacingPx,
  paginationConfig,
  bookId,
  deferredImageCache,
}: SpreadStageProps) {
  const direction = toNavDirection(spread?.cause);

  return (
    <MotionConfig reducedMotion="user">
      {/* position:relative + overflow:hidden clips pages as they slide in/out */}
      <div className="relative h-full w-full overflow-hidden">
        <AnimatePresence custom={direction}>
          {spread && (
            <AnimatedSpread
              key={spread.currentSpread}
              spread={spread}
              spreadConfig={spreadConfig}
              columnSpacingPx={columnSpacingPx}
              paginationConfig={paginationConfig}
              bookId={bookId}
              deferredImageCache={deferredImageCache}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

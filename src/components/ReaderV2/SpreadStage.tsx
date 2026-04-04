import type { PaginationConfig } from "@/lib/pagination-v2";
import type { ResolvedSpread, SpreadConfig } from "@/lib/pagination-v2/types";
import { AnimatePresence, MotionConfig } from "motion/react";
import type { MutableRefObject } from "react";
import { AnimatedSpread } from "./AnimatedSpread";
import type { NavDirection } from "./hooks/use-nav-direction";

interface SpreadStageProps {
  spread: ResolvedSpread | null;
  directionRef: MutableRefObject<NavDirection>;
  spreadConfig: SpreadConfig;
  columnSpacingPx: number;
  paginationConfig: PaginationConfig;
  bookId: string;
  deferredImageCache: Map<string, string>;
}

export function SpreadStage({
  spread,
  directionRef,
  spreadConfig,
  columnSpacingPx,
  paginationConfig,
  bookId,
  deferredImageCache,
}: SpreadStageProps) {
  return (
    <MotionConfig reducedMotion="user">
      {/* position:relative + overflow:hidden clips pages as they slide in/out */}
      <div className="relative h-full w-full overflow-hidden">
        <AnimatePresence custom={directionRef.current} mode="sync">
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

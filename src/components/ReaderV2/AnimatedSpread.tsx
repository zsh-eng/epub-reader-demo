import type { PaginationConfig } from "@/lib/pagination-v2";
import type { ResolvedSpread, SpreadConfig } from "@/lib/pagination-v2/types";
import { motion, useIsPresent, usePresenceData } from "motion/react";
import { PageSliceView } from "./PageSliceView";
import type { NavDirection } from "./hooks/use-nav-direction";

interface AnimatedSpreadProps {
  spread: ResolvedSpread;
  spreadConfig: SpreadConfig;
  columnSpacingPx: number;
  paginationConfig: PaginationConfig;
  bookId: string;
  deferredImageCache: Map<string, string>;
}

const EASE_OUT_QUAD = [0.25, 0.46, 0.45, 0.94] as [number, number, number, number];

/** Padding added around the text area so text doesn't sit at the edge of the page. */
export const PAGE_PADDING_X = 32;
export const PAGE_PADDING_Y = 48;

const pageVariants = {
  initial: (dir: NavDirection) => ({
    x: dir === "forward" ? "100%" : dir === "backward" ? "-33%" : 0,
  }),
  animate: {
    x: 0,
    transition: { type: "tween" as const, ease: EASE_OUT_QUAD, duration: 0.35 },
  },
  exit: (dir: NavDirection) => ({
    x: dir === "forward" ? "-33%" : dir === "backward" ? "100%" : 0,
    transition: {
      type: "tween" as const,
      ease: EASE_OUT_QUAD,
      // Parallax drift is slower to sell the depth illusion
      duration: dir === "forward" ? 0.45 : 0.35,
    },
  }),
};

export function AnimatedSpread({
  spread,
  spreadConfig,
  columnSpacingPx,
  paginationConfig,
  bookId,
  deferredImageCache,
}: AnimatedSpreadProps) {
  const direction = (usePresenceData() as NavDirection | undefined) ?? "instant";
  const isPresent = useIsPresent();

  // Z-index rules:
  //   backward exit  → 1 (slides away on top, revealing the incoming page beneath)
  //   forward enter  → 2 (slides in on top; must beat any stale backward-exit at 1)
  //   everything else → 0
  // The forward-enter value is intentionally higher than backward-exit so that an
  // interrupted prev→next sequence doesn't leave a stale exiting page above the
  // new incoming page.
  const zIndex = isPresent && direction === "forward" ? 2
    : !isPresent && direction === "backward" ? 1
    : 0;

  return (
    <motion.div
      className="absolute inset-0 h-full w-full overflow-hidden bg-card"
      style={{ zIndex }}
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* Padding wrapper — keeps text away from the page edges */}
      <div
        className="h-full w-full overflow-hidden"
        style={{ padding: `${PAGE_PADDING_Y}px ${PAGE_PADDING_X}px` }}
      >
      <div
        className="h-full w-full overflow-hidden grid"
        style={{
          gridTemplateColumns: `repeat(${spreadConfig.columns}, minmax(0, 1fr))`,
          columnGap: `${columnSpacingPx}px`,
        }}
      >
        {spread.slots.map((slot) => {
          if (slot.kind === "gap") {
            return (
              <div
                key={`gap-${slot.slotIndex}`}
                className="h-full w-full bg-muted/20 reader-container-outline"
              />
            );
          }

          return (
            <div
              key={`page-${slot.slotIndex}-${slot.page.currentPage}`}
              className="h-full w-full overflow-hidden reader-container-outline"
            >
              {slot.page.content.map((slice, i) => (
                <PageSliceView
                  key={`${slice.blockId}-${slot.slotIndex}-${i}`}
                  slice={slice}
                  sliceIndex={i}
                  bookId={bookId}
                  deferredImageCache={deferredImageCache}
                  baseFontSize={paginationConfig.fontConfig.baseSizePx}
                />
              ))}
            </div>
          );
        })}
      </div>
      </div>
    </motion.div>
  );
}

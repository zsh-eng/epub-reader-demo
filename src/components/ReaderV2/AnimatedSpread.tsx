import type { PaginationConfig } from "@/lib/pagination-v2";
import type { ResolvedSpread, SpreadConfig } from "@/lib/pagination-v2/types";
import { motion, useIsPresent, usePresenceData } from "motion/react";
import { useRef } from "react";
import { PageSliceView } from "./PageSliceView";

export type NavDirection = "forward" | "backward" | "instant";

interface AnimatedSpreadProps {
  spread: ResolvedSpread;
  spreadConfig: SpreadConfig;
  columnSpacingPx: number;
  paginationConfig: PaginationConfig;
  bookId: string;
  deferredImageCache: Map<string, string>;
  showDebugOutlines?: boolean;
  paddingTopPx: number;
  paddingBottomPx: number;
  paddingLeftPx: number;
  paddingRightPx: number;
}

const EASE_OUT_QUAD = [0.25, 0.46, 0.45, 0.94] as [
  number,
  number,
  number,
  number,
];

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
  showDebugOutlines = false,
  paddingTopPx,
  paddingBottomPx,
  paddingLeftPx,
  paddingRightPx,
}: AnimatedSpreadProps) {
  const rawDirection =
    (usePresenceData() as NavDirection | undefined) ?? "instant";
  const isPresent = useIsPresent();

  // Freeze the direction the moment a component starts exiting so that rapid
  // navigation (which changes AnimatePresence's `custom` prop) cannot redirect
  // a mid-flight exit animation or flip its z-index.
  //
  // Why this is needed: PresenceChild's useMemo depends on `onExitComplete`,
  // which AnimatePresence recreates on every render. This means usePresenceData()
  // is effectively live — all components (including ones already exiting) see the
  // latest `custom` value after any parent re-render. Without freezing, pressing
  // prev while page 1 is still exiting forward causes it to redirect rightward
  // and pop to z=1, appearing incorrectly on top of the incoming page.
  const frozenExitDir = useRef<NavDirection | null>(null);
  if (isPresent) {
    frozenExitDir.current = null; // reset when re-entering
  } else if (frozenExitDir.current === null) {
    frozenExitDir.current = rawDirection; // freeze on first exit render
  }
  const direction = isPresent
    ? rawDirection
    : (frozenExitDir.current ?? rawDirection);

  // Z-index rules:
  //   backward exit  → 1 (slides away on top, revealing the incoming page beneath)
  //   forward enter  → 2 (slides in on top; must beat any stale backward-exit at 1)
  //   everything else → 0
  // The forward-enter value is intentionally higher than backward-exit so that an
  // interrupted prev→next sequence doesn't leave a stale exiting page above the
  // new incoming page.
  const zIndex =
    isPresent && direction === "forward"
      ? 2
      : !isPresent && direction === "backward"
        ? 1
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
        style={{
          paddingTop: `${paddingTopPx}px`,
          paddingBottom: `${paddingBottomPx}px`,
          paddingLeft: `${paddingLeftPx}px`,
          paddingRight: `${paddingRightPx}px`,
        }}
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
                  className={
                    showDebugOutlines
                      ? "h-full w-full bg-muted/20 reader-container-outline"
                      : "h-full w-full bg-muted/20"
                  }
                />
              );
            }

            return (
              <div
                key={`page-${slot.slotIndex}-${slot.page.currentPage}`}
                className={
                  showDebugOutlines
                    ? "h-full w-full overflow-hidden reader-container-outline"
                    : "h-full w-full overflow-hidden"
                }
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

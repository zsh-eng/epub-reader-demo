import { cn } from "@/lib/utils";
import { motion } from "motion/react";

const LOADING_LOOP = {
  duration: 2.3,
  ease: "easeInOut" as const,
  repeat: Infinity,
};
const SHIMMER_LOOP = {
  duration: 2.7,
  ease: [0.22, 1, 0.36, 1] as const,
  repeat: Infinity,
};

const MARK_HEIGHTS = [14, 18, 22, 28, 34, 38, 34, 28, 22, 18, 14];
const CENTER_INDEX = Math.floor(MARK_HEIGHTS.length / 2);
const MARK_CENTER_SPACING = 10;

export const FOOTER_READY_DETAIL_DELAY = 0.55;

export function FooterScrubberLoading() {
  return (
    <div aria-hidden="true" className="relative h-14 w-full overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border/70 to-transparent" />
      <div className="absolute inset-x-10 top-11 h-px bg-gradient-to-r from-transparent via-border/55 to-transparent" />

      <motion.div
        className="absolute inset-x-0 top-1"
        animate={{
          x: [-2.2, 1.6, -0.8, -2.2],
        }}
        transition={{
          duration: 2.8,
          ease: "easeInOut",
          repeat: Infinity,
        }}
      >
        <div
          className="absolute left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-foreground/90"
          style={{ top: -1, height: 8 }}
        />

        <motion.div
          className="pointer-events-none absolute left-1/2 top-0 h-10 w-40 -translate-x-1/2 bg-gradient-to-r from-transparent via-foreground/14 to-transparent blur-[7px]"
          animate={{
            x: [-120, 0, 120],
            opacity: [0, 0.55, 0],
          }}
          transition={{
            ...SHIMMER_LOOP,
          }}
        />
        <div className="relative h-10">
          {MARK_HEIGHTS.map((height, index) => {
            const distanceFromCenter = Math.abs(index - CENTER_INDEX);
            const isInnerBand = distanceFromCenter <= 1;
            const isMiddleBand = distanceFromCenter <= 3;
            const direction =
              index === CENTER_INDEX ? 0 : index < CENTER_INDEX ? -1 : 1;
            const xOffset = (index - CENTER_INDEX) * MARK_CENTER_SPACING;

            return (
              <motion.span
                key={`${height}-${index}`}
                className={cn(
                  "absolute top-0 block w-px -translate-x-1/2 rounded-full",
                  isInnerBand
                    ? "bg-foreground/55"
                    : isMiddleBand
                      ? "bg-muted-foreground/65"
                      : "bg-muted-foreground/45",
                )}
                style={{
                  left: `calc(50% + ${xOffset}px)`,
                  height,
                  transformOrigin: "center top",
                }}
                animate={{
                  opacity: isInnerBand
                    ? [0.35, 0.72, 0.38]
                    : isMiddleBand
                      ? [0.24, 0.5, 0.26]
                      : [0.16, 0.34, 0.18],
                  x:
                    direction === 0
                      ? [0, 0, 0]
                      : isInnerBand
                        ? [0, direction * 1.3, 0]
                        : isMiddleBand
                          ? [0, direction * 0.9, 0]
                          : [0, direction * 0.45, 0],
                  scaleY: isInnerBand
                    ? [0.92, 1.1, 0.95]
                    : isMiddleBand
                      ? [0.95, 1.04, 0.96]
                      : [0.97, 1.02, 0.98],
                  y: isInnerBand
                    ? [0, -1.6, 0]
                    : isMiddleBand
                      ? [0, -1, 0]
                      : [0, -0.55, 0],
                }}
                transition={{
                  ...LOADING_LOOP,
                  delay: distanceFromCenter * 0.06,
                }}
              />
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}

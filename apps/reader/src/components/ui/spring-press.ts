import { useAnimationControls, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";

const PRESS_COMPRESSION_MS = 100;

/**
 * Shared tactile feedback for large sheet controls.
 *
 * Motion confirms a completed tap instead of responding to pointer-down. This
 * lets the browser and the surrounding drawer decide whether the gesture is a
 * scroll before any feedback starts.
 */
export function useSpringPressAnimation() {
  const prefersReducedMotion = useReducedMotion();
  const controls = useAnimationControls();
  const reboundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReboundTimer = useCallback(() => {
    if (reboundTimerRef.current) clearTimeout(reboundTimerRef.current);
    reboundTimerRef.current = null;
  }, []);

  useEffect(
    () => () => {
      clearReboundTimer();
      controls.stop();
    },
    [clearReboundTimer, controls],
  );

  const runTapAnimation = useCallback(() => {
    clearReboundTimer();
    controls.stop();

    if (prefersReducedMotion) {
      void controls.start({
        opacity: 0.82,
        transition: { duration: 0.1, ease: [0.23, 1, 0.32, 1] },
      });

      reboundTimerRef.current = setTimeout(() => {
        reboundTimerRef.current = null;
        void controls.start({
          opacity: 1,
          transition: { duration: 0.1, ease: [0.23, 1, 0.32, 1] },
        });
      }, PRESS_COMPRESSION_MS);
      return;
    }

    void controls.start({
      transform: "scale(0.97)",
      transition: { duration: 0.1, ease: [0.23, 1, 0.32, 1] },
    });

    reboundTimerRef.current = setTimeout(() => {
      reboundTimerRef.current = null;
      void controls.start({
        transform: "scale(1)",
        transition: { type: "spring", duration: 0.2, bounce: 0.25 },
      });
    }, PRESS_COMPRESSION_MS);
  }, [clearReboundTimer, controls, prefersReducedMotion]);

  return {
    initial: { transform: "scale(1)", opacity: 1 },
    animate: controls,
    onTap: () => void runTapAnimation(),
  };
}

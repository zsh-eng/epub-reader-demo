import {
  restoreScrollFromPercentage,
  waitForContentStability,
} from "@/lib/scroll-anchor";
import { EPUB_HIGHLIGHT_DATA_ATTRIBUTE } from "@/types/reader.types";
import { type ScrollTarget } from "@/types/scroll-target";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseScrollTargetOptions {
  /** Ref to the content container element */
  contentRef: React.RefObject<HTMLElement | null>;
  /** Whether content is ready (loaded) */
  contentReady: boolean;
}

export interface UseScrollTargetReturn {
  /** The current scroll target (null if none) */
  scrollTarget: ScrollTarget | null;
  /** Set a new scroll target */
  setScrollTarget: (target: ScrollTarget) => void;
  /** Clear the current scroll target */
  clearScrollTarget: () => void;
  /** Whether scroll execution is currently in progress */
  isScrolling: boolean;
}

function scrollToFragment(fragmentId: string): boolean {
  const fragment = document.getElementById(fragmentId);
  if (!fragment) return false;
  fragment.scrollIntoView({ behavior: "instant", block: "center" });
  return true;
}

function scrollToHighlight(highlightId: string): boolean {
  const highlight = document.querySelector(
    `[${EPUB_HIGHLIGHT_DATA_ATTRIBUTE}="${highlightId}"]`,
  );
  if (!highlight) return false;
  highlight.scrollIntoView({ behavior: "instant", block: "center" });
  return true;
}

/**
 * Hook for managing scroll target state and executing scrolls when content is ready.
 *
 * This hook decouples the concept of "where to scroll" from navigation logic.
 * When a scroll target is set and content becomes ready, it automatically
 * executes the scroll and clears the target.
 */
export function useScrollTarget({
  contentRef,
  contentReady,
}: UseScrollTargetOptions): UseScrollTargetReturn {
  const [scrollTarget, setScrollTargetState] = useState<ScrollTarget | null>(
    null,
  );
  const [isScrolling, setIsScrolling] = useState(false);

  // Track if we've executed scroll for the current target to prevent double-execution
  const executedTargetRef = useRef<ScrollTarget | null>(null);

  const setScrollTarget = useCallback((target: ScrollTarget) => {
    setScrollTargetState(target);
    setIsScrolling(true);
    // Reset executed target when a new target is set
    executedTargetRef.current = null;
  }, []);

  const clearScrollTarget = useCallback(() => {
    setScrollTargetState(null);
    setIsScrolling(false);
    executedTargetRef.current = null;
  }, []);

  /**
   * Execute scroll when content is ready and we have a target
   */
  useEffect(() => {
    if (!contentReady || !scrollTarget) {
      return;
    }

    // Don't re-execute the same target
    if (executedTargetRef.current === scrollTarget) {
      return;
    }

    const executeScroll = async () => {
      // Wait for content to stabilize before scrolling
      if (contentRef.current) {
        await waitForContentStability(contentRef.current);
      }

      switch (scrollTarget.type) {
        case "top":
          window.scrollTo({ top: 0, behavior: "instant" });
          break;

        case "fragment":
          scrollToFragment(scrollTarget.id);
          break;

        case "percentage":
          if (scrollTarget.value > 0) {
            restoreScrollFromPercentage(scrollTarget.value);
          } else {
            // 0% means top of page
            window.scrollTo({ top: 0, behavior: "instant" });
          }
          break;

        case "highlight":
          scrollToHighlight(scrollTarget.highlightId);
          break;
      }

      // Mark as executed and complete
      executedTargetRef.current = scrollTarget;
      setIsScrolling(false);
      setScrollTargetState(null);
    };

    executeScroll();
  }, [contentReady, scrollTarget, contentRef]);

  return {
    scrollTarget,
    setScrollTarget,
    clearScrollTarget,
    isScrolling,
  };
}

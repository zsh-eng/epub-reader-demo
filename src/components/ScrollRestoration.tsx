import { useProgressMutation } from "@/hooks/use-progress-mutation";
import { type ReadingProgress } from "@/lib/db";
import {
  calculateScrollPercentage,
  findVisibleScrollAnchor,
  restoreScrollFromPercentage,
  waitForContentStability,
  type ScrollAnchor,
} from "@/lib/scroll-anchor";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export interface ScrollRestorationState {
  /** Whether scroll restoration is currently in progress */
  isRestoring: boolean;
  /** Whether scroll restoration has completed (successfully or not) */
  hasRestored: boolean;
}

export interface ScrollRestorationProps {
  /** The book ID for saving progress */
  bookId: string;
  /** Current chapter index */
  chapterIndex: number;
  /** Ref to the content container element */
  contentRef: React.RefObject<HTMLElement | null>;
  /** Initial reading progress loaded from the database */
  initialProgress: ReadingProgress | null;
  /** Whether content is ready (loaded) */
  contentReady: boolean;
  /** Children - can be React nodes or a render function */
  children:
    | React.ReactNode
    | ((state: ScrollRestorationState) => React.ReactNode);
  /** Ref containing a pending fragment ID to scroll to (takes precedence over percentage restoration) */
  pendingFragmentRef?: RefObject<string | null>;
  /** Callback to clear the pending fragment after scrolling */
  onFragmentScrolled?: () => void;
}

/** How often to auto-save progress (in milliseconds) */
const SAVE_INTERVAL_MS = 3000;

/** Threshold for considering scroll progress as "changed" */
const SCROLL_CHANGE_THRESHOLD = 0.01;

/**
 * ScrollRestoration Component
 *
 * Encapsulates all scroll position saving and restoration logic.
 * Handles:
 * - Restoring scroll position when content loads (using anchor or percentage fallback)
 * - Auto-saving progress every few seconds
 * - Saving on visibility change (tab switch) and before unload
 * - Using ResizeObserver to wait for content stability before restoring
 * - Optimistic updates for reading progress mutations
 */
export function ScrollRestoration({
  bookId,
  chapterIndex,
  contentRef,
  initialProgress,
  contentReady,
  children,
  pendingFragmentRef,
  onFragmentScrolled,
}: ScrollRestorationProps) {
  const [state, setState] = useState<ScrollRestorationState>({
    isRestoring: true,
    hasRestored: false,
  });

  // Use the extracted progress mutation hook
  const saveProgressMutation = useProgressMutation(bookId);

  // Track the last saved values to avoid unnecessary saves
  const lastSavedRef = useRef<{
    chapterIndex: number;
    scrollPercentage: number;
    scrollAnchor: ScrollAnchor | null;
  }>({
    chapterIndex: initialProgress?.currentSpineIndex ?? 0,
    scrollPercentage: initialProgress?.scrollProgress ?? 0,
    scrollAnchor: null,
  });

  // Track if we've already restored for this chapter
  const restoredChapterRef = useRef<number | null>(null);

  /**
   * Saves the current reading progress to the database.
   */
  const saveProgress = useCallback(
    async (force: boolean = false) => {
      if (!contentRef.current) return;

      const scrollPercentage = calculateScrollPercentage();
      const scrollAnchor = findVisibleScrollAnchor(contentRef.current);

      const last = lastSavedRef.current;

      // Check if anything has changed
      const hasChapterChanged = chapterIndex !== last.chapterIndex;
      const hasScrollChanged =
        Math.abs(scrollPercentage - last.scrollPercentage) >
        SCROLL_CHANGE_THRESHOLD;

      if (!force && !hasChapterChanged && !hasScrollChanged) {
        return;
      }

      // Update last saved values
      lastSavedRef.current = {
        chapterIndex,
        scrollPercentage,
        scrollAnchor,
      };

      // Build the progress object
      const progress: ReadingProgress = {
        id: bookId,
        bookId,
        currentSpineIndex: chapterIndex,
        scrollProgress: scrollPercentage,
        lastRead: new Date(),
      };

      // Add scroll anchor if available (stored as JSON string in a future db migration)
      // For now, we'll rely on percentage as the anchor field isn't in the schema yet

      // Use mutation instead of direct save
      saveProgressMutation.mutate(progress);
    },
    [bookId, chapterIndex, contentRef, saveProgressMutation],
  );

  /**
   * Scrolls to a fragment (element ID) in the content.
   * Returns true if the element was found and scrolled to.
   */
  const scrollToFragment = useCallback(
    async (fragment: string): Promise<boolean> => {
      console.log("pre-srolling to fragment", fragment);
      if (!contentRef.current) return false;

      // Wait for content to stabilize before trying to find the element
      await waitForContentStability(contentRef.current);

      console.log("scrolling to the fragment", fragment);
      const element = document.getElementById(fragment);
      if (element) {
        element.scrollIntoView({ behavior: "instant" });
        return true;
      }
      return false;
    },
    [contentRef],
  );

  /**
   * Restores scroll position from saved progress.
   */
  const restoreScrollPosition = useCallback(async () => {
    // Check if there's a pending fragment to scroll to (takes precedence)
    console.log("restoring scroll");
    console.log("pendingFragmentRef.current:", pendingFragmentRef?.current);

    if (pendingFragmentRef?.current) {
      const fragment = pendingFragmentRef.current;
      setState({ isRestoring: true, hasRestored: false });

      if (!contentRef.current) {
        setState({ isRestoring: false, hasRestored: true });
        return;
      }

      await scrollToFragment(fragment);
      onFragmentScrolled?.();
      setState({ isRestoring: false, hasRestored: true });
      return;
    }

    if (!contentRef.current || !initialProgress) {
      setState({ isRestoring: false, hasRestored: true });
      return;
    }

    // Only restore if we're on the saved chapter
    if (chapterIndex !== initialProgress.currentSpineIndex) {
      setState({ isRestoring: false, hasRestored: true });
      return;
    }

    setState({ isRestoring: true, hasRestored: false });

    // Wait for content to stabilize
    await waitForContentStability(contentRef.current);

    // Try anchor-based restoration first (when we add scrollAnchor to schema)
    // For now, fall back to percentage
    let restored = false;

    // Future: if (initialProgress.scrollAnchor) {
    //   restored = restoreScrollFromAnchor(contentRef.current, initialProgress.scrollAnchor);
    // }

    if (!restored && initialProgress.scrollProgress > 0) {
      restoreScrollFromPercentage(initialProgress.scrollProgress);
      restored = true;
    }

    setState({ isRestoring: false, hasRestored: true });
  }, [
    chapterIndex,
    contentRef,
    initialProgress,
    pendingFragmentRef,
    onFragmentScrolled,
    scrollToFragment,
  ]);

  /**
   * Effect: Restore scroll position when content becomes ready
   */
  useEffect(() => {
    if (!contentReady) return;

    // Don't restore if we've already restored for this chapter
    if (restoredChapterRef.current === chapterIndex) {
      return;
    }

    // Only restore on initial load (when chapter matches saved progress)
    if (initialProgress && chapterIndex === initialProgress.currentSpineIndex) {
      restoredChapterRef.current = chapterIndex;
      restoreScrollPosition();
    } else {
      // New chapter - mark as restored (nothing to restore)
      restoredChapterRef.current = chapterIndex;
      setState({ isRestoring: false, hasRestored: true });
    }
  }, [contentReady, chapterIndex, initialProgress, restoreScrollPosition]);

  /**
   * Effect: Auto-save progress at regular intervals
   */
  useEffect(() => {
    if (!contentReady || state.isRestoring) return;

    const intervalId = setInterval(() => {
      saveProgress();
    }, SAVE_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [contentReady, state.isRestoring, saveProgress]);

  /**
   * Effect: Save on visibility change (tab switch) and before unload
   */
  useEffect(() => {
    if (!contentReady || state.isRestoring) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveProgress(true);
      }
    };

    const handleBeforeUnload = () => {
      saveProgress(true);
    };

    // pagehide is more reliable than beforeunload on mobile
    const handlePageHide = () => {
      saveProgress(true);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [contentReady, state.isRestoring, saveProgress]);

  /**
   * Effect: Save progress on unmount
   */
  useEffect(() => {
    return () => {
      // Save on unmount
      saveProgress(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render children
  return <>{typeof children === "function" ? children(state) : children}</>;
}

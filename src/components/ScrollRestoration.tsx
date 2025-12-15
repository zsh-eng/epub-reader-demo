import { bookKeys } from "@/hooks/use-book-loader";
import { saveReadingProgress, type ReadingProgress } from "@/lib/db";
import {
  calculateScrollPercentage,
  findVisibleScrollAnchor,
  restoreScrollFromPercentage,
  waitForContentStability,
  type ScrollAnchor,
} from "@/lib/scroll-anchor";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

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
}: ScrollRestorationProps) {
  const queryClient = useQueryClient();

  const [state, setState] = useState<ScrollRestorationState>({
    isRestoring: true,
    hasRestored: false,
  });

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
   * Mutation for saving reading progress with optimistic updates
   */
  const saveProgressMutation = useMutation({
    mutationFn: async (progress: ReadingProgress) => {
      await saveReadingProgress(progress);
      return progress;
    },
    onMutate: async (newProgress) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({
        queryKey: bookKeys.progress(bookId),
      });

      // Snapshot the previous value
      const previousProgress = queryClient.getQueryData<ReadingProgress | null>(
        bookKeys.progress(bookId),
      );

      // Optimistically update to the new value
      queryClient.setQueryData<ReadingProgress | null>(
        bookKeys.progress(bookId),
        newProgress,
      );

      // Return context with previous value for rollback
      return { previousProgress };
    },
    onError: (err, _newProgress, context) => {
      // Rollback to previous value on error
      if (context?.previousProgress !== undefined) {
        queryClient.setQueryData(
          bookKeys.progress(bookId),
          context.previousProgress,
        );
      }
      console.error("Failed to save reading progress:", err);
    },
    onSettled: () => {
      // Always refetch after error or success to ensure we have the latest data
      queryClient.invalidateQueries({
        queryKey: bookKeys.progress(bookId),
      });
    },
  });

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
   * Restores scroll position from saved progress.
   */
  const restoreScrollPosition = useCallback(async () => {
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
  }, [chapterIndex, contentRef, initialProgress]);

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

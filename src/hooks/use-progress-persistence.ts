import { useProgressMutation } from "@/hooks/use-progress-mutation";
import { type ReadingProgress } from "@/lib/db";
import {
  calculateScrollPercentage,
  findVisibleScrollAnchor,
  type ScrollAnchor,
} from "@/lib/scroll-anchor";
import { useCallback, useEffect, useRef } from "react";

/** How often to auto-save progress (in milliseconds) */
const SAVE_INTERVAL_MS = 3000;

/** Threshold for considering scroll progress as "changed" */
const SCROLL_CHANGE_THRESHOLD = 0.01;

export interface UseProgressPersistenceOptions {
  /** The book ID for saving progress */
  bookId: string;
  /** Current chapter index */
  chapterIndex: number;
  /** Ref to the content container element */
  contentRef: React.RefObject<HTMLElement | null>;
  /** Whether content is ready (loaded) */
  contentReady: boolean;
  /** Whether to enable saving (false while scrolling/restoring) */
  enabled: boolean;
}

/**
 * Hook for auto-saving reading progress.
 *
 * Handles:
 * - Auto-saving progress every few seconds
 * - Saving on visibility change (tab switch) and before unload
 * - Optimistic updates for reading progress mutations
 *
 * This hook is decoupled from navigation/scroll restoration concerns.
 */
export function useProgressPersistence({
  bookId,
  chapterIndex,
  contentRef,
  contentReady,
  enabled,
}: UseProgressPersistenceOptions): void {
  // Use the extracted progress mutation hook
  const saveProgressMutation = useProgressMutation(bookId);
  const mutate = saveProgressMutation.mutate;

  // Track the last saved values to avoid unnecessary saves
  const lastSavedRef = useRef<{
    chapterIndex: number;
    scrollPercentage: number;
    scrollAnchor: ScrollAnchor | null;
  }>({
    chapterIndex: 0,
    scrollPercentage: 0,
    scrollAnchor: null,
  });

  /**
   * Saves the current reading progress to the database.
   */
  const saveProgress = useCallback(
    (force: boolean = false) => {
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

      console.log("chapter changed and saving scroll to ", scrollPercentage);

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
        lastRead: new Date().getTime(),
      };

      // Use mutation instead of direct save
      mutate(progress);
    },
    [bookId, chapterIndex, contentRef, mutate],
  );

  /**
   * Effect: Auto-save progress at regular intervals
   */
  useEffect(() => {
    if (!contentReady || !enabled) return;

    const intervalId = setInterval(() => {
      saveProgress();
    }, SAVE_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [contentReady, enabled, saveProgress]);

  /**
   * Save progress on chapter change
   */
  useEffect(() => {
    if (!contentReady || !enabled) return;
    saveProgress();
  }, [contentReady, enabled, saveProgress, chapterIndex]);

  /**
   * Effect: Save on visibility change (tab switch) and before unload
   */
  useEffect(() => {
    if (!contentReady || !enabled) return;

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
  }, [contentReady, enabled, saveProgress]);

  /**
   * Effect: Save progress on unmount
   */
  useEffect(() => {
    return () => {
      // Save on unmount - force save regardless of enabled state
      saveProgress(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

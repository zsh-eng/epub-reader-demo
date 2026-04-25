import { upsertCurrentDeviceReadingCheckpoint } from "@/lib/db";
import type { ResolvedSpread } from "@/lib/pagination-v2";
import { useEffect, useRef } from "react";
import {
  CHECKPOINT_FLUSH_INTERVAL_MS,
  createReaderCheckpointSnapshot,
  ReaderCheckpointSaveCoordinator,
  shouldFlushCheckpointImmediately,
  shouldTrackCheckpointIntent,
} from "./reader-checkpoint-controller";

interface UseReaderCheckpointControllerOptions {
  bookId?: string;
  spread: ResolvedSpread | null;
}

/**
 * Keeps the Reader checkpoint in sync with the currently resolved spread.
 *
 * Responsibilities:
 * - derive a persistable `(chapterIndex, scrollProgress)` snapshot from the
 *   leading visible page of the current spread
 * - ignore non-committal navigation like scrubber preview
 * - flush immediately for committed page turns and jumps
 * - flush periodically and on lifecycle exits for restore/relayout snapshots
 *
 * This hook only writes the per-device `readingCheckpoints` row. It does not
 * create legacy `readingProgress` history rows.
 */
export function useReaderCheckpointController({
  bookId,
  spread,
}: UseReaderCheckpointControllerOptions): void {
  const coordinatorRef = useRef<ReaderCheckpointSaveCoordinator | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = new ReaderCheckpointSaveCoordinator({
      persist: async (checkpoint) => {
        await upsertCurrentDeviceReadingCheckpoint({
          bookId: checkpoint.bookId,
          currentSpineIndex: checkpoint.currentSpineIndex,
          scrollProgress: checkpoint.scrollProgress,
          lastRead: Date.now(),
        });
      },
      onError: (error) => {
        console.error("Failed to save Reader checkpoint:", error);
      },
    });
  }

  const coordinator = coordinatorRef.current;

  useEffect(() => {
    coordinator.reset();
  }, [bookId, coordinator]);

  useEffect(() => {
    if (!bookId || !spread || !shouldTrackCheckpointIntent(spread.intent)) {
      return;
    }

    const checkpoint = createReaderCheckpointSnapshot(bookId, spread);
    coordinator.setSnapshot(checkpoint);

    if (shouldFlushCheckpointImmediately(spread.intent)) {
      coordinator.flushLatest();
    }
  }, [bookId, spread, coordinator]);

  useEffect(() => {
    if (!bookId) return;

    const intervalId = window.setInterval(() => {
      coordinator.flushLatest();
    }, CHECKPOINT_FLUSH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [bookId, coordinator]);

  useEffect(() => {
    if (!bookId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        coordinator.flushLatest({ force: true });
      }
    };

    const handlePageHide = () => {
      coordinator.flushLatest({ force: true });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      coordinator.flushLatest({ force: true });
    };
  }, [bookId, coordinator]);
}

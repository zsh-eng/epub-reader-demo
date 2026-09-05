import {
  createReadingCheckpointId,
  upsertCurrentDeviceReadingCheckpoint,
} from "@/lib/db";
import { getOrCreateDeviceId } from "@/lib/device";
import type { ResolvedSpread } from "@/lib/pagination-v2";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  readerCheckpointKeys,
  type ReaderCheckpointData,
} from "../data/reader-cache/hooks";
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
 * This hook writes one compacted checkpoint for this device and book.
 */
export function useReaderCheckpointController({
  bookId,
  spread,
}: UseReaderCheckpointControllerOptions): void {
  const queryClient = useQueryClient();
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
    if (!checkpoint) return;
    coordinator.setSnapshot(checkpoint);

    // Resume reads must see the committed spread even while its durable write
    // is queued. Cancel an older read before publishing; save completions must
    // never replace this value with an earlier snapshot.
    const queryKey = readerCheckpointKeys.currentDevice(bookId);
    const deviceId = getOrCreateDeviceId();
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<ReaderCheckpointData>(queryKey, {
      checkpoint: {
        id: createReadingCheckpointId(bookId, deviceId),
        bookId,
        deviceId,
        currentSpineIndex: checkpoint.currentSpineIndex,
        scrollProgress: checkpoint.scrollProgress,
        lastRead: Date.now(),
      },
    });

    if (shouldFlushCheckpointImmediately(spread.intent)) {
      coordinator.flushLatest();
    }
  }, [bookId, spread, coordinator, queryClient]);

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

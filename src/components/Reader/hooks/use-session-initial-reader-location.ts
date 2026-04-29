import type { SyncedReadingCheckpoint } from "@/lib/db";
import { useEffect, useState } from "react";
import {
  resolveInitialReaderLocation,
  type ReaderInitialLocation,
} from "../data/chapter-content-pipeline";

interface UseSessionInitialReaderLocationOptions {
  bookId?: string;
  totalChapters: number;
  checkpoint: SyncedReadingCheckpoint | undefined;
  checkpointReady: boolean;
}

interface CapturedInitialLocation {
  bookId: string;
  totalChapters: number;
  location: ReaderInitialLocation;
}

/**
 * Captures the checkpoint-derived restore location once per opened book.
 *
 * Checkpoint writes and sync invalidation can refetch the checkpoint query while
 * the reader is active. Those live updates are current reading state, not a new
 * startup restore point, so they must not restart pagination.
 */
export function useSessionInitialReaderLocation({
  bookId,
  totalChapters,
  checkpoint,
  checkpointReady,
}: UseSessionInitialReaderLocationOptions): ReaderInitialLocation | null {
  const [capturedLocation, setCapturedLocation] =
    useState<CapturedInitialLocation | null>(null);

  useEffect(() => {
    if (!bookId || totalChapters === 0) {
      setCapturedLocation(null);
      return;
    }

    setCapturedLocation((current) => {
      if (
        current?.bookId === bookId &&
        current.totalChapters === totalChapters
      ) {
        return current;
      }

      if (!checkpointReady) return null;

      return {
        bookId,
        totalChapters,
        location: resolveInitialReaderLocation(checkpoint, totalChapters),
      };
    });
  }, [bookId, checkpoint, checkpointReady, totalChapters]);

  if (
    !capturedLocation ||
    capturedLocation.bookId !== bookId ||
    capturedLocation.totalChapters !== totalChapters
  ) {
    return null;
  }

  return capturedLocation.location;
}

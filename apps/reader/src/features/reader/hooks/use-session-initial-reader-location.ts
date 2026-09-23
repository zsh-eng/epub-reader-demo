import type { ReadingCheckpoint } from "@/lib/db";
import { useRef } from "react";
import {
  resolveInitialReaderLocation,
  type ReaderInitialLocation,
} from "../data/chapter-content-pipeline";

interface UseSessionInitialReaderLocationOptions {
  bookId?: string;
  totalChapters: number;
  checkpoint: ReadingCheckpoint | undefined;
  checkpointReady: boolean;
  requestedLocation?: ReaderInitialLocation;
}

interface CapturedInitialLocation {
  bookId: string;
  totalChapters: number;
  location: ReaderInitialLocation;
}

/**
 * Captures the explicit opening target or checkpoint once per opened book.
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
  requestedLocation,
}: UseSessionInitialReaderLocationOptions): ReaderInitialLocation | null {
  const capturedLocationRef = useRef<CapturedInitialLocation | null>(null);
  const capturedLocation = capturedLocationRef.current;
  if (
    capturedLocation &&
    capturedLocation.bookId === bookId &&
    capturedLocation.totalChapters === totalChapters
  ) {
    return capturedLocation.location;
  }

  if (!bookId || totalChapters === 0 || !checkpointReady) return null;

  const nextCapturedLocation = {
    bookId,
    totalChapters,
    location:
      requestedLocation ??
      resolveInitialReaderLocation(checkpoint, totalChapters),
  };
  // This immutable per-book capture lets a warm checkpoint feed pagination in
  // the same render. Later checkpoint refetches cannot restart the Reader.
  capturedLocationRef.current = nextCapturedLocation;
  return nextCapturedLocation.location;
}

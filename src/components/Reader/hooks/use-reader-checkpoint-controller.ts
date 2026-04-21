import { upsertCurrentDeviceReadingCheckpoint } from "@/lib/db";
import type {
    ResolvedLeafPage,
    ResolvedSpread,
    SpreadIntent,
} from "@/lib/pagination-v2";
import { useCallback, useEffect, useRef } from "react";

const CHECKPOINT_FLUSH_INTERVAL_MS = 5000;

interface CheckpointSnapshot {
  currentSpineIndex: number;
  localPageIndex: number;
  totalPagesInChapter: number;
  scrollProgress: number;
}

type ResolvedPageSlot = Extract<
  ResolvedSpread["slots"][number],
  { kind: "page" }
>;

function getLeadingVisiblePage(
  spread: ResolvedSpread | null,
): ResolvedLeafPage | null {
  return (
    spread?.slots.find(
      (slot): slot is ResolvedPageSlot => slot.kind === "page",
    )?.page ?? null
  );
}

function toCheckpointScrollProgress(
  localPageIndex: number,
  totalPagesInChapter: number,
): number {
  if (totalPagesInChapter <= 1) return 0;
  return (localPageIndex / (totalPagesInChapter - 1)) * 100;
}

function createCheckpointSnapshot(
  spread: ResolvedSpread | null,
): CheckpointSnapshot | null {
  const leadingPage = getLeadingVisiblePage(spread);
  if (!leadingPage) return null;

  const localPageIndex = Math.max(0, leadingPage.currentPageInChapter - 1);
  const totalPagesInChapter = Math.max(1, leadingPage.totalPagesInChapter);

  return {
    currentSpineIndex: leadingPage.chapterIndex,
    localPageIndex,
    totalPagesInChapter,
    scrollProgress: toCheckpointScrollProgress(
      localPageIndex,
      totalPagesInChapter,
    ),
  };
}

function areCheckpointSnapshotsEqual(
  left: CheckpointSnapshot | null,
  right: CheckpointSnapshot | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.currentSpineIndex === right.currentSpineIndex &&
    left.localPageIndex === right.localPageIndex &&
    left.totalPagesInChapter === right.totalPagesInChapter
  );
}

function shouldSkipCheckpointTracking(intent: SpreadIntent): boolean {
  return intent.kind === "preview";
}

function shouldFlushCheckpointImmediately(intent: SpreadIntent): boolean {
  return intent.kind === "jump";
}

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
 * - flush immediately for committed jumps
 * - flush periodically and on lifecycle exits for ordinary reading
 *
 * This hook only writes the per-device `readingCheckpoints` row. It does not
 * create legacy `readingProgress` history rows.
 */
export function useReaderCheckpointController({
  bookId,
  spread,
}: UseReaderCheckpointControllerOptions): void {
  const latestCheckpointRef = useRef<CheckpointSnapshot | null>(null);
  const lastSavedCheckpointRef = useRef<CheckpointSnapshot | null>(null);
  // Serializes writes so we never have two overlapping checkpoint saves racing
  // each other. Each flush appends work onto the previous promise, which keeps
  // writes ordered and makes "latest save wins" behavior easier to reason about.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const flushCheckpoint = useCallback(
    (force: boolean = false) => {
      if (!bookId) return;

      const nextCheckpoint = latestCheckpointRef.current;
      if (!nextCheckpoint) return;
      if (
        !force &&
        areCheckpointSnapshotsEqual(nextCheckpoint, lastSavedCheckpointRef.current)
      ) {
        return;
      }

      const checkpointToPersist = { ...nextCheckpoint };

      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          // Persist the snapshot we captured when this flush started, even if a
          // newer spread arrives while the write is in flight. That newer spread
          // will enqueue its own flush after this one and overwrite the row.
          await upsertCurrentDeviceReadingCheckpoint({
            bookId,
            currentSpineIndex: checkpointToPersist.currentSpineIndex,
            scrollProgress: checkpointToPersist.scrollProgress,
            lastRead: Date.now(),
          });
          lastSavedCheckpointRef.current = checkpointToPersist;
        })
        .catch((error) => {
          console.error("Failed to save Reader checkpoint:", error);
        });
    },
    [bookId],
  );

  useEffect(() => {
    latestCheckpointRef.current = null;
    lastSavedCheckpointRef.current = null;
    saveChainRef.current = Promise.resolve();
  }, [bookId]);

  useEffect(() => {
    if (!bookId || !spread || shouldSkipCheckpointTracking(spread.intent)) {
      return;
    }

    const checkpoint = createCheckpointSnapshot(spread);
    if (!checkpoint) return;

    latestCheckpointRef.current = checkpoint;

    if (lastSavedCheckpointRef.current === null) {
      lastSavedCheckpointRef.current = checkpoint;
    }

    if (shouldFlushCheckpointImmediately(spread.intent)) {
      flushCheckpoint();
    }
  }, [bookId, spread, flushCheckpoint]);

  useEffect(() => {
    if (!bookId) return;

    const intervalId = window.setInterval(() => {
      flushCheckpoint();
    }, CHECKPOINT_FLUSH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [bookId, flushCheckpoint]);

  useEffect(() => {
    if (!bookId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushCheckpoint(true);
      }
    };

    const handlePageHide = () => {
      flushCheckpoint(true);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      flushCheckpoint(true);
    };
  }, [bookId, flushCheckpoint]);
}

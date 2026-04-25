import type {
  ResolvedLeafPage,
  ResolvedSpread,
  SpreadIntent,
} from "@/lib/pagination-v2";

export const CHECKPOINT_FLUSH_INTERVAL_MS = 5000;

export interface ReaderCheckpointSnapshot {
  bookId: string;
  currentSpineIndex: number;
  localPageIndex: number;
  totalPagesInChapter: number;
  scrollProgress: number;
}

export type PersistReaderCheckpoint = (
  snapshot: ReaderCheckpointSnapshot,
) => Promise<void>;

interface ReaderCheckpointSaveCoordinatorOptions {
  persist: PersistReaderCheckpoint;
  onError?: (error: unknown) => void;
}

type ResolvedPageSlot = Extract<
  ResolvedSpread["slots"][number],
  { kind: "page" }
>;

function getLeadingVisiblePage(
  spread: ResolvedSpread | null,
): ResolvedLeafPage | null {
  return (
    spread?.slots.find((slot): slot is ResolvedPageSlot => slot.kind === "page")
      ?.page ?? null
  );
}

function toCheckpointScrollProgress(
  localPageIndex: number,
  totalPagesInChapter: number,
): number {
  if (totalPagesInChapter <= 1) return 0;
  return (localPageIndex / (totalPagesInChapter - 1)) * 100;
}

export function createReaderCheckpointSnapshot(
  bookId: string | undefined,
  spread: ResolvedSpread | null,
): ReaderCheckpointSnapshot | null {
  if (!bookId) return null;

  const leadingPage = getLeadingVisiblePage(spread);
  if (!leadingPage) return null;

  const localPageIndex = Math.max(0, leadingPage.currentPageInChapter - 1);
  const totalPagesInChapter = Math.max(1, leadingPage.totalPagesInChapter);

  return {
    bookId,
    currentSpineIndex: leadingPage.chapterIndex,
    localPageIndex,
    totalPagesInChapter,
    scrollProgress: toCheckpointScrollProgress(
      localPageIndex,
      totalPagesInChapter,
    ),
  };
}

export function shouldTrackCheckpointIntent(intent: SpreadIntent): boolean {
  return intent.kind !== "preview";
}

export function shouldFlushCheckpointImmediately(
  intent: SpreadIntent,
): boolean {
  return intent.kind === "jump" || intent.kind === "linear";
}

export function getReaderCheckpointSnapshotKey(
  snapshot: ReaderCheckpointSnapshot,
): string {
  return JSON.stringify([
    snapshot.bookId,
    snapshot.currentSpineIndex,
    snapshot.localPageIndex,
    snapshot.totalPagesInChapter,
  ]);
}

/**
 * Coordinates checkpoint writes for the reader hook.
 *
 * The coordinator keeps React lifecycle concerns out of the persistence rules:
 * callers publish the latest checkpoint snapshot and ask for a flush when a
 * navigation/lifecycle event warrants one. Writes are coalesced while IndexedDB
 * work is in flight, so rapid page turns persist the newest pending snapshot
 * after the current save settles.
 */
export class ReaderCheckpointSaveCoordinator {
  private latestSnapshot: ReaderCheckpointSnapshot | null = null;
  private lastPersistedSnapshotKey: string | null = null;
  private isSaving = false;
  private needsFlushAfterCurrentSave = false;
  private generation = 0;
  private readonly persist: PersistReaderCheckpoint;
  private readonly onError: (error: unknown) => void;

  constructor(options: ReaderCheckpointSaveCoordinatorOptions) {
    this.persist = options.persist;
    this.onError = options.onError ?? (() => undefined);
  }

  reset(): void {
    this.generation += 1;
    this.latestSnapshot = null;
    this.lastPersistedSnapshotKey = null;
    this.needsFlushAfterCurrentSave = false;
  }

  setSnapshot(snapshot: ReaderCheckpointSnapshot | null): void {
    this.latestSnapshot = snapshot;
  }

  flushLatest(options: { force?: boolean } = {}): void {
    const snapshot = this.latestSnapshot;
    if (!snapshot) return;

    const snapshotKey = getReaderCheckpointSnapshotKey(snapshot);
    if (!options.force && snapshotKey === this.lastPersistedSnapshotKey) {
      return;
    }

    if (this.isSaving) {
      this.needsFlushAfterCurrentSave = true;
      return;
    }

    void this.saveSnapshot(snapshot);
  }

  private async saveSnapshot(snapshot: ReaderCheckpointSnapshot): Promise<void> {
    const generationAtStart = this.generation;
    const snapshotKey = getReaderCheckpointSnapshotKey(snapshot);

    this.isSaving = true;

    try {
      await this.persist(snapshot);
      if (this.generation === generationAtStart) {
        this.lastPersistedSnapshotKey = snapshotKey;
      }
    } catch (error) {
      if (this.generation === generationAtStart) {
        this.onError(error);
      }
    } finally {
      this.isSaving = false;

      if (this.needsFlushAfterCurrentSave) {
        this.needsFlushAfterCurrentSave = false;
        this.flushLatest();
      }
    }
  }
}

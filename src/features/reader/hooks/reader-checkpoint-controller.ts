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

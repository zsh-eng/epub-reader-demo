import {
  READER_V2_READING_SESSION_SOURCE,
  READING_SESSION_IDLE_TIMEOUT_MS,
} from "@/lib/db";
import type { ReadingSessionSource } from "@/lib/db";
import type {
  ResolvedLeafPage,
  ResolvedSpread,
  SpreadIntent,
} from "@/lib/pagination-v2";

export const READING_SESSION_FLUSH_INTERVAL_MS = 5000;
export { READING_SESSION_IDLE_TIMEOUT_MS };

export interface ReaderReadingSessionPosition {
  bookId: string;
  currentSpineIndex: number;
  scrollProgress: number;
}

export interface ReaderReadingSessionSnapshot {
  id: string;
  bookId: string;
  readerInstanceId: string;
  source: ReadingSessionSource;
  startedAt: number;
  endedAt: number | null;
  lastActiveAt: number;
  activeMs: number;
  startSpineIndex: number;
  startScrollProgress: number;
  endSpineIndex: number;
  endScrollProgress: number;
}

export type PersistReaderReadingSession = (
  snapshot: ReaderReadingSessionSnapshot,
) => Promise<void>;

interface ReaderReadingSessionControllerOptions {
  persist: PersistReaderReadingSession;
  idleTimeoutMs?: number;
  readerInstanceId?: string;
  createId?: () => string;
  onError?: (error: unknown) => void;
}

interface MutableReadingSession extends ReaderReadingSessionSnapshot {
  isVisible: boolean;
  accountedThroughAt: number;
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

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function toChapterScrollProgress(
  localPageIndex: number,
  totalPagesInChapter: number,
): number {
  if (totalPagesInChapter <= 1) return 0;
  return clampPercentage((localPageIndex / (totalPagesInChapter - 1)) * 100);
}

export function createReaderReadingSessionPosition(
  bookId: string | undefined,
  spread: ResolvedSpread | null,
): ReaderReadingSessionPosition | null {
  if (!bookId) return null;

  const leadingPage = getLeadingVisiblePage(spread);
  if (!leadingPage) return null;

  const localPageIndex = Math.max(0, leadingPage.currentPageInChapter - 1);
  const totalPagesInChapter = Math.max(1, leadingPage.totalPagesInChapter);

  return {
    bookId,
    currentSpineIndex: leadingPage.chapterIndex,
    scrollProgress: toChapterScrollProgress(
      localPageIndex,
      totalPagesInChapter,
    ),
  };
}

export function shouldTrackReadingSessionIntent(intent: SpreadIntent): boolean {
  return intent.kind !== "preview";
}

export function shouldRecordReadingSessionActivity(
  intent: SpreadIntent,
): boolean {
  return intent.kind === "linear" || intent.kind === "jump";
}

export function getReaderReadingSessionSnapshotKey(
  snapshot: ReaderReadingSessionSnapshot,
): string {
  return JSON.stringify([
    snapshot.id,
    snapshot.bookId,
    snapshot.readerInstanceId,
    snapshot.source,
    snapshot.startedAt,
    snapshot.endedAt,
    snapshot.lastActiveAt,
    snapshot.activeMs,
    snapshot.startSpineIndex,
    snapshot.startScrollProgress,
    snapshot.endSpineIndex,
    snapshot.endScrollProgress,
  ]);
}

/**
 * Tracks one mounted reader's reading session and accumulated active time.
 *
 * Time is counted at activity/lifecycle boundaries. If the gap since the last
 * accounted boundary exceeds `idleTimeoutMs`, the whole gap is discarded rather
 * than capped, because it most likely represents the reader being left open.
 */
export class ReaderReadingSessionController {
  private session: MutableReadingSession | null = null;
  private lastEnqueuedSnapshotKey: string | null = null;
  private lastPersistedSnapshotKey: string | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private readonly persist: PersistReaderReadingSession;
  private readonly idleTimeoutMs: number;
  private readonly readerInstanceId: string;
  private readonly createId: () => string;
  private readonly onError: (error: unknown) => void;

  constructor(options: ReaderReadingSessionControllerOptions) {
    this.persist = options.persist;
    this.idleTimeoutMs =
      options.idleTimeoutMs ?? READING_SESSION_IDLE_TIMEOUT_MS;
    this.readerInstanceId = options.readerInstanceId ?? crypto.randomUUID();
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.onError = options.onError ?? (() => undefined);
  }

  getCurrentSnapshot(): ReaderReadingSessionSnapshot | null {
    return this.session ? this.toSnapshot(this.session) : null;
  }

  setPosition(
    position: ReaderReadingSessionPosition,
    options: { now: number; recordActivity?: boolean },
  ): void {
    if (!this.session) {
      this.startSession(position, options.now);
    } else if (this.session.bookId !== position.bookId) {
      this.endSession(options.now);
      this.startSession(position, options.now);
    }

    if (!this.session) return;

    this.session.endSpineIndex = position.currentSpineIndex;
    this.session.endScrollProgress = position.scrollProgress;

    if (options.recordActivity) {
      this.recordActivity(options.now);
    }
  }

  recordActivity(now: number): void {
    if (!this.session || !this.session.isVisible) return;

    this.accountVisibleGap(now, { isActivity: true });
  }

  setVisible(isVisible: boolean, now: number): void {
    if (!this.session || this.session.isVisible === isVisible) return;

    if (!isVisible) {
      this.accountVisibleGap(now, { isActivity: false });
      this.session.isVisible = false;
      return;
    }

    this.session.isVisible = true;
    this.session.accountedThroughAt = now;
  }

  flushLatest(options: { force?: boolean } = {}): void {
    if (!this.session) return;
    this.enqueuePersist(this.toSnapshot(this.session), options);
  }

  endSession(now: number): void {
    if (!this.session) return;

    if (this.session.isVisible) {
      this.accountVisibleGap(now, { isActivity: false });
    }

    this.session.endedAt = now;
    const endedSnapshot = this.toSnapshot(this.session);

    this.enqueuePersist(endedSnapshot, { force: true });
    this.session = null;
    this.lastEnqueuedSnapshotKey = null;
    this.lastPersistedSnapshotKey = null;
  }

  private startSession(
    position: ReaderReadingSessionPosition,
    now: number,
  ): void {
    this.session = {
      id: this.createId(),
      bookId: position.bookId,
      readerInstanceId: this.readerInstanceId,
      source: READER_V2_READING_SESSION_SOURCE,
      startedAt: now,
      endedAt: null,
      lastActiveAt: now,
      activeMs: 0,
      startSpineIndex: position.currentSpineIndex,
      startScrollProgress: position.scrollProgress,
      endSpineIndex: position.currentSpineIndex,
      endScrollProgress: position.scrollProgress,
      isVisible: true,
      accountedThroughAt: now,
    };
  }

  private accountVisibleGap(
    now: number,
    options: { isActivity: boolean },
  ): void {
    if (!this.session) return;

    const gap = now - this.session.accountedThroughAt;
    if (gap < 0) {
      this.session.accountedThroughAt = now;
      return;
    }

    if (gap <= this.idleTimeoutMs) {
      this.session.activeMs += gap;
      this.session.lastActiveAt = now;
      this.session.accountedThroughAt = now;
      return;
    }

    if (options.isActivity) {
      this.session.lastActiveAt = now;
      this.session.accountedThroughAt = now;
    }
  }

  private enqueuePersist(
    snapshot: ReaderReadingSessionSnapshot,
    options: { force?: boolean } = {},
  ): void {
    const snapshotKey = getReaderReadingSessionSnapshotKey(snapshot);
    if (
      !options.force &&
      (snapshotKey === this.lastEnqueuedSnapshotKey ||
        snapshotKey === this.lastPersistedSnapshotKey)
    ) {
      return;
    }

    this.lastEnqueuedSnapshotKey = snapshotKey;
    this.saveChain = this.saveChain
      .catch(() => undefined)
      .then(async () => {
        await this.persist(snapshot);
        this.lastPersistedSnapshotKey = snapshotKey;
      })
      .catch((error) => {
        this.onError(error);
      });
  }

  private toSnapshot(
    session: MutableReadingSession,
  ): ReaderReadingSessionSnapshot {
    return {
      id: session.id,
      bookId: session.bookId,
      readerInstanceId: session.readerInstanceId,
      source: session.source,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      lastActiveAt: session.lastActiveAt,
      activeMs: session.activeMs,
      startSpineIndex: session.startSpineIndex,
      startScrollProgress: session.startScrollProgress,
      endSpineIndex: session.endSpineIndex,
      endScrollProgress: session.endScrollProgress,
    };
  }
}

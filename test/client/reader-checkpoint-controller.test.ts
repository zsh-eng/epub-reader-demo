import { cleanup, renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECKPOINT_FLUSH_INTERVAL_MS,
  createReaderCheckpointSnapshot,
  ReaderCheckpointSaveCoordinator,
  type ReaderCheckpointSnapshot,
} from "@/components/Reader/hooks/reader-checkpoint-controller";
import { useReaderCheckpointController } from "@/components/Reader/hooks/use-reader-checkpoint-controller";
import { upsertCurrentDeviceReadingCheckpoint } from "@/lib/db";
import type { ResolvedSpread, SpreadIntent } from "@/lib/pagination-v2";

vi.mock("@/lib/db", () => ({
  upsertCurrentDeviceReadingCheckpoint: vi.fn(() =>
    Promise.resolve("checkpoint-id"),
  ),
}));

const mockedUpsert = vi.mocked(upsertCurrentDeviceReadingCheckpoint);

function makeSnapshot(
  overrides: Partial<ReaderCheckpointSnapshot> = {},
): ReaderCheckpointSnapshot {
  return {
    bookId: "book-1",
    currentSpineIndex: 1,
    localPageIndex: 0,
    totalPagesInChapter: 10,
    scrollProgress: 0,
    ...overrides,
  };
}

function makeSpread(options: {
  intent: SpreadIntent;
  chapterIndex?: number;
  currentPageInChapter?: number;
  totalPagesInChapter?: number;
}): ResolvedSpread {
  const chapterIndex = options.chapterIndex ?? 2;
  const currentPageInChapter = options.currentPageInChapter ?? 1;
  const totalPagesInChapter = options.totalPagesInChapter ?? 5;

  return {
    slots: [
      {
        kind: "page",
        slotIndex: 0,
        page: {
          currentPage: currentPageInChapter,
          totalPages: 100,
          currentPageInChapter,
          totalPagesInChapter,
          chapterIndex,
          content: [],
        },
      },
    ],
    intent: options.intent,
    currentPage: currentPageInChapter,
    totalPages: 100,
    currentSpread: currentPageInChapter,
    totalSpreads: 100,
    chapterIndexStart: chapterIndex,
    chapterIndexEnd: chapterIndex,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await flushPromises();
  });
}

function setVisibilityState(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

describe("reader checkpoint snapshot derivation", () => {
  it("derives a chapter-local percentage from the leading visible page", () => {
    const spread = makeSpread({
      intent: { kind: "linear", direction: "forward" },
      chapterIndex: 4,
      currentPageInChapter: 3,
      totalPagesInChapter: 5,
    });

    expect(createReaderCheckpointSnapshot("book-1", spread)).toEqual({
      bookId: "book-1",
      currentSpineIndex: 4,
      localPageIndex: 2,
      totalPagesInChapter: 5,
      scrollProgress: 50,
    });
  });

  it("returns null without a book id or visible page", () => {
    const spread = makeSpread({
      intent: { kind: "linear", direction: "forward" },
    });

    expect(createReaderCheckpointSnapshot(undefined, spread)).toBeNull();
    expect(
      createReaderCheckpointSnapshot("book-1", { ...spread, slots: [] }),
    ).toBeNull();
  });
});

describe("ReaderCheckpointSaveCoordinator", () => {
  it("does not persist duplicate snapshots after a successful save", async () => {
    const persist = vi.fn(() => Promise.resolve());
    const coordinator = new ReaderCheckpointSaveCoordinator({ persist });

    coordinator.setSnapshot(makeSnapshot());
    coordinator.flushLatest();
    await flushPromises();

    coordinator.setSnapshot(makeSnapshot());
    coordinator.flushLatest();
    await flushPromises();

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("coalesces in-flight writes to the newest requested snapshot", async () => {
    let resolveFirstSave: (() => void) | undefined;
    let callCount = 0;
    const persist = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<void>((resolve) => {
          resolveFirstSave = resolve;
        });
      }
      return Promise.resolve();
    });
    const coordinator = new ReaderCheckpointSaveCoordinator({ persist });

    coordinator.setSnapshot(makeSnapshot({ currentSpineIndex: 1 }));
    coordinator.flushLatest();
    coordinator.setSnapshot(makeSnapshot({ currentSpineIndex: 2 }));
    coordinator.flushLatest();

    expect(persist).toHaveBeenCalledTimes(1);

    resolveFirstSave?.();
    await flushPromises();

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1]?.[0]).toMatchObject({
      currentSpineIndex: 2,
    });
  });

  it("saves the reset generation after the previous in-flight save settles", async () => {
    let resolveFirstSave: (() => void) | undefined;
    let callCount = 0;
    const persist = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<void>((resolve) => {
          resolveFirstSave = resolve;
        });
      }
      return Promise.resolve();
    });
    const coordinator = new ReaderCheckpointSaveCoordinator({ persist });

    coordinator.setSnapshot(makeSnapshot({ bookId: "old-book" }));
    coordinator.flushLatest();
    coordinator.reset();
    coordinator.setSnapshot(makeSnapshot({ bookId: "new-book" }));
    coordinator.flushLatest();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0]?.[0]).toMatchObject({ bookId: "old-book" });

    resolveFirstSave?.();
    await flushPromises();

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1]?.[0]).toMatchObject({ bookId: "new-book" });
  });
});

describe("useReaderCheckpointController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00.000Z"));
    mockedUpsert.mockReset();
    mockedUpsert.mockResolvedValue("checkpoint-id");
    setVisibilityState("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ignores scrubber preview spreads", async () => {
    renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        spread: makeSpread({ intent: { kind: "preview", source: "scrubber" } }),
      }),
    );

    await flushReactWork();

    act(() => {
      vi.advanceTimersByTime(CHECKPOINT_FLUSH_INTERVAL_MS);
    });

    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it("persists committed linear navigation immediately without duplicating the same page", async () => {
    const { rerender } = renderHook(
      ({ spread }) =>
        useReaderCheckpointController({
          bookId: "book-1",
          spread,
        }),
      {
        initialProps: {
          spread: makeSpread({
            intent: { kind: "linear", direction: "forward" },
            chapterIndex: 3,
            currentPageInChapter: 3,
            totalPagesInChapter: 5,
          }),
        },
      },
    );

    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
    expect(mockedUpsert).toHaveBeenLastCalledWith({
      bookId: "book-1",
      currentSpineIndex: 3,
      scrollProgress: 50,
      lastRead: Date.now(),
    });

    rerender({
      spread: makeSpread({
        intent: { kind: "linear", direction: "forward" },
        chapterIndex: 3,
        currentPageInChapter: 3,
        totalPagesInChapter: 5,
      }),
    });
    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
  });

  it("persists committed jump navigation immediately", async () => {
    renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        spread: makeSpread({
          intent: { kind: "jump", source: "chapter" },
          chapterIndex: 4,
        }),
      }),
    );

    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
    expect(mockedUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bookId: "book-1",
        currentSpineIndex: 4,
      }),
    );
  });

  it("flushes restore snapshots on the periodic interval", async () => {
    renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        spread: makeSpread({ intent: { kind: "restore" } }),
      }),
    );

    await flushReactWork();
    expect(mockedUpsert).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(CHECKPOINT_FLUSH_INTERVAL_MS - 1);
    });
    expect(mockedUpsert).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
  });

  it("flushes the latest snapshot when the document becomes hidden", async () => {
    renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        spread: makeSpread({ intent: { kind: "restore" } }),
      }),
    );

    await flushReactWork();
    expect(mockedUpsert).not.toHaveBeenCalled();

    act(() => {
      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
  });

  it("flushes the latest snapshot on pagehide", async () => {
    renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        spread: makeSpread({ intent: { kind: "restore" } }),
      }),
    );

    await flushReactWork();
    expect(mockedUpsert).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
  });

  it("flushes the latest snapshot on unmount", async () => {
    const { unmount } = renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        spread: makeSpread({ intent: { kind: "restore" } }),
      }),
    );

    await flushReactWork();
    expect(mockedUpsert).not.toHaveBeenCalled();

    unmount();
    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
  });
});

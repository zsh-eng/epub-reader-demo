import {
    createReaderReadingSessionPosition,
    ReaderReadingSessionController,
    READING_SESSION_FLUSH_INTERVAL_MS,
    type ReaderReadingSessionPosition,
} from "@/components/Reader/hooks/reading-sessions/reader-reading-session-controller";
import { useReaderReadingSession } from "@/components/Reader/hooks/reading-sessions/use-reader-reading-session";
import { updateCurrentDeviceReadingSession } from "@/lib/db";
import type { ResolvedSpread, SpreadIntent } from "@/lib/pagination-v2";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

vi.mock("@/lib/db", () => ({
  updateCurrentDeviceReadingSession: vi.fn(() =>
    Promise.resolve("session-id"),
  ),
}));

const mockedUpdateSession = vi.mocked(updateCurrentDeviceReadingSession);

function makePosition(
  overrides: Partial<ReaderReadingSessionPosition> = {},
): ReaderReadingSessionPosition {
  return {
    bookId: "book-1",
    currentSpineIndex: 1,
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

describe("reader reading session position derivation", () => {
  it("derives a chapter-local percentage from the leading visible page", () => {
    const spread = makeSpread({
      intent: { kind: "linear", direction: "forward" },
      chapterIndex: 4,
      currentPageInChapter: 3,
      totalPagesInChapter: 5,
    });

    expect(createReaderReadingSessionPosition("book-1", spread)).toEqual({
      bookId: "book-1",
      currentSpineIndex: 4,
      scrollProgress: 50,
    });
  });

  it("returns null without a book id or visible page", () => {
    const spread = makeSpread({
      intent: { kind: "linear", direction: "forward" },
    });

    expect(createReaderReadingSessionPosition(undefined, spread)).toBeNull();
    expect(
      createReaderReadingSessionPosition("book-1", { ...spread, slots: [] }),
    ).toBeNull();
  });
});

describe("ReaderReadingSessionController", () => {
  it("counts short visible activity gaps", () => {
    const controller = new ReaderReadingSessionController({
      persist: vi.fn(() => Promise.resolve()),
      readerInstanceId: "reader-1",
      createId: () => "session-1",
      idleTimeoutMs: 10 * 60 * 1000,
    });

    controller.setPosition(makePosition(), { now: 0 });
    controller.recordActivity(60_000);

    expect(controller.getCurrentSnapshot()).toMatchObject({
      id: "session-1",
      readerInstanceId: "reader-1",
      activeMs: 60_000,
      lastActiveAt: 60_000,
    });
  });

  it("discards the whole gap when activity resumes after the idle timeout", () => {
    const controller = new ReaderReadingSessionController({
      persist: vi.fn(() => Promise.resolve()),
      createId: () => "session-1",
      idleTimeoutMs: 10 * 60 * 1000,
    });

    controller.setPosition(makePosition(), { now: 0 });
    controller.recordActivity(10 * 60 * 1000 + 1);

    expect(controller.getCurrentSnapshot()).toMatchObject({
      activeMs: 0,
      lastActiveAt: 10 * 60 * 1000 + 1,
    });
  });

  it("pauses accumulation while hidden", () => {
    const controller = new ReaderReadingSessionController({
      persist: vi.fn(() => Promise.resolve()),
      createId: () => "session-1",
      idleTimeoutMs: 10 * 60 * 1000,
    });

    controller.setPosition(makePosition(), { now: 0 });
    controller.setVisible(false, 120_000);
    controller.recordActivity(180_000);
    controller.setVisible(true, 240_000);
    controller.recordActivity(300_000);

    expect(controller.getCurrentSnapshot()).toMatchObject({
      activeMs: 180_000,
      lastActiveAt: 300_000,
    });
  });

  it("ends with lastActiveAt as the practical end when the final idle gap is too large", async () => {
    const persist = vi.fn(() => Promise.resolve());
    const controller = new ReaderReadingSessionController({
      persist,
      createId: () => "session-1",
      idleTimeoutMs: 10 * 60 * 1000,
    });

    controller.setPosition(makePosition(), { now: 0 });
    controller.endSession(10 * 60 * 1000 + 1);
    await flushPromises();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endedAt: 10 * 60 * 1000 + 1,
        lastActiveAt: 0,
        activeMs: 0,
      }),
    );
  });

  it("keeps concurrent reader instances as separate sessions", () => {
    const persist = vi.fn(() => Promise.resolve());
    const first = new ReaderReadingSessionController({
      persist,
      readerInstanceId: "reader-1",
      createId: () => "session-1",
    });
    const second = new ReaderReadingSessionController({
      persist,
      readerInstanceId: "reader-2",
      createId: () => "session-2",
    });

    first.setPosition(makePosition(), { now: 0 });
    second.setPosition(makePosition(), { now: 0 });

    expect(first.getCurrentSnapshot()).toMatchObject({
      id: "session-1",
      readerInstanceId: "reader-1",
    });
    expect(second.getCurrentSnapshot()).toMatchObject({
      id: "session-2",
      readerInstanceId: "reader-2",
    });
  });

  it("persists the same mutable session row on repeated flushes", async () => {
    const persist = vi.fn(() => Promise.resolve());
    const controller = new ReaderReadingSessionController({
      persist,
      createId: () => "session-1",
    });

    controller.setPosition(makePosition(), { now: 0 });
    controller.flushLatest();
    await flushPromises();

    controller.setPosition(makePosition({ currentSpineIndex: 2 }), {
      now: 60_000,
      recordActivity: true,
    });
    controller.flushLatest();
    await flushPromises();

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls.map((call) => call[0].id)).toEqual([
      "session-1",
      "session-1",
    ]);
    expect(persist.mock.calls[1]?.[0]).toMatchObject({
      activeMs: 60_000,
      endSpineIndex: 2,
    });
  });
});

describe("useReaderReadingSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00.000Z"));
    mockedUpdateSession.mockReset();
    mockedUpdateSession.mockResolvedValue("session-id");
    setVisibilityState("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ignores scrubber preview spreads", async () => {
    renderHook(() =>
      useReaderReadingSession({
        bookId: "book-1",
        spread: makeSpread({ intent: { kind: "preview", source: "scrubber" } }),
      }),
    );

    await flushReactWork();

    act(() => {
      vi.advanceTimersByTime(READING_SESSION_FLUSH_INTERVAL_MS);
    });
    await flushReactWork();

    expect(mockedUpdateSession).not.toHaveBeenCalled();
  });

  it("creates and periodically flushes a reading session for a real spread", async () => {
    renderHook(() =>
      useReaderReadingSession({
        bookId: "book-1",
        spread: makeSpread({
          intent: { kind: "restore" },
          chapterIndex: 3,
          currentPageInChapter: 3,
          totalPagesInChapter: 5,
        }),
      }),
    );

    await flushReactWork();

    expect(mockedUpdateSession).toHaveBeenCalledTimes(1);
    expect(mockedUpdateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bookId: "book-1",
        startedAt: Date.now(),
        endedAt: null,
        startSpineIndex: 3,
        startScrollProgress: 50,
        endSpineIndex: 3,
        endScrollProgress: 50,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(READING_SESSION_FLUSH_INTERVAL_MS);
    });
    await flushReactWork();

    expect(mockedUpdateSession).toHaveBeenCalledTimes(1);
  });

  it("records browser interaction activity and flushes it on the timer", async () => {
    renderHook(() =>
      useReaderReadingSession({
        bookId: "book-1",
        spread: makeSpread({ intent: { kind: "restore" } }),
      }),
    );

    await flushReactWork();

    act(() => {
      vi.advanceTimersByTime(60_000);
      window.dispatchEvent(new Event("wheel"));
      vi.advanceTimersByTime(READING_SESSION_FLUSH_INTERVAL_MS);
    });
    await flushReactWork();

    expect(mockedUpdateSession).toHaveBeenCalledTimes(2);
    expect(mockedUpdateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeMs: 60_000,
        lastActiveAt: Date.now() - READING_SESSION_FLUSH_INTERVAL_MS,
      }),
    );
  });

  it("flushes best-effort on visibility hidden and ends on unmount", async () => {
    const { unmount } = renderHook(() =>
      useReaderReadingSession({
        bookId: "book-1",
        spread: makeSpread({ intent: { kind: "restore" } }),
      }),
    );

    await flushReactWork();

    act(() => {
      vi.advanceTimersByTime(60_000);
      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushReactWork();

    expect(mockedUpdateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endedAt: null,
        activeMs: 60_000,
      }),
    );

    unmount();
    await flushReactWork();

    expect(mockedUpdateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endedAt: Date.now(),
      }),
    );
  });
});

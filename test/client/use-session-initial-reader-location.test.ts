import { useSessionInitialReaderLocation } from "@/features/reader/hooks/use-session-initial-reader-location";
import type { ReadingCheckpoint } from "@/lib/db";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

function checkpoint(
  currentSpineIndex: number,
  scrollProgress: number,
): ReadingCheckpoint {
  return {
    id: "resume:device-1:book-1",
    bookId: "book-1",
    deviceId: "device-1",
    currentSpineIndex,
    scrollProgress,
    lastRead: 1,
  };
}

afterEach(cleanup);

describe("useSessionInitialReaderLocation", () => {
  it("returns a warm checkpoint during the first ready render", () => {
    const { result } = renderHook(() =>
      useSessionInitialReaderLocation({
        bookId: "book-1",
        totalChapters: 10,
        checkpoint: checkpoint(4, 35),
        checkpointReady: true,
      }),
    );

    expect(result.current).toEqual({
      chapterIndex: 4,
      chapterProgress: 35,
      isRestore: true,
    });
  });

  it("keeps the opening location stable after checkpoint updates", () => {
    const { result, rerender } = renderHook(
      ({ currentSpineIndex }) =>
        useSessionInitialReaderLocation({
          bookId: "book-1",
          totalChapters: 10,
          checkpoint: checkpoint(currentSpineIndex, 35),
          checkpointReady: true,
        }),
      { initialProps: { currentSpineIndex: 4 } },
    );

    rerender({ currentSpineIndex: 8 });
    expect(result.current?.chapterIndex).toBe(4);
  });
});

it("captures an explicit target after preparation and keeps it after consumption", () => {
  const target = {
    chapterIndex: 7,
    highlightId: "highlight-1",
    isRestore: false,
  };
  const { result, rerender } = renderHook(
    ({ ready, requestedLocation }) =>
      useSessionInitialReaderLocation({
        bookId: ready ? "book-1" : undefined,
        totalChapters: ready ? 10 : 0,
        checkpoint: checkpoint(2, 40),
        checkpointReady: ready,
        requestedLocation,
      }),
    {
      initialProps: {
        ready: false,
        requestedLocation: target as typeof target | undefined,
      },
    },
  );
  expect(result.current).toBeNull();
  rerender({ ready: true, requestedLocation: target });
  expect(result.current).toEqual(target);
  rerender({ ready: true, requestedLocation: undefined });
  expect(result.current).toEqual(target);
});

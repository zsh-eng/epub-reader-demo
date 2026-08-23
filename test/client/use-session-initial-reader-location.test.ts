import { useSessionInitialReaderLocation } from "@/components/Reader/hooks/use-session-initial-reader-location";
import type { SyncedReadingCheckpoint } from "@/lib/db";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

function checkpoint(
  currentSpineIndex: number,
  scrollProgress: number,
): SyncedReadingCheckpoint {
  return {
    id: "resume:device-1:book-1",
    bookId: "book-1",
    deviceId: "device-1",
    currentSpineIndex,
    scrollProgress,
    lastRead: 1,
    _hlc: "1-0-device-1",
    _deviceId: "device-1",
    _isDeleted: 0,
    _serverTimestamp: 1,
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

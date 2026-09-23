import { isCompletePaginationReadyEvent } from "@/lib/pagination-v2/use-pagination";
import type { PaginationEvent } from "@/lib/pagination-v2/protocol";
import { describe, expect, it } from "vitest";

function readyEvent(chapterCount: number): Extract<
  PaginationEvent,
  { type: "ready" }
> {
  return {
    type: "ready",
    epoch: 1,
    intent: { kind: "replace" },
    spread: {
      intent: { kind: "replace" },
      slots: [],
      currentPage: 1,
      totalPages: 1,
      currentSpread: 1,
      totalSpreads: 1,
      chapterIndexStart: 0,
      chapterIndexEnd: 0,
    },
    chapterDiagnostics: Array.from({ length: chapterCount }, (_, index) => ({
      chapterIndex: index,
      blockCount: 0,
      preparedBlockCount: 0,
      pageCount: 1,
      prepareMs: 0,
      stage2PrepareMs: 0,
      layoutMs: 0,
      totalMs: 0,
    })),
  };
}

describe("pagination ready classification", () => {
  it("does not treat a config-relayout ready event as all chapters loaded", () => {
    expect(isCompletePaginationReadyEvent(readyEvent(1), 130)).toBe(false);
  });

  it("accepts ready after every expected chapter has diagnostics", () => {
    expect(isCompletePaginationReadyEvent(readyEvent(130), 130)).toBe(true);
  });
});

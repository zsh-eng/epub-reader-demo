import { buildReaderChapterLoadOrder } from "@/components/Reader/data/chapter-content-pipeline";
import { describe, expect, it } from "vitest";

describe("reader chapter content pipeline", () => {
  it("loads chapters middle-out from the initial chapter", () => {
    expect(buildReaderChapterLoadOrder(6, 3)).toEqual([3, 4, 2, 5, 1, 0]);
  });

  it("clamps the initial chapter before building the load order", () => {
    expect(buildReaderChapterLoadOrder(3, 99)).toEqual([2, 1, 0]);
    expect(buildReaderChapterLoadOrder(3, -99)).toEqual([0, 1, 2]);
  });
});

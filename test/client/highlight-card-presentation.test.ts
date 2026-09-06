import {
  getHighlightCardPresentation,
  getHighlightWordCount,
  usesWordCloudHighlightStyle,
} from "@/features/highlights/highlight-card-presentation";
import { describe, expect, it } from "vitest";

describe("highlight card presentation", () => {
  it("counts words after normalizing whitespace", () => {
    expect(getHighlightWordCount("  two\n words  ")).toBe(2);
  });

  it("uses the word-cloud treatment only for one to three words", () => {
    expect(usesWordCloudHighlightStyle("Stillness")).toBe(true);
    expect(usesWordCloudHighlightStyle("a clear signal")).toBe(true);
    expect(usesWordCloudHighlightStyle("this is one word too many")).toBe(
      false,
    );
    expect(usesWordCloudHighlightStyle("   ")).toBe(false);
  });

  it("centers short quotes only when they fit on one rendered line", () => {
    expect(getHighlightCardPresentation("a very short quotation", 1)).toBe(
      "compact-quote",
    );
    expect(getHighlightCardPresentation("a very short quotation", 2)).toBe(
      "quote",
    );
    expect(getHighlightCardPresentation("one small phrase", 1)).toBe(
      "word-cloud",
    );
  });
});

import { parseChapterHtml } from "@/lib/pagination-v2/shared/parse-html";
import type { Highlight } from "@/types/highlight";
import {
  EPUB_HIGHLIGHT_END_ATTRIBUTE,
  EPUB_HIGHLIGHT_START_ATTRIBUTE,
} from "@/types/reader.types";
import {
  applyHighlightsToChapterHtml,
  buildHighlightSignature,
  buildHighlightsBySpineItemId,
} from "@/components/ReaderV2/highlight-virtualization";
import { describe, expect, it } from "vitest";

function makeHighlight(
  id: string,
  spineItemId: string,
  startOffset: number,
  endOffset: number,
  selectedText: string,
  color: Highlight["color"],
): Highlight {
  return {
    id,
    bookId: "book-1",
    spineItemId,
    startOffset,
    endOffset,
    selectedText,
    textBefore: "",
    textAfter: "",
    color,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("ReaderV2 highlight virtualization", () => {
  it("applies virtual marks with id, color, and boundary attributes", () => {
    const html = "<p>Hello world</p>";
    const highlights: Highlight[] = [
      makeHighlight("h1", "spine-1", 0, 5, "Hello", "yellow"),
    ];

    const highlightedHtml = applyHighlightsToChapterHtml(html, highlights);

    expect(highlightedHtml).toContain('data-highlight-id="h1"');
    expect(highlightedHtml).toContain('data-color="yellow"');
    expect(highlightedHtml).toContain(`${EPUB_HIGHLIGHT_START_ATTRIBUTE}="true"`);
    expect(highlightedHtml).toContain(`${EPUB_HIGHLIGHT_END_ATTRIBUTE}="true"`);
  });

  it("preserves overlapping mark stacks through parse", () => {
    const html = "<p>abcdefghij</p>";
    const highlights: Highlight[] = [
      makeHighlight("h1", "spine-1", 0, 6, "abcdef", "yellow"),
      makeHighlight("h2", "spine-1", 3, 9, "defghi", "blue"),
    ];

    const highlightedHtml = applyHighlightsToChapterHtml(html, highlights);
    const blocks = parseChapterHtml(highlightedHtml);

    const textBlock = blocks.find(
      (block): block is Extract<(typeof blocks)[number], { type: "text" }> =>
        block.type === "text",
    );

    expect(textBlock).toBeDefined();

    const runStacks =
      textBlock?.runs.map(
        (run) => run.highlightMarks?.map((m) => m.id) ?? [],
      ) ?? [];

    expect(runStacks.some((stack) => stack.includes("h1"))).toBe(true);
    expect(runStacks.some((stack) => stack.includes("h2"))).toBe(true);
    expect(runStacks.some((stack) => stack.length >= 2)).toBe(true);
  });

  it("groups by spine item and produces stable signatures", () => {
    const hA = makeHighlight("a", "spine-1", 8, 12, "text", "green");
    const hB = makeHighlight("b", "spine-1", 2, 4, "xt", "blue");
    const hC = makeHighlight("c", "spine-2", 1, 3, "ab", "magenta");

    const grouped = buildHighlightsBySpineItemId([hA, hB, hC]);

    expect(grouped.get("spine-1")?.map((h) => h.id)).toEqual(["b", "a"]);
    expect(grouped.get("spine-2")?.map((h) => h.id)).toEqual(["c"]);

    const sig1 = buildHighlightSignature([hA, hB, hC]);
    const sig2 = buildHighlightSignature([hC, hB, hA]);
    expect(sig1).toBe(sig2);
  });
});

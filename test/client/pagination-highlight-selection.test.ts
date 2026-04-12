import {
    parseChapterHtml,
    prepareBlocks,
    resolveContentAnchorRangeToHighlight,
    type ContentAnchor,
    type FontConfig,
    type PreparedBlock,
} from "@/lib/pagination-v2";
import { describe, expect, it } from "vitest";

const BASE_FONT_CONFIG: FontConfig = {
  bodyFamily: '"Inter", sans-serif',
  headingFamily: '"Inter", sans-serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

function buildChapter(html: string): {
  blocks: ReturnType<typeof parseChapterHtml>;
  prepared: PreparedBlock[];
} {
  const blocks = parseChapterHtml(html);
  const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
  return { blocks, prepared };
}

function createTextAnchor(
  chapterIndex: number,
  blockId: string,
  itemIndex: number,
  segmentIndex: number,
  graphemeIndex: number,
): ContentAnchor {
  return {
    type: "text",
    chapterIndex,
    blockId,
    offset: {
      itemIndex,
      segmentIndex,
      graphemeIndex,
    },
  };
}

describe("resolveContentAnchorRangeToHighlight", () => {
  it("computes persisted offsets and context inside a single block", () => {
    const { blocks, prepared } = buildChapter("<p>alpha beta gamma</p>");
    const blockId = blocks[0]?.id;
    expect(blockId).toBeDefined();
    if (!blockId) return;

    const result = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, blockId, 0, 2, 0),
      endAnchor: createTextAnchor(0, blockId, 0, 2, 4),
      chapterBlocks: blocks,
      preparedChapter: prepared,
    });

    expect(result).toEqual({
      chapterIndex: 0,
      startOffset: 6,
      endOffset: 10,
      selectedText: "beta",
      textBefore: "alpha ",
      textAfter: " gamma",
    });
  });

  it("maps collapsed whitespace back to the raw chapter offsets", () => {
    const { blocks, prepared } = buildChapter("<p>alpha   beta gamma</p>");
    const blockId = blocks[0]?.id;
    expect(blockId).toBeDefined();
    if (!blockId) return;

    const result = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, blockId, 0, 2, 0),
      endAnchor: createTextAnchor(0, blockId, 0, 2, 4),
      chapterBlocks: blocks,
      preparedChapter: prepared,
    });

    expect(result).toEqual({
      chapterIndex: 0,
      startOffset: 8,
      endOffset: 12,
      selectedText: "beta",
      textBefore: "alpha   ",
      textAfter: " gamma",
    });
  });

  it("spans multiple text blocks within the same chapter", () => {
    const { blocks, prepared } = buildChapter(
      "<p>alpha beta</p><p>gamma delta</p>",
    );
    const firstBlockId = blocks[0]?.id;
    const secondBlockId = blocks[1]?.id;
    expect(firstBlockId).toBeDefined();
    expect(secondBlockId).toBeDefined();
    if (!firstBlockId || !secondBlockId) return;

    const result = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, firstBlockId, 0, 2, 0),
      endAnchor: createTextAnchor(0, secondBlockId, 0, 0, 5),
      chapterBlocks: blocks,
      preparedChapter: prepared,
    });

    expect(result).toEqual({
      chapterIndex: 0,
      startOffset: 6,
      endOffset: 15,
      selectedText: "betagamma",
      textBefore: "alpha ",
      textAfter: " delta",
    });
  });

  it("does not count hard-break-only runs in persisted offsets", () => {
    const { blocks, prepared } = buildChapter("<p>alpha<br>beta</p>");
    const blockId = blocks[0]?.id;
    expect(blockId).toBeDefined();
    if (!blockId) return;

    const result = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, blockId, 2, 0, 0),
      endAnchor: createTextAnchor(0, blockId, 2, 0, 4),
      chapterBlocks: blocks,
      preparedChapter: prepared,
    });

    expect(result).toEqual({
      chapterIndex: 0,
      startOffset: 5,
      endOffset: 9,
      selectedText: "beta",
      textBefore: "alpha",
      textAfter: "",
    });
  });

  it("rejects anchor pairs from different chapters", () => {
    const { blocks, prepared } = buildChapter("<p>alpha beta gamma</p>");
    const blockId = blocks[0]?.id;
    expect(blockId).toBeDefined();
    if (!blockId) return;

    const result = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, blockId, 0, 2, 0),
      endAnchor: createTextAnchor(1, blockId, 0, 2, 4),
      chapterBlocks: blocks,
      preparedChapter: prepared,
    });

    expect(result).toBeNull();
  });
});

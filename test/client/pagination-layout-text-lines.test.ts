import {
  layoutPreWrapLines,
  layoutTextLines,
  prepareBlocks,
} from "@/lib/pagination-v2";
import type { Block, FontConfig, TextCursorOffset } from "@/lib/pagination-v2";
import { describe, expect, it } from "vitest";

const BASE_FONT_CONFIG: FontConfig = {
  bodyFamily: '"Inter", sans-serif',
  headingFamily: '"Inter", sans-serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

function compareOffsets(a: TextCursorOffset, b: TextCursorOffset): number {
  if (a.itemIndex !== b.itemIndex) {
    return a.itemIndex < b.itemIndex ? -1 : 1;
  }
  if (a.segmentIndex !== b.segmentIndex) {
    return a.segmentIndex < b.segmentIndex ? -1 : 1;
  }
  if (a.graphemeIndex !== b.graphemeIndex) {
    return a.graphemeIndex < b.graphemeIndex ? -1 : 1;
  }
  return 0;
}

describe("layoutPreWrapLines cursor offsets", () => {
  it("produces populated and monotonic line offsets", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "pre-block",
        tag: "pre",
        runs: [
          {
            text: [
              "const alpha = 1;",
              "const beta = alpha + 2;",
              "const gamma = beta * 3;",
              "console.log(gamma);",
            ].join("\n"),
            bold: false,
            italic: false,
            isCode: true,
            isLink: false,
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    const lines = layoutPreWrapLines(textBlock.items, 180);
    expect(lines.length).toBeGreaterThan(1);

    for (const line of lines) {
      expect(line.startOffset).toBeDefined();
      expect(line.endOffset).toBeDefined();
      if (!line.startOffset || !line.endOffset) continue;

      expect(line.startOffset.itemIndex).toBe(0);
      expect(line.endOffset.itemIndex).toBe(0);
      expect(compareOffsets(line.startOffset, line.endOffset)).toBeLessThan(0);
    }

    for (let index = 1; index < lines.length; index++) {
      const previous = lines[index - 1];
      const current = lines[index];
      if (!previous?.endOffset || !current?.startOffset) continue;

      expect(
        compareOffsets(previous.endOffset, current.startOffset),
      ).toBeLessThanOrEqual(0);
    }
  });

  it("preserves highlight mark metadata on wrapped text fragments", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "highlighted-block",
        tag: "p",
        runs: [
          {
            text: "alpha ",
            bold: false,
            italic: false,
            isCode: false,
            isLink: false,
          },
          {
            text: "beta gamma delta epsilon zeta eta theta",
            bold: false,
            italic: false,
            isCode: false,
            isLink: false,
            highlightMarks: [{ id: "h1", color: "yellow" }],
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    const lines = layoutTextLines(textBlock.items, 170);
    expect(lines.length).toBeGreaterThan(1);

    const markedFragments = lines
      .flatMap((line) => line.fragments)
      .filter((fragment) =>
        fragment.highlightMarks?.some((mark) => mark.id === "h1"),
      );

    expect(markedFragments.length).toBeGreaterThan(0);
    expect(
      markedFragments.every(
        (fragment) => fragment.highlightMarks?.[0]?.color === "yellow",
      ),
    ).toBe(true);
  });
});

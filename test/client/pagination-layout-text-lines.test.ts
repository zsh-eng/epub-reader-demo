import type { Block, FontConfig, TextCursorOffset } from "@/lib/pagination-v2";
import {
  layoutPreWrapLines,
  layoutTextLines,
  prepareBlocks,
} from "@/lib/pagination-v2";
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
            kind: "text",
            text: [
              "const alpha = 1;",
              "const beta = alpha + 2;",
              "const gamma = beta * 3;",
              "console.log(gamma);",
            ].join("\n"),
            bold: false,
            italic: false,
            isCode: true,
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
            kind: "text",
            text: "alpha ",
            bold: false,
            italic: false,
            isCode: false,
          },
          {
            kind: "text",
            text: "beta gamma delta epsilon zeta eta theta",
            bold: false,
            italic: false,
            isCode: false,
            highlightMarks: [
              { id: "h1", color: "yellow", isStart: true, isEnd: true },
            ],
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    const { lines } = layoutTextLines(textBlock.items, 170);
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
    expect(markedFragments[0]?.highlightMarks?.[0]?.isStart).toBe(true);
    expect(markedFragments[0]?.highlightMarks?.[0]?.isEnd).not.toBe(true);
    expect(
      markedFragments
        .slice(1, -1)
        .every(
          (fragment) =>
            fragment.highlightMarks?.[0]?.isStart !== true &&
            fragment.highlightMarks?.[0]?.isEnd !== true,
        ),
    ).toBe(true);
    expect(
      markedFragments[markedFragments.length - 1]?.highlightMarks?.[0]?.isEnd,
    ).toBe(true);
  });

  it("carries link metadata through preparation and rendered fragments", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "linked-block",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "alpha beta gamma delta epsilon",
            bold: false,
            italic: false,
            isCode: false,
            link: { href: "OEBPS/Text/Chapter2.xhtml#target" },
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    const { lines } = layoutTextLines(textBlock.items, 170);
    const linkedFragments = lines
      .flatMap((line) => line.fragments)
      .filter((fragment) => fragment.link?.href);

    expect(linkedFragments.length).toBeGreaterThan(0);
    expect(
      linkedFragments.every(
        (fragment) =>
          fragment.link?.href === "OEBPS/Text/Chapter2.xhtml#target",
      ),
    ).toBe(true);
  });

  it("reserves extra width for note-ref hit areas while keeping plain superscripts lightweight", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "sup-block",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "12",
            bold: false,
            italic: false,
            isCode: false,
            inlineRole: "note-ref",
            link: { href: "#note-12" },
          },
          {
            kind: "text",
            text: "2",
            bold: false,
            italic: false,
            isCode: false,
            inlineRole: "superscript",
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    expect(textBlock.items).toHaveLength(2);
    expect(textBlock.items[0]?.inlineRole).toBe("note-ref");
    expect(textBlock.items[0]?.chromeWidth).toBeGreaterThan(0);
    expect(textBlock.items[1]?.inlineRole).toBe("superscript");
    expect(textBlock.items[1]?.chromeWidth).toBe(0);
    expect(textBlock.items[0]?.font).toContain("12px");
    expect(textBlock.items[1]?.font).toContain("12px");

    const { lines } = layoutTextLines(textBlock.items, 240);
    const fragments = lines.flatMap((line) => line.fragments);
    expect(
      fragments.find((fragment) => fragment.text === "12")?.inlineRole,
    ).toBe("note-ref");
    expect(
      fragments.find((fragment) => fragment.text === "2")?.inlineRole,
    ).toBe("superscript");
  });

  it("preserves item boundaries for run-owned targets in pre-wrap layout", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "pre-targets",
        tag: "pre",
        runs: [
          {
            kind: "text",
            text: "const alpha = 1;\n",
            bold: false,
            italic: false,
            isCode: true,
          },
          {
            kind: "text",
            text: "const beta = alpha + 2;\nconst gamma = beta * 3;",
            bold: false,
            italic: false,
            isCode: true,
            targetIds: ["mid-pre"],
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    expect(textBlock.items.map((item) => item.kind)).toEqual(["text", "text"]);
    expect(textBlock.items[1]?.targetIds).toEqual(["mid-pre"]);

    const lines = layoutPreWrapLines(textBlock.items, 180);
    expect(lines.length).toBeGreaterThan(1);

    const fragmentText = lines
      .flatMap((line) => line.fragments)
      .map((fragment) => fragment.text)
      .join("");
    expect(fragmentText).toContain("const beta = alpha + 2;");
    expect(fragmentText).not.toContain("mid-pre");

    const laterOffsets = lines
      .map((line) => line.startOffset?.itemIndex ?? -1)
      .filter((itemIndex) => itemIndex >= 0);
    expect(laterOffsets.some((itemIndex) => itemIndex >= 1)).toBe(true);
  });
});

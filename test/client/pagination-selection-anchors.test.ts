import { PageSliceView } from "@/components/Reader/PageSliceView";
import { resolveDomEndpointToContentAnchor } from "@/lib/pagination-v2/engine/selection-anchors";
import {
  layoutTextLines,
  prepareBlocks,
  type Block,
  type PaginationConfig,
  type PreparedBlock,
  type ResolvedSpread,
  type TextSlice,
} from "@/lib/pagination-v2";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

const BASE_PAGINATION_CONFIG: PaginationConfig = {
  fontConfig: {
    bodyFamily: '"Inter", sans-serif',
    headingFamily: '"Inter", sans-serif',
    codeFamily: '"Courier New", monospace',
    baseSizePx: 16,
  },
  layoutTheme: {
    baseFontSizePx: 16,
    lineHeightFactor: 1.5,
    paragraphSpacingFactor: 1.2,
    headingSpaceAbove: 1.5,
    headingSpaceBelow: 0.7,
    textAlign: "left",
  },
  viewport: { width: 620, height: 860 },
};

function renderSlice(slice: TextSlice): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(
    createElement(PageSliceView, {
      slice,
      sliceIndex: 0,
      bookId: "book-1",
      deferredImageCache: new Map(),
      baseFontSize: BASE_PAGINATION_CONFIG.fontConfig.baseSizePx,
    }),
  );

  const paragraph = document.body.querySelector("p");
  if (!(paragraph instanceof HTMLElement)) {
    throw new Error("Expected rendered paragraph element");
  }
  return paragraph;
}

function createSpread(slice: TextSlice, chapterIndex: number): ResolvedSpread {
  return {
    slots: [
      {
        kind: "page",
        slotIndex: 0,
        page: {
          currentPage: 1,
          totalPages: 1,
          currentPageInChapter: 1,
          totalPagesInChapter: 1,
          chapterIndex,
          content: [slice],
        },
      },
    ],
    intent: { kind: "replace" },
    currentPage: 1,
    totalPages: 1,
    currentSpread: 1,
    totalSpreads: 1,
    chapterIndexStart: chapterIndex,
    chapterIndexEnd: chapterIndex,
  };
}

function buildPreparedChapter(blocks: Block[]): PreparedBlock[] {
  return prepareBlocks(blocks, BASE_PAGINATION_CONFIG.fontConfig);
}

function buildSingleSlice(
  blocks: Block[],
  width = 1000,
): {
  slice: TextSlice;
  preparedByChapter: PreparedBlock[][];
} {
  const prepared = buildPreparedChapter(blocks);
  const textBlock = prepared[0];
  expect(textBlock?.type).toBe("text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Expected first prepared block to be text");
  }

  const { lines } = layoutTextLines(textBlock.items, width);
  return {
    slice: {
      type: "text",
      blockId: textBlock.id,
      tag: textBlock.tag,
      lineHeight: 24,
      textAlign: "left",
      renderMode: "native",
      lines,
    },
    preparedByChapter: [prepared],
  };
}

describe("resolveDomEndpointToContentAnchor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves a text-node endpoint inside a multi-segment fragment", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "intro",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "alpha beta gamma",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
    ];

    const { slice, preparedByChapter } = buildSingleSlice(blocks);
    const paragraph = renderSlice(slice);
    const textNode = paragraph.querySelector("span")?.firstChild;
    expect(textNode?.nodeType).toBe(Node.TEXT_NODE);
    if (!textNode) return;

    const anchor = resolveDomEndpointToContentAnchor({
      node: textNode,
      offset: "alpha ".length,
      spread: createSpread(slice, 0),
      preparedByChapter,
    });

    expect(anchor).toEqual({
      type: "text",
      chapterIndex: 0,
      blockId: "intro",
      offset: {
        itemIndex: 0,
        segmentIndex: 2,
        graphemeIndex: 0,
      },
    });
  });

  it("resolves endpoints from nested highlight markup back to the fragment anchor", () => {
    const slice: TextSlice = {
      type: "text",
      blockId: "highlighted-block",
      tag: "p",
      lineHeight: 24,
      textAlign: "left",
      renderMode: "native",
      lines: [
        {
          fragments: [
            {
              kind: "text",
              text: "world",
              font: '400 16px "Inter", sans-serif',
              leadingGap: 0,
              isCode: false,
              highlightMarks: [{ id: "h1", color: "yellow" }],
              anchorStart: {
                itemIndex: 0,
                segmentIndex: 0,
                graphemeIndex: 0,
              },
              anchorEnd: {
                itemIndex: 0,
                segmentIndex: 1,
                graphemeIndex: 0,
              },
            },
          ],
          isLastInBlock: true,
        },
      ],
    };
    const preparedByChapter = [
      buildPreparedChapter([
        {
          type: "text",
          id: "highlighted-block",
          tag: "p",
          runs: [
            {
              kind: "text",
              text: "world",
              bold: false,
              italic: false,
              isCode: false,
            },
          ],
        },
      ]),
    ];

    const paragraph = renderSlice(slice);
    const textNode = paragraph.querySelector("mark")?.firstChild;
    expect(textNode?.nodeType).toBe(Node.TEXT_NODE);
    if (!textNode) return;

    const anchor = resolveDomEndpointToContentAnchor({
      node: textNode,
      offset: 3,
      spread: createSpread(slice, 0),
      preparedByChapter,
    });

    expect(anchor).toEqual({
      type: "text",
      chapterIndex: 0,
      blockId: "highlighted-block",
      offset: {
        itemIndex: 0,
        segmentIndex: 0,
        graphemeIndex: 3,
      },
    });
  });

  it("resolves element-boundary endpoints to the shared fragment boundary", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "boundary-block",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "alpha beta gamma delta epsilon zeta",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
    ];

    const { slice, preparedByChapter } = buildSingleSlice(blocks, 120);
    const paragraph = renderSlice(slice);
    expect(paragraph.childNodes.length).toBeGreaterThan(1);

    const anchor = resolveDomEndpointToContentAnchor({
      node: paragraph,
      offset: 1,
      spread: createSpread(slice, 0),
      preparedByChapter,
    });

    const firstFragment = slice.lines[0]?.fragments[0];
    expect(firstFragment?.anchorEnd).toBeDefined();
    expect(anchor).toEqual({
      type: "text",
      chapterIndex: 0,
      blockId: "boundary-block",
      offset: firstFragment?.anchorEnd,
    });
  });
});

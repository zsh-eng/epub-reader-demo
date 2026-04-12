import {
  CONTENT_ANCHOR_BLOCK_ID_ATTR,
  CONTENT_ANCHOR_END_ATTR,
  CONTENT_ANCHOR_START_ATTR,
} from "@/lib/pagination-v2/content-anchor-dom";
import { PageSliceView } from "@/components/ReaderV2/PageSliceView";
import type { TextSlice } from "@/lib/pagination-v2";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("PageSliceView", () => {
  it("renders linked text fragments as anchors with hrefs", () => {
    const slice: TextSlice = {
      type: "text",
      blockId: "linked-block",
      tag: "p",
      lineHeight: 24,
      textAlign: "left",
      renderMode: "native",
      lines: [
        {
          fragments: [
            {
              kind: "text",
              text: "Jump",
              font: '400 16px "Inter", sans-serif',
              leadingGap: 0,
              link: { href: "OEBPS/Text/Chapter2.xhtml#note-1" },
              isCode: false,
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

    const markup = renderToStaticMarkup(
      createElement(PageSliceView, {
        slice,
        sliceIndex: 0,
        bookId: "book-1",
        deferredImageCache: new Map(),
        baseFontSize: 16,
      }),
    );

    expect(markup).toContain('href="OEBPS/Text/Chapter2.xhtml#note-1"');
    expect(markup).toContain("reader-v2-inline-link");
    expect(markup).toContain(`${CONTENT_ANCHOR_BLOCK_ID_ATTR}="linked-block"`);
    expect(markup).toContain(`${CONTENT_ANCHOR_START_ATTR}="0:0:0"`);
    expect(markup).toContain(`${CONTENT_ANCHOR_END_ATTR}="0:1:0"`);
    expect(markup).toContain(">Jump<");
  });

  it("keeps fragment anchor metadata when text is wrapped in highlight marks", () => {
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
                itemIndex: 2,
                segmentIndex: 3,
                graphemeIndex: 0,
              },
              anchorEnd: {
                itemIndex: 2,
                segmentIndex: 4,
                graphemeIndex: 0,
              },
            },
          ],
          isLastInBlock: true,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(PageSliceView, {
        slice,
        sliceIndex: 0,
        bookId: "book-1",
        deferredImageCache: new Map(),
        baseFontSize: 16,
      }),
    );

    expect(markup).toContain(`${CONTENT_ANCHOR_BLOCK_ID_ATTR}="highlighted-block"`);
    expect(markup).toContain(`${CONTENT_ANCHOR_START_ATTR}="2:3:0"`);
    expect(markup).toContain(`${CONTENT_ANCHOR_END_ATTR}="2:4:0"`);
    expect(markup).toContain('data-highlight-id="h1"');
    expect(markup).toContain('data-color="yellow"');
  });
});

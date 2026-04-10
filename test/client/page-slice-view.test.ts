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
    expect(markup).toContain(">Jump<");
  });
});

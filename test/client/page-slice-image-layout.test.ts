import { PageSliceView } from "@/components/ReaderV2/PageSliceView";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("PageSliceView image layout", () => {
  it("renders image slices using the slice height instead of filling the page", () => {
    const markup = renderToStaticMarkup(
      createElement(PageSliceView, {
        slice: {
          type: "image",
          blockId: "chapter-badge",
          src: "badge.jpg",
          alt: "Chapter badge",
          width: 180,
          height: 120,
        },
        sliceIndex: 0,
        bookId: "book-1",
        deferredImageCache: new Map(),
        baseFontSize: 16,
      }),
    );

    expect(markup).toContain('style="height:120px"');
    expect(markup).toContain('style="width:180px;height:120px');
  });
});

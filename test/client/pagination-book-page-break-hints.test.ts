import {
  layoutPages,
  parseChapterHtml,
  prepareBlocks,
  type Block,
  type FontConfig,
  type InlineRun,
  type LayoutTheme,
  type BookStylesheet,
} from "@/lib/pagination-v2";
import { describe, expect, it } from "vitest";

const FONT_CONFIG: FontConfig = {
  bodyFamily: '"Inter", sans-serif',
  headingFamily: '"Inter", sans-serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

const LAYOUT_THEME: LayoutTheme = {
  baseFontSizePx: 16,
  lineHeightFactor: 1.5,
  paragraphSpacingFactor: 0.8,
  textAlign: "left",
};

function textRun(text: string, hardBreak = false): InlineRun {
  return {
    kind: "text",
    text,
    ...(hardBreak ? { hardBreak: true } : {}),
    bold: false,
    italic: false,
    isCode: false,
  };
}

function textBlock(
  id: string,
  text: string,
  pageBreakHints?: Extract<Block, { type: "text" }>["pageBreakHints"],
): Block {
  return {
    type: "text",
    id,
    tag: "p",
    ...(pageBreakHints ? { pageBreakHints } : {}),
    runs: [textRun(text)],
  };
}

function findTextPage(
  pages: ReturnType<typeof layoutPages>["pages"],
  id: string,
) {
  return pages.findIndex((page) =>
    page.slices.some((slice) => slice.type === "text" && slice.blockId === id),
  );
}

describe("Book Page Break Hints", () => {
  it("honors hard break-before CSS even when Publisher Book Styling is off", () => {
    const stylesheets: BookStylesheet[] = [
      {
        basePath: "OEBPS/pgepub.css",
        cssText: "h2 { page-break-before: always; break-before: always; }",
      },
    ];
    const blocks = parseChapterHtml(
      "<p>Intro.</p><h2>Chapter One</h2><p>Body.</p>",
      { bookStylesheets: stylesheets },
    );

    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const { pages } = layoutPages(prepared, 320, 480, LAYOUT_THEME);

    expect(findTextPage(pages, "text-1")).toBe(0);
    expect(findTextPage(pages, "text-2")).toBe(1);
  });

  it("honors hard break-after CSS without adding a trailing blank page", () => {
    const stylesheets: BookStylesheet[] = [
      {
        basePath: "OEBPS/book.css",
        cssText: ".chapter { break-after: page; page-break-after: always; }",
      },
    ];
    const blocks = parseChapterHtml(
      '<p class="chapter">Chapter opener.</p><p>Next page.</p>',
      { bookStylesheets: stylesheets },
    );

    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const { pages } = layoutPages(prepared, 320, 480, LAYOUT_THEME);

    expect(pages).toHaveLength(2);
    expect(findTextPage(pages, "text-1")).toBe(0);
    expect(findTextPage(pages, "text-2")).toBe(1);
  });

  it("treats break-after avoid as keep-with-next when the pair fits", () => {
    const blocks: Block[] = [
      textBlock("intro-1", "Intro one."),
      textBlock("intro-2", "Intro two."),
      textBlock("heading", "Heading", { breakAfter: "avoid" }),
      textBlock("body", "First body line."),
    ];

    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const { pages } = layoutPages(prepared, 320, 120, LAYOUT_THEME);

    expect(findTextPage(pages, "intro-1")).toBe(0);
    expect(findTextPage(pages, "intro-2")).toBe(0);
    expect(findTextPage(pages, "heading")).toBe(1);
    expect(findTextPage(pages, "body")).toBe(1);
  });

  it("keeps break-inside avoid text blocks together when the block fits a page", () => {
    const blocks: Block[] = [
      textBlock("intro-1", "Intro one."),
      textBlock("intro-2", "Intro two."),
      {
        type: "text",
        id: "keep",
        tag: "p",
        pageBreakHints: { breakInside: "avoid" },
        runs: [textRun("Line one.\nLine two.", true)],
      },
    ];

    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const { pages } = layoutPages(prepared, 320, 120, LAYOUT_THEME);

    expect(findTextPage(pages, "intro-1")).toBe(0);
    expect(findTextPage(pages, "intro-2")).toBe(0);
    expect(findTextPage(pages, "keep")).toBe(1);
    expect(
      pages[0]?.slices.some(
        (slice) => slice.type === "text" && slice.blockId === "keep",
      ),
    ).toBe(false);
  });

  it("propagates inline and wrapper page-break hints to materialized blocks", () => {
    const blocks = parseChapterHtml(
      `
        <div style="page-break-inside: avoid">
          <p>Inline wrapper hint.</p>
        </div>
        <figure class="img">
          <img src="figure.png" alt="Figure" />
          <figcaption>Caption is intentionally not grouped yet.</figcaption>
        </figure>
      `,
      {
        bookStylesheets: [
          {
            basePath: "OEBPS/book.css",
            cssText: ".img { break-inside: avoid; page-break-inside: avoid; }",
          },
        ],
      },
    );

    expect(blocks[0]).toMatchObject({
      type: "text",
      pageBreakHints: { breakInside: "avoid" },
    });
    expect(blocks[1]).toMatchObject({
      type: "image",
      pageBreakHints: { breakInside: "avoid" },
    });
    expect(blocks[2]).toMatchObject({
      type: "text",
      tag: "figcaption",
      pageBreakHints: { breakInside: "avoid" },
    });
  });
});

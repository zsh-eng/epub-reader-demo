import {
  layoutPages,
  parseChapterHtml,
  prepareBlocks,
  type FontConfig,
  type LayoutTheme,
  type PublisherStylesheet,
} from "@/lib/pagination-v2";
import { describe, expect, it } from "vitest";

const FONT_CONFIG: FontConfig = {
  bodyFamily: '"Lora", serif',
  headingFamily: '"Lora", serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

const LAYOUT_THEME: LayoutTheme = {
  baseFontSizePx: 16,
  lineHeightFactor: 1.5,
  paragraphSpacingFactor: 0.8,
  textAlign: "left",
};

const PUBLISHER_STYLESHEETS: PublisherStylesheet[] = [
  {
    basePath: "OEBPS/Styles/book.css",
    cssText: `
      p { margin: 0; text-align: left; }
      .h1 {
        font-family: "Oswald-Light";
        font-size: 2rem;
        font-weight: 300;
        line-height: 1.2em;
        text-align: center;
        margin: 1rem 0 0.5rem 0;
      }
      blockquote {
        margin: 0.7rem 0 0.7rem 1.4rem;
        font-family: "Open Sans";
        font-size: 0.9em;
        line-height: 1.3em;
      }
      .Indent { text-indent: 1.4rem; }
    `,
  },
];

describe("pagination publisher book styling", () => {
  it("is gated off by default even when publisher stylesheets are available", () => {
    const blocks = parseChapterHtml('<p class="h1">Chapter One</p>', {
      publisherStylesheets: PUBLISHER_STYLESHEETS,
    });

    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (!block || block.type !== "text") return;

    expect(block.publisherStyle).toBeUndefined();
  });

  it("preserves heading font family and layout cues when enabled", () => {
    const blocks = parseChapterHtml('<p class="h1">Chapter One</p>', {
      publisherBookStylingEnabled: true,
      publisherStylesheets: PUBLISHER_STYLESHEETS,
    });

    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (!block || block.type !== "text") return;

    expect(block.publisherStyle).toMatchObject({
      role: "heading",
      fontFamily: "Oswald-Light",
      fontScale: 2,
      fontWeight: 300,
      lineHeightFactor: 1.2,
      textAlign: "center",
      margin: {
        before: { em: 1 },
        after: { em: 0.5 },
      },
    });

    const prepared = prepareBlocks(blocks, FONT_CONFIG, {
      publisherBookStylingEnabled: true,
    });
    const preparedText = prepared[0];
    expect(preparedText?.type).toBe("text");
    if (!preparedText || preparedText.type !== "text") return;

    expect(preparedText.items[0]?.font).toContain("32px Oswald-Light");
  });

  it("resolves publisher percentage margins against the content width", () => {
    const blocks = parseChapterHtml(
      '<p>Intro.</p><p class="h1">Chapter One</p>',
      {
        publisherBookStylingEnabled: true,
        publisherStylesheets: [
          {
            basePath: "OEBPS/Styles/book.css",
            cssText: `
              p { margin: 0; }
              .h1 {
                font-family: "Oswald-Light";
                font-size: 1.5em;
                margin-top: 10%;
                margin-left: 5%;
                text-align: center;
              }
            `,
          },
        ],
      },
    );
    const heading = blocks[1];
    expect(heading?.type).toBe("text");
    if (!heading || heading.type !== "text") return;
    expect(heading.publisherStyle).toMatchObject({
      margin: {
        before: { percent: 0.1 },
        left: { percent: 0.05 },
      },
    });

    const prepared = prepareBlocks(blocks, FONT_CONFIG, {
      publisherBookStylingEnabled: true,
    });
    const { pages } = layoutPages(prepared, 400, 480, LAYOUT_THEME);
    const spacer = pages[0]?.slices.find((slice) => slice.type === "spacer");
    const headingSlice = pages[0]?.slices
      .filter((slice) => slice.type === "text")
      .at(1);

    expect(spacer?.type).toBe("spacer");
    if (spacer?.type !== "spacer") return;
    expect(spacer.height).toBe(40);

    expect(headingSlice?.type).toBe("text");
    if (headingSlice?.type !== "text") return;
    expect(headingSlice.marginLeftPx).toBe(20);
  });

  it("preserves publisher inline heading scale for display spans", () => {
    const blocks = parseChapterHtml(
      '<h1 class="h1fm">PROLOGUE <span class="heading_break">"INCOMPARABLE" ARROGANCE</span></h1>',
      {
        publisherBookStylingEnabled: true,
        publisherStylesheets: [
          {
            basePath: "OEBPS/Styles/book.css",
            cssText: `
              .h1fm {
                font-family: "Oswald-Light", sans-serif;
                font-size: 1.3em;
                font-weight: normal;
                text-align: center;
              }
              span.heading_break {
                font-family: "Oswald-Light", sans-serif;
                font-size: 1.5em;
                display: block;
                text-align: center;
              }
            `,
          },
        ],
      },
    );

    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (!block || block.type !== "text") return;

    expect(block.publisherStyle).toMatchObject({
      role: "heading",
      fontScale: 1.3,
      textAlign: "center",
    });
    expect(block.runs.map((run) => run.text)).toEqual([
      "PROLOGUE ",
      '\n"INCOMPARABLE" ARROGANCE',
    ]);
    expect(block.runs[1]?.publisherInlineStyle).toMatchObject({
      fontFamily: '"Oswald-Light", sans-serif',
      displayBlock: true,
    });
    expect(block.runs[1]?.publisherInlineStyle?.fontScale).toBeCloseTo(
      1.95,
      5,
    );

    const prepared = prepareBlocks(blocks, FONT_CONFIG, {
      publisherBookStylingEnabled: true,
    });
    const heading = prepared[0];
    expect(heading?.type).toBe("text");
    if (!heading || heading.type !== "text") return;

    expect(heading.containsNewlines).toBe(true);
    expect(
      heading.items.reduce(
        (maxFontScale, item) => Math.max(maxFontScale, item.fontScale),
        0,
      ),
    ).toBeCloseTo(1.95, 5);
    expect(heading.items[0]?.font).toContain("21px");
    expect(heading.items[0]?.font).toContain("Oswald-Light");
    expect(heading.items.at(-1)?.font).toContain("31px");
    expect(heading.items.at(-1)?.font).toContain("Oswald-Light");

    const { pages } = layoutPages(prepared, 360, 480, LAYOUT_THEME);
    const headingSlice = pages[0]?.slices.find(
      (slice) => slice.type === "text",
    );
    expect(headingSlice?.type).toBe("text");
    if (headingSlice?.type !== "text") return;
    expect(headingSlice.lines).toHaveLength(2);
  });

  it("keeps blockquote child paragraphs separate so publisher indents survive", () => {
    const blocks = parseChapterHtml(
      `
        <blockquote>
          <p class="Indent">Indented quoted paragraph.</p>
          <p>Second quoted paragraph.</p>
        </blockquote>
      `,
      {
        publisherBookStylingEnabled: true,
        publisherStylesheets: PUBLISHER_STYLESHEETS,
      },
    );

    expect(blocks).toHaveLength(2);
    const firstQuote = blocks[0];
    expect(firstQuote?.type).toBe("text");
    if (!firstQuote || firstQuote.type !== "text") return;

    expect(firstQuote.tag).toBe("p");
    expect(firstQuote.publisherStyle).toMatchObject({
      role: "blockquote",
      fontScale: 0.9,
      lineHeightFactor: 1.3,
      textIndent: { em: 1.4 },
      margin: {
        left: { em: 1.4 },
      },
    });

    const prepared = prepareBlocks(blocks, FONT_CONFIG, {
      publisherBookStylingEnabled: true,
    });
    const firstPreparedQuote = prepared[0];
    expect(firstPreparedQuote?.type).toBe("text");
    if (!firstPreparedQuote || firstPreparedQuote.type !== "text") return;
    expect(firstPreparedQuote.items[0]?.font).toContain('"Lora", serif');
    expect(firstPreparedQuote.items[0]?.font).not.toContain("Open Sans");

    const { pages } = layoutPages(prepared, 320, 480, LAYOUT_THEME);
    const firstTextSlice = pages[0]?.slices.find(
      (slice) => slice.type === "text",
    );

    expect(firstTextSlice?.type).toBe("text");
    if (firstTextSlice?.type !== "text") return;

    expect(firstTextSlice.marginLeftPx).toBeCloseTo(22.4, 5);
    expect(firstTextSlice.lines[0]?.indentPx).toBeCloseTo(22.4, 5);
    expect(firstTextSlice.lineHeight).toBe(19);
  });
});

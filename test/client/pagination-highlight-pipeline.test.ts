import {
  layoutPages,
  parseChapterHtml,
  prepareBlocks,
  type FontConfig,
  type LayoutTheme,
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
  paragraphSpacingFactor: 1.2,
  headingSpaceAbove: 1.5,
  headingSpaceBelow: 0.7,
  textAlign: "left",
};

describe("pagination highlight pipeline", () => {
  it("carries nested highlight metadata from parse to page fragments", () => {
    const html =
      '<p>Hello <mark data-highlight-id="h1" data-color="yellow">ab<mark data-highlight-id="h2" data-color="blue">cd</mark>ef</mark> world</p>';

    const blocks = parseChapterHtml(html);
    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const { pages } = layoutPages(prepared, 620, 120, LAYOUT_THEME);

    const fragments = pages
      .flatMap((page) => page.slices)
      .filter((slice) => slice.type === "text")
      .flatMap((slice) => slice.lines)
      .flatMap((line) => line.fragments);

    const singleMarked = fragments.find(
      (fragment) =>
        fragment.text.includes("ab") && fragment.highlightMarks?.length === 1,
    );
    expect(singleMarked?.highlightMarks).toEqual([
      { id: "h1", color: "yellow" },
    ]);

    const stacked = fragments.find(
      (fragment) =>
        fragment.text.includes("cd") && fragment.highlightMarks?.length === 2,
    );
    expect(stacked?.highlightMarks).toEqual([
      { id: "h1", color: "yellow" },
      { id: "h2", color: "blue" },
    ]);
  });
});

import { PaginationEngine } from "@/lib/pagination/pagination-engine";
import { parseChapterHtml } from "@/lib/pagination/parse-html";
import type { PaginationEvent } from "@/lib/pagination/engine-types";
import type { FontConfig, LayoutTheme, PageSlice } from "@/lib/pagination/types";
import { describe, expect, it } from "vitest";

const BASE_FONT_CONFIG: FontConfig = {
  bodyFamily: '"Inter", sans-serif',
  headingFamily: '"Inter", sans-serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

const BASE_LAYOUT_THEME: LayoutTheme = {
  baseFontSizePx: 16,
  lineHeightFactor: 1.5,
  paragraphSpacingFactor: 1.2,
  headingSpaceAbove: 1.5,
  headingSpaceBelow: 0.7,
  textAlign: "left",
};

function collectRenderedImageSlices(events: PaginationEvent[]): PageSlice[] {
  const slices: PageSlice[] = [];

  for (const event of events) {
    if (event.type === "partialReady" || event.type === "ready") {
      for (const slice of event.slices) {
        if (slice.type === "image") {
          slices.push(slice);
        }
      }
    }
  }

  return slices;
}

function renderSingleChapter(html: string): PageSlice[] {
  const events: PaginationEvent[] = [];
  const engine = new PaginationEngine((event) => events.push(event));

  engine.handleCommand({
    type: "init",
    totalChapters: 1,
    fontConfig: BASE_FONT_CONFIG,
    layoutTheme: BASE_LAYOUT_THEME,
    viewport: { width: 620, height: 860 },
    initialChapterIndex: 0,
  });

  engine.handleCommand({
    type: "addChapter",
    chapterIndex: 0,
    blocks: parseChapterHtml(html),
  });

  return collectRenderedImageSlices(events);
}

function hasImageSlice(slices: PageSlice[], src: string): boolean {
  return slices.some((slice) => slice.type === "image" && slice.src === src);
}

describe("Pagination cover image regressions", () => {
  it("renders image-only headings as page slices", () => {
    const slices = renderSingleChapter(`
      <h1 class="cubierta" title="Book One: The Way of Kings">
        <img alt="book1" src="../Images/book1.jpg" />
      </h1>
    `);

    expect(hasImageSlice(slices, "../Images/book1.jpg")).toBe(true);
  });

  it("renders svg image cover pages as page slices", () => {
    const slices = renderSingleChapter(`
      <div class="x-ebookmaker-cover">
        <svg xmlns="http://www.w3.org/2000/svg"
             xmlns:xlink="http://www.w3.org/1999/xlink"
             viewBox="0 0 1500 2114"
             width="100%"
             height="100%">
          <image width="1500"
                 height="2114"
                 xlink:href="1098001722820821904_cover.jpg" />
        </svg>
      </div>
    `);

    expect(hasImageSlice(slices, "1098001722820821904_cover.jpg")).toBe(true);
  });
});

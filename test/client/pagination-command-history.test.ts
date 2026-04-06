import {
  MAX_PAGINATION_COMMAND_HISTORY,
  nextPaginationCommandHistory,
  summarizePaginationCommand,
} from "@/lib/pagination-v2";
import type { PaginationCommand } from "@/lib/pagination-v2/protocol";
import { describe, expect, it } from "vitest";

const BASE_FONT_CONFIG = {
  bodyFamily: '"Inter", sans-serif',
  headingFamily: '"Inter", sans-serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

const BASE_LAYOUT_THEME = {
  baseFontSizePx: 16,
  lineHeightFactor: 1.5,
  paragraphSpacingFactor: 1.2,
  headingSpaceAbove: 1.5,
  headingSpaceBelow: 0.7,
  textAlign: "left" as const,
};

const BASE_CONFIG = {
  fontConfig: BASE_FONT_CONFIG,
  layoutTheme: BASE_LAYOUT_THEME,
  viewport: { width: 620, height: 860 },
};

const BASE_SPREAD_CONFIG = {
  columns: 1 as const,
  chapterFlow: "continuous" as const,
};

describe("Pagination command history", () => {
  it("records sent commands in newest-first order", () => {
    const commandA: PaginationCommand = { type: "goToPage", page: 3 };
    const commandB: PaginationCommand = { type: "goToPage", page: 4 };

    const withA = nextPaginationCommandHistory([], commandA, 1, 1000);
    const withB = nextPaginationCommandHistory(withA, commandB, 2, 1100);

    expect(withB).toHaveLength(2);
    expect(withB[0]?.summary).toContain("page=4");
    expect(withB[1]?.summary).toContain("page=3");
    expect(withB[0]?.timestampMs).toBe(1100);
    expect(withB[1]?.timestampMs).toBe(1000);
  });

  it("caps history length at 200 entries", () => {
    let history = [] as ReturnType<typeof nextPaginationCommandHistory>;

    for (let i = 1; i <= MAX_PAGINATION_COMMAND_HISTORY + 5; i++) {
      history = nextPaginationCommandHistory(
        history,
        { type: "goToPage", page: i },
        i,
        1000 + i,
      );
    }

    expect(history).toHaveLength(MAX_PAGINATION_COMMAND_HISTORY);
    expect(history[0]?.summary).toContain("page=205");
    expect(history.at(-1)?.summary).toContain("page=6");
  });

  it("keeps addChapter history lightweight via summary only", () => {
    const largeText = "x".repeat(5000);
    const addChapterCommand: PaginationCommand = {
      type: "addChapter",
      chapterIndex: 1,
      blocks: [
        {
          type: "text",
          id: "b-1",
          tag: "p",
          runs: [
            {
              text: largeText,
              bold: false,
              italic: false,
              isCode: false,
              isLink: false,
            },
          ],
        },
        {
          type: "spacer",
          id: "b-2",
        },
      ],
    };

    const summary = summarizePaginationCommand(addChapterCommand);

    expect(summary).toContain("chapter=2");
    expect(summary).toContain("blocks=2");
    expect(summary).not.toContain(largeText);
  });

  it("resets history when init command is sent", () => {
    const beforeInit = nextPaginationCommandHistory(
      [],
      { type: "goToPage", page: 12 },
      1,
      1000,
    );

    const initCommand: PaginationCommand = {
      type: "init",
      totalChapters: 8,
      paginationConfig: BASE_CONFIG,
      spreadConfig: BASE_SPREAD_CONFIG,
      initialChapterIndex: 2,
      firstChapterBlocks: [],
    };

    const afterInit = nextPaginationCommandHistory(
      beforeInit,
      initCommand,
      2,
      2000,
    );

    expect(afterInit).toHaveLength(1);
    expect(afterInit[0]?.type).toBe("init");
    expect(afterInit[0]?.summary).toContain("chapters=8");
  });

  it("summarizes updatePaginationConfig with merged config fields", () => {
    const summary = summarizePaginationCommand({
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_CONFIG,
        fontConfig: {
          ...BASE_FONT_CONFIG,
          baseSizePx: 18,
        },
        layoutTheme: {
          ...BASE_LAYOUT_THEME,
          lineHeightFactor: 1.8,
          paragraphSpacingFactor: 1.4,
          textAlign: "justify",
        },
        viewport: { width: 700, height: 900 },
      },
    });

    expect(summary).toContain("base=18.0px");
    expect(summary).toContain("lineHeight=1.80");
    expect(summary).toContain("para=1.40");
    expect(summary).toContain("align=justify");
    expect(summary).toContain("viewport=700x900");
  });

  it("summarizes goToChapter as a 1-indexed chapter number", () => {
    const summary = summarizePaginationCommand({
      type: "goToChapter",
      chapterIndex: 4,
    });

    expect(summary).toContain("chapter=5");
  });
});

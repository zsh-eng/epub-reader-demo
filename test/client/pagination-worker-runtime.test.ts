import type {
  PaginationCommand,
  PaginationEvent,
} from "@/lib/pagination-v2/protocol";
import { PaginationEngine } from "@/lib/pagination-v2/engine";
import {
  coalesceQueuedCommands,
  createCommandRuntime,
  RELAYOUT_YIELD_BUDGET_MS,
  type QueuedPaginationCommand,
} from "@/lib/pagination-v2/worker/runtime";
import type {
  Block,
  FontConfig,
  LayoutTheme,
  PaginationConfig,
} from "@/lib/pagination-v2/types";
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

const BASE_SPREAD_CONFIG = {
  columns: 1 as const,
  chapterFlow: "continuous" as const,
};

function buildConfig(baseSizePx: number): PaginationConfig {
  return {
    fontConfig: {
      ...BASE_FONT_CONFIG,
      baseSizePx,
    },
    layoutTheme: {
      ...BASE_LAYOUT_THEME,
      baseFontSizePx: baseSizePx,
    },
    viewport: { width: 620, height: 860 },
  };
}

function buildChapterBlocks(chapterIndex: number): Block[] {
  return [{ type: "spacer", id: `spacer-${chapterIndex}` }];
}

function countEvents(events: PaginationEvent[], type: PaginationEvent["type"]) {
  return events.filter((event) => event.type === type).length;
}

function getChapterOrder(events: PaginationEvent[]): number[] {
  return events
    .filter(
      (
        event,
      ): event is Extract<
        PaginationEvent,
        { type: "partialReady" | "progress" }
      > => event.type === "partialReady" || event.type === "progress",
    )
    .map((event) => event.chapterDiagnostics?.chapterIndex ?? -1);
}

describe("Pagination worker runtime", () => {
  it("coalesces supersedable commands while preserving non-supersedable order", () => {
    const commands: QueuedPaginationCommand[] = [
      {
        command: { type: "addChapter", chapterIndex: 0, blocks: [] },
      },
      {
        command: { type: "goToPage", page: 2 },
      },
      {
        command: {
          type: "updatePaginationConfig",
          paginationConfig: buildConfig(17),
        },
      },
      {
        command: { type: "goToPage", page: 7 },
      },
      {
        command: { type: "goToChapter", chapterIndex: 5 },
      },
      {
        command: { type: "goToChapter", chapterIndex: 2 },
      },
      {
        command: {
          type: "updatePaginationConfig",
          paginationConfig: buildConfig(18),
        },
      },
      {
        command: { type: "addChapter", chapterIndex: 1, blocks: [] },
      },
      {
        command: {
          type: "updateSpreadConfig",
          spreadConfig: { columns: 2, chapterFlow: "continuous" },
        },
      },
    ];

    const coalesced = coalesceQueuedCommands(commands);
    expect(coalesced.map((entry) => entry.command.type)).toEqual([
      "addChapter",
      "goToPage",
      "goToChapter",
      "updatePaginationConfig",
      "addChapter",
      "updateSpreadConfig",
    ]);
  });

  it("marks updatePaginationConfig runtime stale when a newer epoch arrives", () => {
    let layoutEpoch = 10;

    const runtime = createCommandRuntime(
      {
        type: "updatePaginationConfig",
        paginationConfig: buildConfig(18),
      },
      {
        getLayoutEpoch: () => layoutEpoch,
        activeEpoch: 10,
        hasPendingLayoutAdvancingCommand: () => false,
        yieldToEventLoop: async () => {},
        now: () => 0,
      },
    );

    expect(runtime.isStale()).toBe(false);

    layoutEpoch = 11;
    expect(runtime.isStale()).toBe(true);
  });

  it("uses elapsed time budget for yielding instead of iteration count", async () => {
    let nowMs = 0;
    let yieldCalls = 0;

    const runtime = createCommandRuntime(
      {
        type: "updatePaginationConfig",
        paginationConfig: buildConfig(19),
      },
      {
        getLayoutEpoch: () => 3,
        activeEpoch: 3,
        hasPendingLayoutAdvancingCommand: () => false,
        yieldToEventLoop: async () => {
          yieldCalls += 1;
        },
        now: () => nowMs,
      },
    );

    await runtime.maybeYield();
    nowMs = RELAYOUT_YIELD_BUDGET_MS - 1;
    await runtime.maybeYield();
    expect(yieldCalls).toBe(0);

    nowMs = RELAYOUT_YIELD_BUDGET_MS;
    await runtime.maybeYield();
    expect(yieldCalls).toBe(1);

    nowMs = RELAYOUT_YIELD_BUDGET_MS + 20;
    await runtime.maybeYield();
    expect(yieldCalls).toBe(1);

    nowMs = RELAYOUT_YIELD_BUDGET_MS * 2;
    await runtime.maybeYield();
    expect(yieldCalls).toBe(2);
  });

  it("cancels stale relayout and lets the latest relayout finish middle-out", async () => {
    const events: PaginationEvent[] = [];
    const engine = new PaginationEngine((event) => events.push(event));

    await engine.handleCommand({
      type: "init",
      totalChapters: 5,
      paginationConfig: buildConfig(16),
      spreadConfig: BASE_SPREAD_CONFIG,
      initialChapterIndex: 0,
      firstChapterBlocks: buildChapterBlocks(0),
    });

    for (let i = 1; i < 5; i++) {
      await engine.handleCommand({
        type: "addChapter",
        chapterIndex: i,
        blocks: buildChapterBlocks(i),
      });
    }

    await engine.handleCommand({ type: "goToChapter", chapterIndex: 2 });
    events.length = 0;

    const updateConfigA: PaginationCommand = {
      type: "updatePaginationConfig",
      paginationConfig: buildConfig(18),
    };
    const updateConfigB: PaginationCommand = {
      type: "updatePaginationConfig",
      paginationConfig: buildConfig(20),
    };

    let layoutEpoch = 1;
    const staleRuntime = createCommandRuntime(updateConfigA, {
      getLayoutEpoch: () => layoutEpoch,
      activeEpoch: 1,
      hasPendingLayoutAdvancingCommand: () => false,
      relayoutYieldBudgetMs: 0,
      now: () => 0,
      yieldToEventLoop: async () => {
        layoutEpoch = 2;
      },
    });

    await engine.handleCommand(updateConfigA, staleRuntime);
    expect(countEvents(events, "ready")).toBe(0);
    expect(countEvents(events, "partialReady")).toBe(1);

    events.length = 0;

    const freshRuntime = createCommandRuntime(updateConfigB, {
      getLayoutEpoch: () => layoutEpoch,
      activeEpoch: 2,
      hasPendingLayoutAdvancingCommand: () => false,
      relayoutYieldBudgetMs: 0,
      now: () => 0,
      yieldToEventLoop: async () => {},
    });

    await engine.handleCommand(updateConfigB, freshRuntime);

    expect(getChapterOrder(events)).toEqual([2, 3, 1, 4, 0]);
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "progress")).toBe(4);
    expect(countEvents(events, "ready")).toBe(1);
    expect(events.at(-1)?.type).toBe("ready");
  });
});

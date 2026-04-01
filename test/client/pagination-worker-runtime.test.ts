import type {
  PaginationCommand,
  PaginationEvent,
} from "@/lib/pagination/engine-types";
import { PaginationEngine } from "@/lib/pagination/pagination-engine";
import {
  coalesceQueuedCommands,
  createCommandRuntime,
  RELAYOUT_YIELD_BUDGET_MS,
  type QueuedPaginationCommand,
} from "@/lib/pagination/pagination-worker-runtime";
import type {
  Block,
  FontConfig,
  LayoutTheme,
  PaginationConfig,
} from "@/lib/pagination/types";
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

function buildConfig(baseSizePx: number): PaginationConfig {
  return {
    fontConfig: {
      ...BASE_FONT_CONFIG,
      baseSizePx,
    },
    layoutTheme: BASE_LAYOUT_THEME,
    viewport: { width: 620, height: 860 },
  };
}

function buildChapterBlocks(chapterIndex: number): Block[] {
  return [
    {
      type: "spacer",
      id: `spacer-${chapterIndex}`,
    },
  ];
}

function countEvents(events: PaginationEvent[], type: PaginationEvent["type"]) {
  return events.filter((event) => event.type === type).length;
}

function getChapterOrder(events: PaginationEvent[]): number[] {
  return events
    .filter(
      (event): event is Extract<PaginationEvent, { chapterIndex: number }> =>
        event.type === "partialReady" || event.type === "progress",
    )
    .map((event) => event.chapterIndex);
}

describe("Pagination worker runtime", () => {
  it("coalesces supersedable commands while preserving non-supersedable order", () => {
    const commands: QueuedPaginationCommand[] = [
      {
        sequence: 1,
        command: { type: "addChapter", chapterIndex: 0, blocks: [] },
      },
      {
        sequence: 2,
        command: { type: "getPage", globalPage: 2 },
      },
      {
        sequence: 3,
        command: { type: "updateConfig", config: buildConfig(17) },
      },
      {
        sequence: 4,
        command: { type: "getPage", globalPage: 7 },
      },
      {
        sequence: 5,
        command: { type: "goToChapter", chapterIndex: 5 },
      },
      {
        sequence: 6,
        command: { type: "goToChapter", chapterIndex: 2 },
      },
      {
        sequence: 7,
        command: { type: "updateConfig", config: buildConfig(18) },
      },
      {
        sequence: 8,
        command: { type: "addChapter", chapterIndex: 1, blocks: [] },
      },
    ];

    const coalesced = coalesceQueuedCommands(commands);
    expect(coalesced.map((entry) => entry.sequence)).toEqual([1, 4, 6, 7, 8]);
  });

  it("marks updateConfig runtime stale when a newer sequence arrives", () => {
    let latestUpdateConfigSequence = 10;

    const runtime = createCommandRuntime({
      queuedCommand: {
        sequence: 10,
        command: {
          type: "updateConfig",
          config: buildConfig(18),
        },
      },
      getLatestUpdateConfigSequence: () => latestUpdateConfigSequence,
      yieldToEventLoop: async () => {},
      now: () => 0,
    });

    expect(runtime.isStale()).toBe(false);

    latestUpdateConfigSequence = 11;
    expect(runtime.isStale()).toBe(true);
  });

  it("uses elapsed time budget for yielding instead of iteration count", async () => {
    let nowMs = 0;
    let yieldCalls = 0;

    const runtime = createCommandRuntime({
      queuedCommand: {
        sequence: 3,
        command: {
          type: "updateConfig",
          config: buildConfig(19),
        },
      },
      getLatestUpdateConfigSequence: () => 3,
      yieldToEventLoop: async () => {
        yieldCalls += 1;
      },
      now: () => nowMs,
    });

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
      config: buildConfig(16),
      initialChapterIndex: 0,
    });

    for (let i = 0; i < 5; i++) {
      await engine.handleCommand({
        type: "addChapter",
        chapterIndex: i,
        blocks: buildChapterBlocks(i),
      });
    }

    await engine.handleCommand({ type: "getPage", globalPage: 3 });
    events.length = 0;

    const updateConfigA: PaginationCommand = {
      type: "updateConfig",
      config: buildConfig(18),
    };
    const updateConfigB: PaginationCommand = {
      type: "updateConfig",
      config: buildConfig(20),
    };

    let latestUpdateConfigSequence = 1;
    const staleRuntime = createCommandRuntime({
      queuedCommand: {
        sequence: 1,
        command: updateConfigA,
      },
      getLatestUpdateConfigSequence: () => latestUpdateConfigSequence,
      relayoutYieldBudgetMs: 0,
      now: () => 0,
      yieldToEventLoop: async () => {
        latestUpdateConfigSequence = 2;
      },
    });

    await engine.handleCommand(updateConfigA, staleRuntime);
    expect(countEvents(events, "ready")).toBe(0);
    expect(countEvents(events, "partialReady")).toBe(1);

    events.length = 0;

    const freshRuntime = createCommandRuntime({
      queuedCommand: {
        sequence: 2,
        command: updateConfigB,
      },
      getLatestUpdateConfigSequence: () => latestUpdateConfigSequence,
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

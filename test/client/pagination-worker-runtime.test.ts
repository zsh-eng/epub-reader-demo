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
        revision: 1,
        command: { type: "addChapter", chapterIndex: 0, blocks: [] },
      },
      {
        revision: 1,
        command: { type: "getPage", globalPage: 2 },
      },
      {
        revision: 2,
        command: { type: "updateConfig", config: buildConfig(17) },
      },
      {
        revision: 1,
        command: { type: "getPage", globalPage: 7 },
      },
      {
        revision: 1,
        command: { type: "goToChapter", chapterIndex: 5 },
      },
      {
        revision: 1,
        command: { type: "goToChapter", chapterIndex: 2 },
      },
      {
        revision: 3,
        command: { type: "updateConfig", config: buildConfig(18) },
      },
      {
        revision: 3,
        command: { type: "addChapter", chapterIndex: 1, blocks: [] },
      },
    ];

    const coalesced = coalesceQueuedCommands(commands);
    expect(coalesced.map((entry) => entry.revision)).toEqual([1, 1, 1, 3, 3]);
  });

  it("marks updateConfig runtime stale when a newer revision arrives", () => {
    let latestLayoutRevision = 10;

    const runtime = createCommandRuntime({
      queuedCommand: {
        revision: 10,
        command: {
          type: "updateConfig",
          config: buildConfig(18),
        },
      },
      getLatestLayoutRevision: () => latestLayoutRevision,
      yieldToEventLoop: async () => {},
      now: () => 0,
    });

    expect(runtime.isStale()).toBe(false);

    latestLayoutRevision = 11;
    expect(runtime.isStale()).toBe(true);
  });

  it("uses elapsed time budget for yielding instead of iteration count", async () => {
    let nowMs = 0;
    let yieldCalls = 0;

    const runtime = createCommandRuntime({
      queuedCommand: {
        revision: 3,
        command: {
          type: "updateConfig",
          config: buildConfig(19),
        },
      },
      getLatestLayoutRevision: () => 3,
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

    let latestLayoutRevision = 1;
    const staleRuntime = createCommandRuntime({
      queuedCommand: {
        revision: 1,
        command: updateConfigA,
      },
      getLatestLayoutRevision: () => latestLayoutRevision,
      relayoutYieldBudgetMs: 0,
      now: () => 0,
      yieldToEventLoop: async () => {
        latestLayoutRevision = 2;
      },
    });

    await engine.handleCommand(updateConfigA, staleRuntime);
    expect(countEvents(events, "ready")).toBe(0);
    expect(countEvents(events, "partialReady")).toBe(1);

    events.length = 0;

    const freshRuntime = createCommandRuntime({
      queuedCommand: {
        revision: 2,
        command: updateConfigB,
      },
      getLatestLayoutRevision: () => latestLayoutRevision,
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

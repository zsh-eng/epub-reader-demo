import { PaginationEngine } from "@/lib/pagination-v2/pagination-engine";
import { createCommandRuntime } from "@/lib/pagination-v2/pagination-worker-runtime";
import type { PaginationEvent } from "@/lib/pagination-v2/engine-types";
import type {
  Block,
  FontConfig,
  LayoutTheme,
  PaginationConfig,
} from "@/lib/pagination-v2/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

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

const BASE_CONFIG: PaginationConfig = {
  fontConfig: BASE_FONT_CONFIG,
  layoutTheme: BASE_LAYOUT_THEME,
  viewport: { width: 620, height: 860 },
};

function makeSpacerBlocks(chapterIndex: number): Block[] {
  return [{ type: "spacer", id: `spacer-${chapterIndex}` }];
}

function makeLongTextBlocks(blockId: string): Block[] {
  const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ";
  return [
    {
      type: "text",
      id: blockId,
      tag: "p",
      runs: [
        {
          text: paragraph.repeat(260),
          bold: false,
          italic: false,
          isCode: false,
          isLink: false,
        },
      ],
    },
  ];
}

/** Create an engine with `initialChapterIndex` chapter already initialised. */
function createEngine(
  totalChapters: number,
  initialChapterIndex = 0,
  blocks?: Block[],
) {
  const events: PaginationEvent[] = [];
  const engine = new PaginationEngine((event) => events.push(event));

  engine.handleCommand({
    type: "init",
    totalChapters,
    config: BASE_CONFIG,
    initialChapterIndex,
    firstChapterBlocks: blocks ?? makeSpacerBlocks(initialChapterIndex),
  });

  return { engine, events };
}

function addChapter(
  engine: PaginationEngine,
  chapterIndex: number,
  blocks?: Block[],
): void {
  engine.handleCommand({
    type: "addChapter",
    chapterIndex,
    blocks: blocks ?? makeSpacerBlocks(chapterIndex),
  });
}

function lastEvent(events: PaginationEvent[]): PaginationEvent | undefined {
  return events[events.length - 1];
}

function countEvents(events: PaginationEvent[], type: PaginationEvent["type"]) {
  return events.filter((e) => e.type === type).length;
}

/** Indices of chapters emitted by partialReady/progress events. */
function getChapterOrder(events: PaginationEvent[]): number[] {
  const result: number[] = [];
  for (const e of events) {
    if (e.type === "partialReady" || e.type === "progress") {
      result.push(e.chapterDiagnostics?.chapterIndex ?? -1);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 1. Init / addChapter lifecycle
// ---------------------------------------------------------------------------

describe("init + addChapter lifecycle", () => {
  it("emits partialReady after init when totalChapters > 1", () => {
    const { events } = createEngine(3);
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(0);

    const partial = events.find((e) => e.type === "partialReady");
    expect(partial?.type).toBe("partialReady");
  });

  it("emits ready immediately when totalChapters === 1", () => {
    const { events } = createEngine(1);
    expect(countEvents(events, "ready")).toBe(1);
    expect(countEvents(events, "partialReady")).toBe(0);
  });

  it("transitions from partial to ready once all chapters are added", () => {
    const { engine, events } = createEngine(3);
    addChapter(engine, 1);
    addChapter(engine, 2);

    expect(countEvents(events, "ready")).toBe(1);
    expect(lastEvent(events)?.type).toBe("ready");
  });

  it("emits progress events for chapters that are not the initial chapter", () => {
    const { engine, events } = createEngine(3);
    events.length = 0;

    addChapter(engine, 1);
    expect(countEvents(events, "progress")).toBe(1);
    expect(countEvents(events, "ready")).toBe(0);

    addChapter(engine, 2);
    expect(countEvents(events, "ready")).toBe(1);
  });

  it("page in partialReady contains currentPage, totalPages, and content", () => {
    const { events } = createEngine(2);
    const partial = events.find(
      (e): e is Extract<PaginationEvent, { type: "partialReady" }> =>
        e.type === "partialReady",
    );
    expect(partial).toBeDefined();
    expect(partial!.page.currentPage).toBeGreaterThanOrEqual(1);
    expect(partial!.page.totalPages).toBeGreaterThanOrEqual(1);
    expect(partial!.page.currentPageInChapter).toBeGreaterThanOrEqual(1);
    expect(partial!.page.totalPagesInChapter).toBeGreaterThanOrEqual(1);
  });

  it("skips duplicate addChapter calls for the same index", () => {
    const { engine, events } = createEngine(2);
    const eventsLenBefore = events.length;

    // Sending chapter 0 again (already included in init) should be ignored.
    addChapter(engine, 0);
    expect(events.length).toBe(eventsLenBefore);
  });
});

// ---------------------------------------------------------------------------
// 2. Navigation — nextPage / prevPage / goToPage / goToChapter
// ---------------------------------------------------------------------------

describe("navigation", () => {
  it("nextPage advances the current page", () => {
    const { engine, events } = createEngine(
      1,
      0,
      makeLongTextBlocks("long-text"),
    );
    const initialPage = events.find((e) => e.type === "ready") as Extract<
      PaginationEvent,
      { type: "ready" }
    >;
    expect(initialPage.page.totalPages).toBeGreaterThan(1);

    events.length = 0;
    engine.handleCommand({ type: "nextPage" });

    const pageContent = events.find(
      (e): e is Extract<PaginationEvent, { type: "pageContent" }> =>
        e.type === "pageContent",
    );
    expect(pageContent).toBeDefined();
    expect(pageContent!.page.currentPage).toBe(2);
  });

  it("prevPage from page 1 emits pageUnavailable", () => {
    const { engine, events } = createEngine(1);
    events.length = 0;

    engine.handleCommand({ type: "prevPage" });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageUnavailable");
  });

  it("prevPage after advancing returns to page 1", () => {
    const { engine, events } = createEngine(
      1,
      0,
      makeLongTextBlocks("long-prev"),
    );
    engine.handleCommand({ type: "nextPage" });
    events.length = 0;

    engine.handleCommand({ type: "prevPage" });
    const pageContent = events.find(
      (e): e is Extract<PaginationEvent, { type: "pageContent" }> =>
        e.type === "pageContent",
    );
    expect(pageContent!.page.currentPage).toBe(1);
  });

  it("goToPage jumps to the specified page", () => {
    const { engine, events } = createEngine(
      1,
      0,
      makeLongTextBlocks("long-goto"),
    );
    const readyEvent = events.find(
      (e): e is Extract<PaginationEvent, { type: "ready" }> =>
        e.type === "ready",
    )!;
    const total = readyEvent.page.totalPages;
    expect(total).toBeGreaterThan(2);

    events.length = 0;
    engine.handleCommand({ type: "goToPage", page: total });
    const pageContent = events.find(
      (e): e is Extract<PaginationEvent, { type: "pageContent" }> =>
        e.type === "pageContent",
    );
    expect(pageContent!.page.currentPage).toBe(total);
  });

  it("goToPage to a non-existent page emits pageUnavailable", () => {
    const { engine, events } = createEngine(1);
    events.length = 0;

    engine.handleCommand({ type: "goToPage", page: 999 });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageUnavailable");
  });

  it("goToChapter jumps to first page of the target chapter", () => {
    const { engine, events } = createEngine(3);
    addChapter(engine, 1);
    addChapter(engine, 2);
    events.length = 0;

    engine.handleCommand({ type: "goToChapter", chapterIndex: 2 });
    const pageContent = events.find(
      (e): e is Extract<PaginationEvent, { type: "pageContent" }> =>
        e.type === "pageContent",
    );
    expect(pageContent).toBeDefined();
    expect(pageContent!.page.chapterIndex).toBe(2);
    expect(pageContent!.page.currentPageInChapter).toBe(1);
  });

  it("goToChapter emits chapterUnavailable for an unloaded chapter", () => {
    const { engine, events } = createEngine(3);
    events.length = 0;

    engine.handleCommand({ type: "goToChapter", chapterIndex: 2 });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("chapterUnavailable");
    if (events[0]?.type === "chapterUnavailable") {
      expect(events[0].chapterIndex).toBe(2);
    }
  });

  it("nextPage crosses chapter boundary when at end of current chapter", () => {
    const { engine, events } = createEngine(2);
    addChapter(engine, 1);
    events.length = 0;

    // Navigate to chapter 1 first page via goToChapter, then nextPage moves to ch 1.
    // Actually chapter 0 has exactly 1 page (spacer block), so nextPage from page 1
    // should move to chapter 1's first page.
    engine.handleCommand({ type: "nextPage" });
    const pageContent = events.find(
      (e): e is Extract<PaginationEvent, { type: "pageContent" }> =>
        e.type === "pageContent",
    );
    expect(pageContent).toBeDefined();
    expect(pageContent!.page.chapterIndex).toBe(1);
  });

  it("prevPage crosses chapter boundary when at start of current chapter", () => {
    const { engine, events } = createEngine(2);
    addChapter(engine, 1);

    engine.handleCommand({ type: "goToChapter", chapterIndex: 1 });
    events.length = 0;

    engine.handleCommand({ type: "prevPage" });
    const pageContent = events.find(
      (e): e is Extract<PaginationEvent, { type: "pageContent" }> =>
        e.type === "pageContent",
    );
    expect(pageContent).toBeDefined();
    expect(pageContent!.page.chapterIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. totalPagesInChapter / currentPageInChapter
// ---------------------------------------------------------------------------

describe("per-chapter page counts", () => {
  it("totalPagesInChapter equals the chapter's page count", () => {
    const { engine, events } = createEngine(
      1,
      0,
      makeLongTextBlocks("long-counts"),
    );
    const readyEvent = events.find(
      (e): e is Extract<PaginationEvent, { type: "ready" }> =>
        e.type === "ready",
    )!;
    const total = readyEvent.page.totalPages;
    expect(readyEvent.page.totalPagesInChapter).toBe(total);
    expect(readyEvent.page.currentPageInChapter).toBe(1);
  });

  it("currentPageInChapter resets to 1 when jumping to a new chapter", () => {
    const { engine, events } = createEngine(2);
    addChapter(engine, 1);
    events.length = 0;

    engine.handleCommand({ type: "goToChapter", chapterIndex: 1 });
    const pc = events.find(
      (e): e is Extract<PaginationEvent, { type: "pageContent" }> =>
        e.type === "pageContent",
    );
    expect(pc!.page.currentPageInChapter).toBe(1);
    expect(pc!.page.chapterIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Anchor preservation across relayout
// ---------------------------------------------------------------------------

describe("anchor preservation across relayout", () => {
  it("anchor survives an updateConfig relayout", async () => {
    const { engine, events } = createEngine(
      1,
      0,
      makeLongTextBlocks("anchor-stable"),
    );

    // Navigate to page 2.
    engine.handleCommand({ type: "nextPage" });
    const pc = events.find(
      (e): e is Extract<PaginationEvent, { type: "pageContent" }> =>
        e.type === "pageContent",
    )!;
    const pageBeforeRelayout = pc.page.currentPage;
    expect(pageBeforeRelayout).toBe(2);

    events.length = 0;

    // Trigger relayout with a viewport change.
    await engine.handleCommand({
      type: "updateConfig",
      config: { ...BASE_CONFIG, viewport: { width: 520, height: 900 } },
    });

    const readyEvent = events.find(
      (e): e is Extract<PaginationEvent, { type: "ready" }> =>
        e.type === "ready",
    )!;
    // Position should still be > 1 (we were on page 2 before relayout).
    expect(readyEvent.page.currentPage).toBeGreaterThan(1);
  });

  it("rapid config changes keep position stable (anchor not updated during relayout)", async () => {
    const { engine, events } = createEngine(
      1,
      0,
      makeLongTextBlocks("anchor-rapid"),
    );

    engine.handleCommand({ type: "nextPage" });
    events.length = 0;

    await engine.handleCommand({
      type: "updateConfig",
      config: { ...BASE_CONFIG, viewport: { width: 550, height: 880 } },
    });
    await engine.handleCommand({
      type: "updateConfig",
      config: { ...BASE_CONFIG, viewport: { width: 600, height: 860 } },
    });

    const readyEvents = events.filter(
      (e): e is Extract<PaginationEvent, { type: "ready" }> =>
        e.type === "ready",
    );
    expect(readyEvents.length).toBeGreaterThanOrEqual(1);
    // Position should still be > 1.
    expect(readyEvents.at(-1)!.page.currentPage).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Middle-out relayout order
// ---------------------------------------------------------------------------

describe("middle-out relayout order", () => {
  it("relayout starts from the current anchor's chapter", async () => {
    const { engine, events } = createEngine(5);
    for (let i = 1; i < 5; i++) addChapter(engine, i);

    engine.handleCommand({ type: "goToChapter", chapterIndex: 2 });
    events.length = 0;

    await engine.handleCommand({
      type: "updateConfig",
      config: { ...BASE_CONFIG, viewport: { width: 700, height: 900 } },
    });

    expect(getChapterOrder(events)).toEqual([2, 3, 1, 4, 0]);
  });

  it("falls back to initialChapterIndex when anchor is on chapter 0", async () => {
    const { engine, events } = createEngine(5, 2, makeSpacerBlocks(2));
    for (let i = 0; i < 5; i++) {
      if (i !== 2) addChapter(engine, i);
    }
    events.length = 0;

    await engine.handleCommand({
      type: "updateConfig",
      config: { ...BASE_CONFIG, viewport: { width: 660, height: 860 } },
    });

    // Anchor is in chapter 2, so center is 2.
    expect(getChapterOrder(events)[0]).toBe(2);
  });

  it("emits exactly one partialReady and one ready per relayout", async () => {
    const { engine, events } = createEngine(5);
    for (let i = 1; i < 5; i++) addChapter(engine, i);
    events.length = 0;

    await engine.handleCommand({
      type: "updateConfig",
      config: { ...BASE_CONFIG, viewport: { width: 700, height: 900 } },
    });

    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);
    expect(lastEvent(events)?.type).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// 6. Stale relayout interrupted by a new one
// ---------------------------------------------------------------------------

describe("stale relayout detection", () => {
  it("aborts an in-progress relayout when a newer config arrives", async () => {
    const { engine, events } = createEngine(5);
    for (let i = 1; i < 5; i++) addChapter(engine, i);

    events.length = 0;

    let layoutEpoch = 1;
    const staleRuntime = createCommandRuntime(
      { type: "updateConfig", config: BASE_CONFIG },
      {
        getLayoutEpoch: () => layoutEpoch,
        activeEpoch: 1,
        yieldToEventLoop: async () => {
          layoutEpoch = 2; // signal stale after first yield
        },
        now: () => 0,
        relayoutYieldBudgetMs: 0,
      },
    );

    await engine.handleCommand(
      {
        type: "updateConfig",
        config: { ...BASE_CONFIG, viewport: { width: 700, height: 900 } },
      },
      staleRuntime,
    );

    // Should have emitted partialReady but NOT ready (staled before completion).
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. updateConfig no-op when config unchanged
// ---------------------------------------------------------------------------

describe("updateConfig no-op", () => {
  it("emits nothing when config is identical", async () => {
    const { engine, events } = createEngine(2);
    addChapter(engine, 1);
    events.length = 0;

    await engine.handleCommand({ type: "updateConfig", config: BASE_CONFIG });
    expect(events).toHaveLength(0);
  });

  it("detects font change vs layout-only change", async () => {
    const { engine, events } = createEngine(2);
    addChapter(engine, 1);

    events.length = 0;
    await engine.handleCommand({
      type: "updateConfig",
      config: {
        ...BASE_CONFIG,
        fontConfig: { ...BASE_FONT_CONFIG, baseSizePx: 20 },
        layoutTheme: { ...BASE_LAYOUT_THEME, baseFontSizePx: 20 },
      },
    });

    // Both paths should produce a ready event.
    expect(countEvents(events, "ready")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Epoch filtering
// ---------------------------------------------------------------------------

describe("epoch on events", () => {
  it("all non-error events carry the engine epoch", () => {
    const { events } = createEngine(2);
    for (const e of events) {
      if (e.type === "error") continue;
      expect("epoch" in e).toBe(true);
    }
  });

  it("epoch advances when init is called again via a new engine", () => {
    const events1: PaginationEvent[] = [];
    const engine1 = new PaginationEngine((e) => events1.push(e));
    engine1.epoch = 0;
    engine1.handleCommand({
      type: "init",
      totalChapters: 1,
      config: BASE_CONFIG,
      initialChapterIndex: 0,
      firstChapterBlocks: makeSpacerBlocks(0),
    });

    const events2: PaginationEvent[] = [];
    const engine2 = new PaginationEngine((e) => events2.push(e));
    engine2.epoch = 5;
    engine2.handleCommand({
      type: "init",
      totalChapters: 1,
      config: BASE_CONFIG,
      initialChapterIndex: 0,
      firstChapterBlocks: makeSpacerBlocks(0),
    });

    const e1 = events1.find((e) => e.type === "ready") as Extract<
      PaginationEvent,
      { type: "ready" }
    >;
    const e2 = events2.find((e) => e.type === "ready") as Extract<
      PaginationEvent,
      { type: "ready" }
    >;
    expect(e1.epoch).toBe(0);
    expect(e2.epoch).toBe(5);
  });
});

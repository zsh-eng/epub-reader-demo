import type { PaginationEvent } from "@/lib/pagination-v2/protocol";
import { PaginationEngine } from "@/lib/pagination-v2/engine";
import { createCommandRuntime } from "@/lib/pagination-v2/worker/runtime";
import type {
  Block,
  ContentAnchor,
  FontConfig,
  LayoutTheme,
  PaginationConfig,
  ResolvedSpread,
  SpreadConfig,
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

const BASE_PAGINATION_CONFIG: PaginationConfig = {
  fontConfig: BASE_FONT_CONFIG,
  layoutTheme: BASE_LAYOUT_THEME,
  viewport: { width: 620, height: 860 },
};

const BASE_SPREAD_CONFIG: SpreadConfig = {
  columns: 1,
  chapterFlow: "continuous",
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

function makeSpacerSplitBlocks(): Block[] {
  return [
    {
      type: "image",
      id: "image-before-split",
      src: "cover-before-split.jpg",
      intrinsicWidth: 600,
      intrinsicHeight: 855,
    },
    { type: "spacer", id: "spacer-21" },
    { type: "page-break", id: "pb-after-spacer" },
  ];
}

function pageSlots(spread: ResolvedSpread) {
  return spread.slots.filter(
    (slot): slot is Extract<(typeof spread.slots)[number], { kind: "page" }> =>
      slot.kind === "page",
  );
}

function gapSlots(spread: ResolvedSpread) {
  return spread.slots.filter(
    (slot): slot is Extract<(typeof spread.slots)[number], { kind: "gap" }> =>
      slot.kind === "gap",
  );
}

function firstPageSlot(spread: ResolvedSpread) {
  return pageSlots(spread)[0];
}

function spreadContainsLeafPage(spread: ResolvedSpread, pageNumber: number) {
  return pageSlots(spread).some((slot) => slot.page.currentPage === pageNumber);
}

/** Create an engine with `initialChapterIndex` chapter already initialised. */
function createEngine(options?: {
  totalChapters?: number;
  initialChapterIndex?: number;
  initialAnchor?: ContentAnchor;
  blocks?: Block[];
  paginationConfig?: PaginationConfig;
  spreadConfig?: SpreadConfig;
}) {
  const events: PaginationEvent[] = [];
  const engine = new PaginationEngine((event) => events.push(event));

  const totalChapters = options?.totalChapters ?? 1;
  const initialChapterIndex = options?.initialChapterIndex ?? 0;
  const paginationConfig = options?.paginationConfig ?? BASE_PAGINATION_CONFIG;
  const spreadConfig = options?.spreadConfig ?? BASE_SPREAD_CONFIG;

  engine.handleCommand({
    type: "init",
    totalChapters,
    paginationConfig,
    spreadConfig,
    initialChapterIndex,
    initialAnchor: options?.initialAnchor,
    firstChapterBlocks:
      options?.blocks ?? makeSpacerBlocks(initialChapterIndex),
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

function getReadyEvent(events: PaginationEvent[]) {
  return events.find(
    (e): e is Extract<PaginationEvent, { type: "ready" }> => e.type === "ready",
  );
}

function getPageContentEvent(events: PaginationEvent[]) {
  return events.find(
    (e): e is Extract<PaginationEvent, { type: "pageContent" }> =>
      e.type === "pageContent",
  );
}

function getLastEventOfType<T extends PaginationEvent["type"]>(
  events: PaginationEvent[],
  type: T,
) {
  return [...events]
    .reverse()
    .find(
      (event): event is Extract<PaginationEvent, { type: T }> =>
        event.type === type,
    );
}

// ---------------------------------------------------------------------------
// 1. Init / addChapter lifecycle
// ---------------------------------------------------------------------------

describe("init + addChapter lifecycle", () => {
  it("emits partialReady after init when totalChapters > 1", () => {
    const { events } = createEngine({ totalChapters: 3 });
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(0);

    const partial = events.find((e) => e.type === "partialReady");
    expect(partial?.type).toBe("partialReady");
    expect(partial?.cause).toBe("init");
    if (partial?.type === "partialReady") {
      expect(partial.spread.cause).toBe("init");
    }
  });

  it("emits ready immediately when totalChapters === 1", () => {
    const { events } = createEngine({ totalChapters: 1 });
    expect(countEvents(events, "ready")).toBe(1);
    expect(countEvents(events, "partialReady")).toBe(0);

    const ready = getReadyEvent(events);
    expect(ready?.cause).toBe("init");
    expect(ready?.spread.cause).toBe("init");
  });

  it("transitions from partial to ready once all chapters are added", () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    addChapter(engine, 1);
    addChapter(engine, 2);

    expect(countEvents(events, "ready")).toBe(1);
    const ready = getLastEventOfType(events, "ready");
    expect(ready).toBeDefined();
    expect(ready?.cause).toBe("addChapter");
    expect(ready?.spread.cause).toBe("addChapter");
  });

  it("emits progress with both leaf and spread counters", () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    events.length = 0;

    addChapter(engine, 1);
    const progress = events.find(
      (e): e is Extract<PaginationEvent, { type: "progress" }> =>
        e.type === "progress",
    );

    expect(progress).toBeDefined();
    expect(progress?.cause).toBe("addChapter");
    expect(progress!.currentPage).toBeGreaterThanOrEqual(1);
    expect(progress!.totalPages).toBeGreaterThanOrEqual(progress!.currentPage);
    expect(progress!.currentSpread).toBeGreaterThanOrEqual(1);
    expect(progress!.totalSpreads).toBeGreaterThanOrEqual(
      progress!.currentSpread,
    );
  });

  it("spread in partialReady contains slot metadata", () => {
    const { events } = createEngine({ totalChapters: 2 });
    const partial = events.find(
      (e): e is Extract<PaginationEvent, { type: "partialReady" }> =>
        e.type === "partialReady",
    );

    expect(partial).toBeDefined();
    expect(partial?.cause).toBe("init");
    expect(partial!.spread.slots.length).toBe(1);
    expect(partial!.spread.cause).toBe("init");
    expect(partial!.spread.currentPage).toBeGreaterThanOrEqual(1);
    expect(partial!.spread.totalPages).toBeGreaterThanOrEqual(1);
  });

  it("skips duplicate addChapter calls for the same index", () => {
    const { engine, events } = createEngine({ totalChapters: 2 });
    const eventsLenBefore = events.length;

    addChapter(engine, 0);
    expect(events.length).toBe(eventsLenBefore);
  });

  it("progress events overwrite stale navigation cause with addChapter", () => {
    const { engine, events } = createEngine({
      totalChapters: 3,
      blocks: makeLongTextBlocks("cause-regression"),
    });
    events.length = 0;

    engine.handleCommand({ type: "nextSpread" });
    const navigationEvent = getPageContentEvent(events);
    expect(navigationEvent?.cause).toBe("nextSpread");
    expect(navigationEvent?.spread.cause).toBe("nextSpread");

    events.length = 0;
    addChapter(engine, 1);

    const progress = getLastEventOfType(events, "progress");
    expect(progress).toBeDefined();
    expect(progress?.cause).toBe("addChapter");
  });
});

// ---------------------------------------------------------------------------
// 1b. updateChapter lifecycle
// ---------------------------------------------------------------------------

describe("updateChapter lifecycle", () => {
  it("re-layouts one loaded chapter and emits updateChapter causes", async () => {
    const { engine, events } = createEngine({
      totalChapters: 2,
      blocks: makeLongTextBlocks("chapter-0"),
    });
    addChapter(engine, 1, makeLongTextBlocks("chapter-1"));

    events.length = 0;

    await engine.handleCommand({
      type: "updateChapter",
      chapterIndex: 0,
      blocks: makeLongTextBlocks("chapter-0-updated"),
    });

    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);

    const partial = getLastEventOfType(events, "partialReady");
    const ready = getLastEventOfType(events, "ready");

    expect(partial?.cause).toBe("updateChapter");
    expect(partial?.spread.cause).toBe("updateChapter");
    expect(ready?.cause).toBe("updateChapter");
    expect(ready?.spread.cause).toBe("updateChapter");
  });

  it("keeps anchor chapter stable when another chapter is updated", async () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    addChapter(engine, 1, makeSpacerBlocks(1));
    addChapter(engine, 2, makeSpacerBlocks(2));

    engine.handleCommand({ type: "goToChapter", chapterIndex: 2 });
    events.length = 0;

    await engine.handleCommand({
      type: "updateChapter",
      chapterIndex: 0,
      blocks: makeLongTextBlocks("updated-ch-0"),
    });

    const ready = getLastEventOfType(events, "ready");
    expect(ready).toBeDefined();
    expect(ready?.cause).toBe("updateChapter");
    expect(ready?.spread.cause).toBe("updateChapter");
    expect(ready?.spread.chapterIndexStart).toBe(2);

    const first = ready ? firstPageSlot(ready.spread) : undefined;
    expect(first?.page.chapterIndex).toBe(2);
  });

  it("emits error when updateChapter targets an unloaded chapter", async () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    events.length = 0;

    await engine.handleCommand({
      type: "updateChapter",
      chapterIndex: 2,
      blocks: makeSpacerBlocks(2),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
    expect(events[0]?.cause).toBe("updateChapter");
    if (events[0]?.type === "error") {
      expect(events[0].message).toContain("has not been loaded");
    }
  });

  it("emits error when updateChapter index is out of bounds", async () => {
    const { engine, events } = createEngine({ totalChapters: 2 });
    events.length = 0;

    await engine.handleCommand({
      type: "updateChapter",
      chapterIndex: 99,
      blocks: makeSpacerBlocks(99),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
    expect(events[0]?.cause).toBe("updateChapter");
    if (events[0]?.type === "error") {
      expect(events[0].message).toContain("out of bounds");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Navigation — nextSpread / prevSpread / goToPage / goToChapter
// ---------------------------------------------------------------------------

describe("navigation", () => {
  it("nextSpread advances to the next spread", () => {
    const { engine, events } = createEngine({
      blocks: makeLongTextBlocks("long-text"),
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    const ready = getReadyEvent(events)!;
    expect(ready.spread.totalPages).toBeGreaterThan(3);

    events.length = 0;
    engine.handleCommand({ type: "nextSpread" });

    const pageContent = getPageContentEvent(events);
    expect(pageContent).toBeDefined();
    expect(pageContent?.cause).toBe("nextSpread");
    expect(pageContent?.spread.cause).toBe("nextSpread");
    expect(pageContent!.spread.currentSpread).toBe(2);
  });

  it("nextSpread should advance from a pre-split spacer anchor (regression)", () => {
    const { engine, events } = createEngine({
      blocks: makeSpacerSplitBlocks(),
      spreadConfig: { columns: 1, chapterFlow: "continuous" },
    });

    const ready = getReadyEvent(events)!;
    expect(ready.spread.totalPages).toBeGreaterThanOrEqual(2);
    expect(ready.spread.currentSpread).toBe(1);

    events.length = 0;
    engine.handleCommand({ type: "nextSpread" });

    const pageContent = getPageContentEvent(events);
    expect(pageContent).toBeDefined();
    expect(pageContent?.cause).toBe("nextSpread");
    expect(pageContent?.spread.cause).toBe("nextSpread");
    expect(pageContent!.spread.currentSpread).toBe(2);
  });

  it("prevSpread from the first spread emits pageUnavailable", () => {
    const { engine, events } = createEngine();
    events.length = 0;

    engine.handleCommand({ type: "prevSpread" });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageUnavailable");
    expect(events[0]?.cause).toBe("prevSpread");
  });

  it("goToPage remains leaf-based and emits containing spread", () => {
    const { engine, events } = createEngine({
      blocks: makeLongTextBlocks("long-goto"),
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    const readyEvent = getReadyEvent(events)!;
    expect(readyEvent.spread.totalPages).toBeGreaterThan(2);

    events.length = 0;
    engine.handleCommand({ type: "goToPage", page: 2 });

    const pageContent = getPageContentEvent(events)!;
    expect(pageContent.cause).toBe("goToPage");
    expect(pageContent.spread.cause).toBe("goToPage");
    expect(spreadContainsLeafPage(pageContent.spread, 2)).toBe(true);
    expect(pageContent.spread.totalPages).toBe(readyEvent.spread.totalPages);
  });

  it("goToPage to a non-existent page emits pageUnavailable", () => {
    const { engine, events } = createEngine();
    events.length = 0;

    engine.handleCommand({ type: "goToPage", page: 999 });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageUnavailable");
    expect(events[0]?.cause).toBe("goToPage");
  });

  it("goToChapter jumps to the chapter's first leaf page in a spread", () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    addChapter(engine, 1);
    addChapter(engine, 2);
    events.length = 0;

    engine.handleCommand({ type: "goToChapter", chapterIndex: 2 });
    const pageContent = getPageContentEvent(events)!;
    expect(pageContent.cause).toBe("goToChapter");
    expect(pageContent.spread.cause).toBe("goToChapter");

    const first = firstPageSlot(pageContent.spread)!;
    expect(first.page.chapterIndex).toBe(2);
    expect(first.page.currentPageInChapter).toBe(1);
  });

  it("goToChapter emits chapterUnavailable for an unloaded chapter", () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    events.length = 0;

    engine.handleCommand({ type: "goToChapter", chapterIndex: 2 });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("chapterUnavailable");
    expect(events[0]?.cause).toBe("goToChapter");
    if (events[0]?.type === "chapterUnavailable") {
      expect(events[0].chapterIndex).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Spread projection behavior
// ---------------------------------------------------------------------------

describe("spread projection", () => {
  it("continuous flow packs chapter boundaries into the same spread", () => {
    const { engine, events } = createEngine({
      totalChapters: 2,
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });
    addChapter(engine, 1);

    const ready = getReadyEvent(events)!;
    const pages = pageSlots(ready.spread);

    expect(pages).toHaveLength(2);
    expect(pages[0]?.page.chapterIndex).toBe(0);
    expect(pages[1]?.page.chapterIndex).toBe(1);
  });

  it("align-leftmost inserts chapter-boundary gaps", () => {
    const { engine, events } = createEngine({
      totalChapters: 2,
      spreadConfig: { columns: 3, chapterFlow: "align-leftmost" },
    });
    addChapter(engine, 1);

    const ready = getReadyEvent(events)!;
    const gaps = gapSlots(ready.spread);

    expect(gaps).toHaveLength(2);
    expect(gaps.every((g) => g.reason === "chapter-boundary")).toBe(true);

    events.length = 0;
    engine.handleCommand({ type: "goToChapter", chapterIndex: 1 });
    const chapterSpread = getPageContentEvent(events)!.spread;
    const chapterFirst = firstPageSlot(chapterSpread)!;

    expect(chapterFirst.page.chapterIndex).toBe(1);
    expect(chapterFirst.slotIndex).toBe(0);
  });

  it("uses unloaded gaps in partial states", () => {
    const { events } = createEngine({
      totalChapters: 2,
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    const partial = events.find(
      (e): e is Extract<PaginationEvent, { type: "partialReady" }> =>
        e.type === "partialReady",
    )!;

    const gaps = gapSlots(partial.spread);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.reason === "unloaded")).toBe(true);
  });

  it("uses end-of-book gaps for the final partial spread", () => {
    const { events } = createEngine({
      totalChapters: 1,
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    const ready = getReadyEvent(events)!;
    const gaps = gapSlots(ready.spread);

    expect(gaps).toHaveLength(2);
    expect(gaps.every((g) => g.reason === "end-of-book")).toBe(true);
  });

  it("keeps leaf counters while adding spread counters", () => {
    const { events } = createEngine({
      blocks: makeLongTextBlocks("long-spreads"),
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    const ready = getReadyEvent(events)!;
    expect(ready.spread.currentPage).toBe(1);
    expect(ready.spread.totalPages).toBeGreaterThan(0);
    expect(ready.spread.currentSpread).toBe(1);
    expect(ready.spread.totalSpreads).toBe(
      Math.ceil(ready.spread.totalPages / 3),
    );
  });

  it("updateSpreadConfig re-emits immediately without relayout", () => {
    const { engine, events } = createEngine({
      blocks: makeLongTextBlocks("spread-update"),
      spreadConfig: { columns: 1, chapterFlow: "continuous" },
    });

    const before = getReadyEvent(events)!;
    events.length = 0;

    engine.handleCommand({
      type: "updateSpreadConfig",
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageContent");
    expect(events[0]?.cause).toBe("updateSpreadConfig");

    const pageContent = getPageContentEvent(events)!;
    expect(pageContent.epoch).toBe(before.epoch);
    expect(pageContent.spread.cause).toBe("updateSpreadConfig");
    expect(pageContent.spread.slots.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Anchor preservation across relayout
// ---------------------------------------------------------------------------

describe("anchor preservation across relayout", () => {
  it("keeps relayout anchored to the visible spread after an unresolved page request", async () => {
    const { engine, events } = createEngine({ totalChapters: 2 });

    events.length = 0;
    engine.handleCommand({ type: "goToPage", page: 2 });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageUnavailable");

    events.length = 0;
    await engine.handleCommand({
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 700, height: 900 },
      },
    });

    const partialReadyEvent = getLastEventOfType(events, "partialReady");
    const readyEvent = getReadyEvent(events);

    expect(partialReadyEvent?.spread.currentPage).toBe(1);
    expect(partialReadyEvent?.spread.chapterIndexStart).toBe(0);
    expect(readyEvent?.spread.currentPage).toBe(1);
    expect(readyEvent?.spread.chapterIndexStart).toBe(0);
  });

  it("falls back to the existing anchor when goToChapter targets an unloaded chapter", async () => {
    const { engine, events } = createEngine({ totalChapters: 5 });
    addChapter(engine, 1);
    addChapter(engine, 4);

    engine.handleCommand({ type: "goToChapter", chapterIndex: 1 });
    events.length = 0;

    engine.handleCommand({ type: "goToChapter", chapterIndex: 3 });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("chapterUnavailable");

    events.length = 0;
    await engine.handleCommand({
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 680, height: 820 },
      },
    });

    expect(getChapterOrder(events)).toEqual([1, 0, 4]);
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);
  });

  it("keeps block-anchor fallback behavior when anchor has no text offset", () => {
    const { events } = createEngine({
      blocks: makeLongTextBlocks("text-fallback"),
      initialAnchor: {
        type: "block",
        chapterIndex: 0,
        blockId: "text-fallback",
      },
    });

    const readyEvent = getReadyEvent(events);
    expect(readyEvent).toBeDefined();
    expect(readyEvent?.spread.currentPage).toBe(1);
  });

  it("anchor survives an updatePaginationConfig relayout", async () => {
    const { engine, events } = createEngine({
      blocks: makeLongTextBlocks("anchor-stable"),
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    engine.handleCommand({ type: "nextSpread" });
    const pc = getPageContentEvent(events)!;
    expect(pc.spread.currentSpread).toBe(2);

    events.length = 0;

    await engine.handleCommand({
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 520, height: 900 },
      },
    });

    const readyEvent = getReadyEvent(events)!;
    expect(readyEvent.cause).toBe("updatePaginationConfig");
    expect(readyEvent.spread.cause).toBe("updatePaginationConfig");
    expect(readyEvent.spread.currentPage).toBeGreaterThan(1);
    expect(readyEvent.spread.currentSpread).toBeGreaterThan(1);
  });

  it("rapid pagination config changes keep position stable", async () => {
    const { engine, events } = createEngine({
      blocks: makeLongTextBlocks("anchor-rapid"),
    });

    engine.handleCommand({ type: "nextSpread" });
    events.length = 0;

    await engine.handleCommand({
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 550, height: 880 },
      },
    });
    await engine.handleCommand({
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 600, height: 860 },
      },
    });

    const readyEvents = events.filter(
      (e): e is Extract<PaginationEvent, { type: "ready" }> =>
        e.type === "ready",
    );
    expect(readyEvents.length).toBeGreaterThanOrEqual(1);
    expect(readyEvents.at(-1)!.cause).toBe("updatePaginationConfig");
    expect(readyEvents.at(-1)!.spread.cause).toBe("updatePaginationConfig");
    expect(readyEvents.at(-1)!.spread.currentPage).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Middle-out relayout order
// ---------------------------------------------------------------------------

describe("middle-out relayout order", () => {
  it("relayout starts from the current anchor's chapter", async () => {
    const { engine, events } = createEngine({ totalChapters: 5 });
    for (let i = 1; i < 5; i++) addChapter(engine, i);

    engine.handleCommand({ type: "goToChapter", chapterIndex: 2 });
    events.length = 0;

    await engine.handleCommand({
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 700, height: 900 },
      },
    });

    expect(getChapterOrder(events)).toEqual([2, 3, 1, 4, 0]);
  });

  it("emits one partialReady and one ready per relayout", async () => {
    const { engine, events } = createEngine({ totalChapters: 5 });
    for (let i = 1; i < 5; i++) addChapter(engine, i);
    events.length = 0;

    await engine.handleCommand({
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 700, height: 900 },
      },
    });

    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);
    expect(
      events.every((event) =>
        event.type === "partialReady" ||
        event.type === "progress" ||
        event.type === "ready"
          ? event.cause === "updatePaginationConfig"
          : true,
      ),
    ).toBe(true);
    expect(lastEvent(events)?.type).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// 6. Stale relayout interrupted by a newer one
// ---------------------------------------------------------------------------

describe("stale relayout detection", () => {
  it("aborts an in-progress relayout when a newer config arrives", async () => {
    const { engine, events } = createEngine({ totalChapters: 5 });
    for (let i = 1; i < 5; i++) addChapter(engine, i);

    events.length = 0;

    let layoutEpoch = 1;
    const staleRuntime = createCommandRuntime(
      {
        type: "updatePaginationConfig",
        paginationConfig: BASE_PAGINATION_CONFIG,
      },
      {
        getLayoutEpoch: () => layoutEpoch,
        activeEpoch: 1,
        yieldToEventLoop: async () => {
          layoutEpoch = 2;
        },
        now: () => 0,
        relayoutYieldBudgetMs: 0,
      },
    );

    await engine.handleCommand(
      {
        type: "updatePaginationConfig",
        paginationConfig: {
          ...BASE_PAGINATION_CONFIG,
          viewport: { width: 700, height: 900 },
        },
      },
      staleRuntime,
    );

    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(0);
  });

  it("re-prepares all loaded chapters after a preempted font relayout", async () => {
    const totalChapters = 3;
    const fontOnlyConfig: PaginationConfig = {
      ...BASE_PAGINATION_CONFIG,
      fontConfig: { ...BASE_FONT_CONFIG, baseSizePx: 34 },
      layoutTheme: { ...BASE_LAYOUT_THEME, baseFontSizePx: 34 },
    };
    const finalConfig: PaginationConfig = {
      ...fontOnlyConfig,
      viewport: { width: 430, height: 860 },
    };

    const { engine, events } = createEngine({
      totalChapters,
      blocks: makeLongTextBlocks("bug-repro-0"),
    });
    addChapter(engine, 1, makeLongTextBlocks("bug-repro-1"));
    addChapter(engine, 2, makeLongTextBlocks("bug-repro-2"));

    events.length = 0;

    let isStale = false;
    await engine.handleCommand(
      { type: "updatePaginationConfig", paginationConfig: fontOnlyConfig },
      {
        isStale: () => isStale,
        maybeYield: async () => {
          isStale = true;
        },
      },
    );

    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(0);

    events.length = 0;
    await engine.handleCommand({
      type: "updatePaginationConfig",
      paginationConfig: finalConfig,
    });
    const interruptedReady = getReadyEvent(events);
    expect(interruptedReady).toBeDefined();

    const control = createEngine({
      totalChapters,
      blocks: makeLongTextBlocks("ctrl-0"),
    });
    addChapter(control.engine, 1, makeLongTextBlocks("ctrl-1"));
    addChapter(control.engine, 2, makeLongTextBlocks("ctrl-2"));
    control.events.length = 0;

    await control.engine.handleCommand({
      type: "updatePaginationConfig",
      paginationConfig: finalConfig,
    });
    const cleanReady = getReadyEvent(control.events);
    expect(cleanReady).toBeDefined();

    const getPreparedBodyFontsByChapter = (target: PaginationEngine) => {
      const preparedByChapter = (
        target as unknown as {
          preparedByChapter: Array<Array<{
            type: string;
            items?: Array<{ kind: string; font?: string }>;
          }> | null>;
        }
      ).preparedByChapter;

      return preparedByChapter.map((prepared) => {
        const textBlock = prepared?.find((block) => block.type === "text");
        const textItem = textBlock?.items?.find((item) => item.kind === "text");
        return textItem?.font ?? "";
      });
    };

    const interruptedFonts = getPreparedBodyFontsByChapter(engine);
    const cleanFonts = getPreparedBodyFontsByChapter(control.engine);

    expect(interruptedFonts.every((font) => font.includes("34px"))).toBe(true);
    expect(cleanFonts.every((font) => font.includes("34px"))).toBe(true);
    expect(interruptedFonts).toEqual(cleanFonts);
  });
});

// ---------------------------------------------------------------------------
// 7. updatePaginationConfig no-op when unchanged
// ---------------------------------------------------------------------------

describe("updatePaginationConfig no-op", () => {
  it("emits nothing when config is identical", async () => {
    const { engine, events } = createEngine({ totalChapters: 2 });
    addChapter(engine, 1);
    events.length = 0;

    await engine.handleCommand({
      type: "updatePaginationConfig",
      paginationConfig: BASE_PAGINATION_CONFIG,
    });

    expect(events).toHaveLength(0);
  });

  it("font/layout changes still produce a ready event", async () => {
    const { engine, events } = createEngine({ totalChapters: 2 });
    addChapter(engine, 1);

    events.length = 0;
    await engine.handleCommand({
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        fontConfig: { ...BASE_FONT_CONFIG, baseSizePx: 20 },
        layoutTheme: { ...BASE_LAYOUT_THEME, baseFontSizePx: 20 },
      },
    });

    expect(countEvents(events, "ready")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Epoch contract
// ---------------------------------------------------------------------------

describe("epoch on events", () => {
  it("all non-error events carry the engine epoch", () => {
    const { events } = createEngine({ totalChapters: 2 });
    for (const e of events) {
      if (e.type === "error") continue;
      expect("epoch" in e).toBe(true);
    }
  });

  it("epoch value is reflected on emitted events", () => {
    const events: PaginationEvent[] = [];
    const engine = new PaginationEngine((e) => events.push(e));
    engine.epoch = 5;

    engine.handleCommand({
      type: "init",
      totalChapters: 1,
      paginationConfig: BASE_PAGINATION_CONFIG,
      spreadConfig: BASE_SPREAD_CONFIG,
      initialChapterIndex: 0,
      firstChapterBlocks: makeSpacerBlocks(0),
    });

    const ready = getReadyEvent(events)!;
    expect(ready.epoch).toBe(5);
  });
});

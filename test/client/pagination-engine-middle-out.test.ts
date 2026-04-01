import { PaginationEngine } from "@/lib/pagination/pagination-engine";
import type { PaginationEvent } from "@/lib/pagination/engine-types";
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

const BASE_CONFIG: PaginationConfig = {
  fontConfig: BASE_FONT_CONFIG,
  layoutTheme: BASE_LAYOUT_THEME,
  viewport: { width: 620, height: 860 },
};

function createEngine(totalChapters: number, initialChapterIndex: number) {
  const events: PaginationEvent[] = [];
  const engine = new PaginationEngine((event) => events.push(event));

  engine.handleCommand({
    type: "init",
    totalChapters,
    config: BASE_CONFIG,
    initialChapterIndex,
  });

  return { engine, events };
}

function buildChapterBlocks(chapterIndex: number): Block[] {
  return [
    {
      type: "spacer",
      id: `spacer-${chapterIndex}`,
    },
  ];
}

function addChapter(engine: PaginationEngine, chapterIndex: number): void {
  engine.handleCommand({
    type: "addChapter",
    chapterIndex,
    blocks: buildChapterBlocks(chapterIndex),
  });
}

function getChapterOrder(events: PaginationEvent[]): number[] {
  return events
    .filter(
      (event): event is Extract<PaginationEvent, { chapterIndex: number }> =>
        event.type === "partialReady" || event.type === "progress",
    )
    .map((event) => event.chapterIndex);
}

function countEvents(events: PaginationEvent[], type: PaginationEvent["type"]) {
  return events.filter((event) => event.type === type).length;
}

describe("Pagination engine relayout middle-out prioritization", () => {
  it("goToChapter emits pageContent for a loaded chapter", () => {
    const { engine, events } = createEngine(3, 0);
    addChapter(engine, 0);
    addChapter(engine, 2);

    events.length = 0;
    engine.handleCommand({ type: "goToChapter", chapterIndex: 2 });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageContent");

    if (events[0]?.type === "pageContent") {
      expect(events[0].chapterIndex).toBe(2);
      expect(events[0].globalPage).toBe(2);
    }
  });

  it("goToChapter emits pageUnavailable for an unresolved chapter", () => {
    const { engine, events } = createEngine(3, 0);
    addChapter(engine, 0);

    events.length = 0;
    engine.handleCommand({ type: "goToChapter", chapterIndex: 2 });

    expect(events).toEqual([{ type: "pageUnavailable", globalPage: 2 }]);
  });

  it("emits pageUnavailable until the requested page is resolvable", () => {
    const { engine, events } = createEngine(2, 0);
    addChapter(engine, 0);

    events.length = 0;
    engine.handleCommand({ type: "getPage", globalPage: 2 });

    expect(events).toEqual([{ type: "pageUnavailable", globalPage: 2 }]);

    addChapter(engine, 1);
    events.length = 0;
    engine.handleCommand({ type: "getPage", globalPage: 2 });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageContent");

    if (events[0]?.type === "pageContent") {
      expect(events[0].chapterIndex).toBe(1);
      expect(events[0].globalPage).toBe(2);
    }
  });

  it("keeps relayout anchored to the visible page after an unresolved request", () => {
    const { engine, events } = createEngine(2, 0);
    addChapter(engine, 0);

    events.length = 0;
    engine.handleCommand({ type: "getPage", globalPage: 2 });
    expect(events).toEqual([{ type: "pageUnavailable", globalPage: 2 }]);

    events.length = 0;
    engine.handleCommand({
      type: "updateConfig",
      config: {
        ...BASE_CONFIG,
        viewport: { width: 700, height: 900 },
      },
    });

    const partialReadyEvent = events.find(
      (event): event is Extract<PaginationEvent, { type: "partialReady" }> =>
        event.type === "partialReady",
    );
    const readyEvent = events.find(
      (event): event is Extract<PaginationEvent, { type: "ready" }> =>
        event.type === "ready",
    );

    expect(partialReadyEvent?.resolvedPage).toBe(1);
    expect(partialReadyEvent?.slicesChapterIndex).toBe(0);
    expect(readyEvent?.resolvedPage).toBe(1);
    expect(readyEvent?.slicesChapterIndex).toBe(0);
  });

  it("uses last requested page to center middle-out relayout order", () => {
    const { engine, events } = createEngine(5, 0);
    for (let i = 0; i < 5; i++) addChapter(engine, i);

    events.length = 0;
    engine.handleCommand({ type: "getPage", globalPage: 3 });
    events.length = 0;

    engine.handleCommand({
      type: "updateConfig",
      config: {
        ...BASE_CONFIG,
        viewport: { width: 700, height: 900 },
      },
    });

    expect(getChapterOrder(events)).toEqual([2, 3, 1, 4, 0]);
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);
    expect(events.at(-1)?.type).toBe("ready");
  });

  it("falls back to initial chapter when no page has been requested", () => {
    const { engine, events } = createEngine(5, 2);
    for (let i = 0; i < 5; i++) addChapter(engine, i);

    events.length = 0;
    engine.handleCommand({
      type: "updateConfig",
      config: {
        ...BASE_CONFIG,
        viewport: { width: 660, height: 860 },
      },
    });

    expect(getChapterOrder(events)).toEqual([2, 3, 1, 4, 0]);
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);
  });

  it("starts at nearest available chapter when center chapter is not loaded", () => {
    const { engine, events } = createEngine(5, 2);
    addChapter(engine, 0);
    addChapter(engine, 4);

    events.length = 0;
    engine.handleCommand({
      type: "updateConfig",
      config: {
        ...BASE_CONFIG,
        viewport: { width: 680, height: 820 },
      },
    });

    expect(getChapterOrder(events)).toEqual([4, 0]);
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "progress")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);
  });

  it("emits progressive updates and one final ready for font and theme relayout", () => {
    const { engine, events } = createEngine(5, 0);
    for (let i = 0; i < 5; i++) addChapter(engine, i);

    events.length = 0;
    engine.handleCommand({ type: "getPage", globalPage: 4 });
    events.length = 0;

    engine.handleCommand({
      type: "updateConfig",
      config: {
        ...BASE_CONFIG,
        fontConfig: {
          ...BASE_FONT_CONFIG,
          baseSizePx: 18,
        },
      },
    });

    expect(getChapterOrder(events)).toEqual([3, 4, 2, 1, 0]);
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);

    events.length = 0;
    engine.handleCommand({
      type: "updateConfig",
      config: {
        ...BASE_CONFIG,
        layoutTheme: {
          ...BASE_LAYOUT_THEME,
          paragraphSpacingFactor: 1.3,
        },
      },
    });

    expect(getChapterOrder(events)).toEqual([3, 4, 2, 1, 0]);
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);
    expect(events.at(-1)?.type).toBe("ready");
  });

  it("ignores updateConfig when config has not changed", () => {
    const { engine, events } = createEngine(2, 0);
    addChapter(engine, 0);
    addChapter(engine, 1);

    events.length = 0;
    engine.handleCommand({
      type: "updateConfig",
      config: BASE_CONFIG,
    });

    expect(events).toHaveLength(0);
  });
});

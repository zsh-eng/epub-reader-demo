import { PaginationTracer, type PaginationTracerSnapshot } from "@/lib/pagination";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

describe("PaginationTracer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("publishes command history updates immediately", () => {
    const tracer = new PaginationTracer(12);
    const notifications: number[] = [];

    const unsubscribe = tracer.subscribe(() => {
      notifications.push(tracer.getSnapshot().commandHistory.length);
    });

    tracer.recordPostedCommand({ type: "getPage", globalPage: 3 });
    const afterFirstCommand = tracer.getSnapshot().commandHistory;
    expect(afterFirstCommand).toHaveLength(1);
    expect(afterFirstCommand[0]?.summary).toContain("page=3");

    tracer.recordPostedCommand(
      {
        type: "init",
        totalChapters: 8,
        config: BASE_CONFIG,
        initialChapterIndex: 2,
      },
      { immediate: true },
    );

    const afterInit = tracer.getSnapshot().commandHistory;
    expect(afterInit).toHaveLength(1);
    expect(afterInit[0]?.type).toBe("init");
    expect(afterInit[0]?.summary).toContain("chapters=8");
    expect(notifications.length).toBeGreaterThanOrEqual(2);

    unsubscribe();
  });

  it("owns command id sequencing across resets", () => {
    const tracer = new PaginationTracer(12);

    tracer.recordPostedCommand(
      { type: "getPage", globalPage: 1 },
      { immediate: true },
    );

    const firstId = tracer.getSnapshot().commandHistory[0]?.id;
    expect(firstId).toBeDefined();

    tracer.reset();

    tracer.recordPostedCommand(
      { type: "getPage", globalPage: 2 },
      { immediate: true },
    );

    const secondId = tracer.getSnapshot().commandHistory[0]?.id;
    expect(secondId).toBeDefined();

    const firstSeq = Number(firstId?.split("-").at(-1));
    const secondSeq = Number(secondId?.split("-").at(-1));
    expect(secondSeq).toBeGreaterThan(firstSeq);
  });

  it("publishes diagnostics and traces through snapshot subscribers", () => {
    const tracer = new PaginationTracer(12);
    const notifications: PaginationTracerSnapshot[] = [];

    const unsubscribe = tracer.subscribe(() => {
      notifications.push(tracer.getSnapshot());
    });

    tracer.recordStage1(0, 4);
    tracer.finalizeChapter(0, {
      chapterIndex: 0,
      blockCount: 10,
      lineCount: 20,
      pageCount: 2,
      stage2PrepareMs: 3,
      stage3LayoutMs: 5,
    });
    tracer.updateDiagnostics(null);

    const diagnostics = tracer.getSnapshot().diagnostics;
    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.chapterCount).toBe(1);
    expect(diagnostics?.stage1ParseMs).toBe(4);

    tracer.beginFontSwitch(BASE_CONFIG);
    expect(tracer.getSnapshot().fontSwitchLatencyTraces).toHaveLength(1);

    tracer.reset();

    const snapshot = tracer.getSnapshot();
    expect(snapshot.diagnostics).toBeNull();
    expect(snapshot.fontSwitchLatencyTraces).toHaveLength(0);
    expect(snapshot.commandHistory).toHaveLength(0);
    expect(notifications.length).toBeGreaterThanOrEqual(3);

    unsubscribe();
  });

  it("cleanup does not clear immediate command history updates", () => {
    const tracer = new PaginationTracer(12);
    const onChange = vi.fn();

    tracer.subscribe(onChange);
    tracer.recordPostedCommand({ type: "getPage", globalPage: 3 });
    tracer.cleanup();

    vi.advanceTimersByTime(500);

    expect(tracer.getSnapshot().commandHistory).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

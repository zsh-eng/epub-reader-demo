import type {
  PaginationChapterDiagnostics,
  PaginationConfig,
  PaginationDiagnostics,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FontSwitchLatencyIntent {
  from: string;
  to: string;
  startedAtMs: number;
}

export interface PaginationFontSwitchLatencyTrace {
  id: string;
  status: "running" | "ready" | "superseded";
  startedAtMs: number;
  intentAtMs: number | null;
  fromFont: string | null;
  toFont: string | null;
  commandPostedAtMs: number;
  firstPartialAtMs: number | null;
  firstProgressAtMs: number | null;
  readyAtMs: number | null;
  paintedAtMs: number | null;
  partialEvents: number;
  progressEvents: number;
  bodyFontLoadedAtStart: boolean | null;
  bodyFontLoadedAtReady: boolean | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFontLoaded(bodyFamily: string): boolean | null {
  if (typeof document === "undefined") return null;
  if (!("fonts" in document)) return null;
  if (typeof document.fonts.check !== "function") return null;
  return document.fonts.check(`16px ${bodyFamily}`);
}

// ---------------------------------------------------------------------------
// PaginationTracer
// ---------------------------------------------------------------------------

export class PaginationTracer {
  private stage1ByChapter = new Map<number, number>();
  private chapterQueuedAt = new Map<number, number>();
  private chapterLoadByChapter = new Map<number, number>();
  private workerChapterDiagnostics = new Map<
    number,
    PaginationChapterDiagnostics
  >();

  private fontSwitchIntent: FontSwitchLatencyIntent | null = null;
  private activeFontSwitchTraceId: string | null = null;
  private traceSequence = 0;
  private traces: PaginationFontSwitchLatencyTrace[] = [];
  private flushTimer: number | null = null;

  private readonly maxTraces: number;
  private readonly onFlush: (
    traces: PaginationFontSwitchLatencyTrace[],
  ) => void;

  constructor(
    maxTraces: number,
    onFlush: (traces: PaginationFontSwitchLatencyTrace[]) => void,
  ) {
    this.maxTraces = maxTraces;
    this.onFlush = onFlush;
  }

  // -------------------------------------------------------------------------
  // Chapter timing
  // -------------------------------------------------------------------------

  recordChapterQueued(chapterIndex: number): void {
    this.chapterQueuedAt.set(chapterIndex, performance.now());
  }

  recordStage1(chapterIndex: number, ms: number): void {
    this.stage1ByChapter.set(chapterIndex, ms);
  }

  finalizeChapter(
    chapterIndex: number,
    diag: PaginationChapterDiagnostics | null,
  ): void {
    if (diag) {
      this.workerChapterDiagnostics.set(chapterIndex, diag);
    }

    const queuedAt = this.chapterQueuedAt.get(chapterIndex);
    if (queuedAt === undefined) return;

    this.chapterLoadByChapter.set(chapterIndex, performance.now() - queuedAt);
    this.chapterQueuedAt.delete(chapterIndex);
  }

  // -------------------------------------------------------------------------
  // Font switch tracing
  // -------------------------------------------------------------------------

  recordIntent(from: string, to: string): void {
    this.fontSwitchIntent = { from, to, startedAtMs: performance.now() };
  }

  beginFontSwitch(config: PaginationConfig): void {
    const now = performance.now();
    this.traceSequence += 1;
    const traceId = `font-switch-${Date.now()}-${this.traceSequence}`;

    const activeId = this.activeFontSwitchTraceId;
    if (activeId) {
      this.updateTrace(activeId, (t) =>
        t.status !== "running" ? t : { ...t, status: "superseded" },
      );
    }

    const intent = this.fontSwitchIntent;
    this.fontSwitchIntent = null;

    const trace: PaginationFontSwitchLatencyTrace = {
      id: traceId,
      status: "running",
      startedAtMs: now,
      intentAtMs: intent?.startedAtMs ?? null,
      fromFont: intent?.from ?? null,
      toFont: intent?.to ?? null,
      commandPostedAtMs: now,
      firstPartialAtMs: null,
      firstProgressAtMs: null,
      readyAtMs: null,
      paintedAtMs: null,
      partialEvents: 0,
      progressEvents: 0,
      bodyFontLoadedAtStart: readFontLoaded(config.fontConfig.bodyFamily),
      bodyFontLoadedAtReady: null,
    };

    this.traces = [trace, ...this.traces].slice(0, this.maxTraces);
    this.activeFontSwitchTraceId = traceId;
    this.scheduleFlush(true);
  }

  markActive(
    apply: (
      t: PaginationFontSwitchLatencyTrace,
    ) => PaginationFontSwitchLatencyTrace,
    immediate = false,
  ): void {
    const id = this.activeFontSwitchTraceId;
    if (!id) return;
    this.updateTrace(id, apply);
    this.scheduleFlush(immediate);
  }

  markReady(bodyFamily: string): void {
    const activeId = this.activeFontSwitchTraceId;
    if (!activeId) return;

    const readyAtMs = performance.now();
    this.updateTrace(activeId, (t) => ({
      ...t,
      status: "ready",
      readyAtMs,
      bodyFontLoadedAtReady: readFontLoaded(bodyFamily),
    }));
    this.activeFontSwitchTraceId = null;
    this.scheduleFlush(true);
    this.schedulePaintProbe(activeId);
  }

  schedulePaintProbe(traceId: string): void {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const paintedAtMs = performance.now();
        this.updateTrace(traceId, (t) => {
          if (t.paintedAtMs !== null) return t;
          return { ...t, paintedAtMs };
        });
        this.scheduleFlush(true);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  reset(): void {
    this.stage1ByChapter.clear();
    this.chapterQueuedAt.clear();
    this.chapterLoadByChapter.clear();
    this.workerChapterDiagnostics.clear();
    this.fontSwitchIntent = null;
    this.activeFontSwitchTraceId = null;
    this.traces = [];
  }

  cleanup(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Read outputs
  // -------------------------------------------------------------------------

  getTraces(): PaginationFontSwitchLatencyTrace[] {
    return this.traces;
  }

  getDiagnostics(
    base: PaginationDiagnostics | null,
  ): PaginationDiagnostics | null {
    const chapterMap = new Map<number, PaginationChapterDiagnostics>();

    for (const chapter of base?.chapterTimings ?? []) {
      chapterMap.set(chapter.chapterIndex, chapter);
    }

    for (const [chapterIndex, chapter] of this.workerChapterDiagnostics) {
      chapterMap.set(chapterIndex, chapter);
    }

    if (chapterMap.size === 0) {
      if (!base) return null;
      return {
        ...base,
        stage1ParseMs: 0,
        stage2PrepareMs: base.stage2PrepareMs ?? 0,
        stage3LayoutMs: base.stage3LayoutMs ?? 0,
        totalMs:
          (base.stage1ParseMs ?? 0) +
          (base.stage2PrepareMs ?? 0) +
          (base.stage3LayoutMs ?? 0),
        chapterCount: 0,
        chapterTimings: [],
      };
    }

    const chapterTimings = Array.from(chapterMap.values())
      .sort((a, b) => a.chapterIndex - b.chapterIndex)
      .map((chapter) => {
        const stage1ParseMs =
          this.stage1ByChapter.get(chapter.chapterIndex) ??
          chapter.stage1ParseMs ??
          0;
        const stage2PrepareMs = chapter.stage2PrepareMs ?? 0;
        const stage3LayoutMs = chapter.stage3LayoutMs ?? 0;
        const totalMs = stage1ParseMs + stage2PrepareMs + stage3LayoutMs;
        const chapterLoadMs =
          this.chapterLoadByChapter.get(chapter.chapterIndex) ??
          chapter.chapterLoadMs ??
          totalMs;

        return {
          ...chapter,
          stage1ParseMs,
          stage2PrepareMs,
          stage3LayoutMs,
          totalMs,
          chapterLoadMs,
        };
      });

    const blockCount = chapterTimings.reduce(
      (sum, chapter) => sum + chapter.blockCount,
      0,
    );
    const lineCount = chapterTimings.reduce(
      (sum, chapter) => sum + chapter.lineCount,
      0,
    );
    const stage1ParseMs = chapterTimings.reduce(
      (sum, chapter) => sum + (chapter.stage1ParseMs ?? 0),
      0,
    );
    const stage2PrepareMs = chapterTimings.reduce(
      (sum, chapter) => sum + (chapter.stage2PrepareMs ?? 0),
      0,
    );
    const stage3LayoutMs = chapterTimings.reduce(
      (sum, chapter) => sum + (chapter.stage3LayoutMs ?? 0),
      0,
    );
    const computeMs = stage2PrepareMs + stage3LayoutMs;

    return {
      ...(base ?? { blockCount: 0, lineCount: 0, computeMs: 0 }),
      blockCount,
      lineCount,
      computeMs,
      stage1ParseMs,
      stage2PrepareMs,
      stage3LayoutMs,
      totalMs: stage1ParseMs + stage2PrepareMs + stage3LayoutMs,
      chapterCount: chapterTimings.length,
      chapterTimings,
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private updateTrace(
    id: string,
    apply: (
      t: PaginationFontSwitchLatencyTrace,
    ) => PaginationFontSwitchLatencyTrace,
  ): void {
    this.traces = this.traces.map((t) => (t.id === id ? apply(t) : t));
  }

  private scheduleFlush(immediate: boolean): void {
    if (immediate) {
      if (this.flushTimer !== null) {
        window.clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.onFlush([...this.traces]);
      return;
    }

    if (this.flushTimer !== null) return;

    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.onFlush([...this.traces]);
    }, 80);
  }
}

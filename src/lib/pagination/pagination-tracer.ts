import {
    nextPaginationCommandHistory,
    type PaginationCommandHistoryEntry,
} from "./command-history";
import type { PaginationCommand } from "./engine-types";
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

interface RecordPostedCommandOptions {
  immediate?: boolean;
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

export interface PaginationTracerSnapshot {
  diagnostics: PaginationDiagnostics | null;
  fontSwitchLatencyTraces: PaginationFontSwitchLatencyTrace[];
  commandHistory: PaginationCommandHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACE_FLUSH_DELAY_MS = 80;
const COMMAND_HISTORY_FLUSH_DELAY_MS = 120;
const MAX_FONT_SWITCH_LATENCY_TRACES = 12;

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
  private commandSequence = 0;

  private traces: PaginationFontSwitchLatencyTrace[] = [];
  private traceFlushTimer: number | null = null;
  private pendingCommandHistory: PaginationCommandHistoryEntry[] | null = null;
  private commandHistoryFlushTimer: number | null = null;

  private snapshot: PaginationTracerSnapshot = {
    diagnostics: null,
    fontSwitchLatencyTraces: [],
    commandHistory: [],
  };
  private listeners = new Set<() => void>();

  private readonly maxTraces: number;

  constructor(maxTraces: number = MAX_FONT_SWITCH_LATENCY_TRACES) {
    this.maxTraces = maxTraces;
  }

  // -------------------------------------------------------------------------
  // External store API
  // -------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PaginationTracerSnapshot => {
    return this.snapshot;
  };

  // -------------------------------------------------------------------------
  // Command history
  // -------------------------------------------------------------------------

  recordPostedCommand(
    command: PaginationCommand,
    options: RecordPostedCommandOptions = {},
  ): void {
    this.commandSequence += 1;
    this.pendingCommandHistory = nextPaginationCommandHistory(
      this.pendingCommandHistory ?? this.snapshot.commandHistory,
      command,
      this.commandSequence,
    );

    this.scheduleCommandHistoryFlush(options.immediate ?? command.type === "init");
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
    this.scheduleTraceFlush(true);
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
    this.scheduleTraceFlush(immediate);
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
    this.scheduleTraceFlush(true);
    this.schedulePaintProbe(activeId);
  }

  schedulePaintProbe(traceId: string): void {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const paintedAtMs = performance.now();
        this.updateTrace(traceId, (t) => {
          if (t.paintedAtMs !== null) return t;
          return { ...t, paintedAtMs };
        });
        this.scheduleTraceFlush(true);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  updateDiagnostics(base: PaginationDiagnostics | null): void {
    const diagnostics = this.buildDiagnostics(base);
    if (diagnostics === null && this.snapshot.diagnostics === null) return;

    this.snapshot = {
      ...this.snapshot,
      diagnostics,
    };
    this.emitChange();
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
    this.pendingCommandHistory = null;

    if (this.traceFlushTimer !== null) {
      window.clearTimeout(this.traceFlushTimer);
      this.traceFlushTimer = null;
    }

    if (this.commandHistoryFlushTimer !== null) {
      window.clearTimeout(this.commandHistoryFlushTimer);
      this.commandHistoryFlushTimer = null;
    }

    const hadDebugState =
      this.snapshot.diagnostics !== null ||
      this.snapshot.fontSwitchLatencyTraces.length > 0 ||
      this.snapshot.commandHistory.length > 0;

    this.snapshot = {
      diagnostics: null,
      fontSwitchLatencyTraces: [],
      commandHistory: [],
    };

    if (hadDebugState) {
      this.emitChange();
    }
  }

  cleanup(): void {
    if (this.traceFlushTimer !== null) {
      window.clearTimeout(this.traceFlushTimer);
      this.traceFlushTimer = null;
    }

    if (this.commandHistoryFlushTimer !== null) {
      window.clearTimeout(this.commandHistoryFlushTimer);
      this.commandHistoryFlushTimer = null;
    }
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

  private scheduleTraceFlush(immediate: boolean): void {
    if (immediate) {
      if (this.traceFlushTimer !== null) {
        window.clearTimeout(this.traceFlushTimer);
        this.traceFlushTimer = null;
      }
      this.flushTraces();
      return;
    }

    if (this.traceFlushTimer !== null) return;

    this.traceFlushTimer = window.setTimeout(() => {
      this.traceFlushTimer = null;
      this.flushTraces();
    }, TRACE_FLUSH_DELAY_MS);
  }

  private flushTraces(): void {
    this.snapshot = {
      ...this.snapshot,
      fontSwitchLatencyTraces: [...this.traces],
    };
    this.emitChange();
  }

  private scheduleCommandHistoryFlush(immediate: boolean): void {
    if (immediate) {
      if (this.commandHistoryFlushTimer !== null) {
        window.clearTimeout(this.commandHistoryFlushTimer);
        this.commandHistoryFlushTimer = null;
      }
      this.flushCommandHistory();
      return;
    }

    if (this.commandHistoryFlushTimer !== null) return;

    this.commandHistoryFlushTimer = window.setTimeout(() => {
      this.commandHistoryFlushTimer = null;
      this.flushCommandHistory();
    }, COMMAND_HISTORY_FLUSH_DELAY_MS);
  }

  private flushCommandHistory(): void {
    if (!this.pendingCommandHistory) return;

    this.snapshot = {
      ...this.snapshot,
      commandHistory: this.pendingCommandHistory,
    };
    this.pendingCommandHistory = null;
    this.emitChange();
  }

  private buildDiagnostics(
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

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

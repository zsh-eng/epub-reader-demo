import type {
    PaginationChapterDiagnostics,
    PaginationDiagnostics,
} from "../shared/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginationRunTimings {
  startedAtMs: number | null;
  firstVisibleAtMs: number | null;
  readyAtMs: number | null;
  timeToFirstVisibleMs: number | null;
  timeToReadyMs: number | null;
}

export interface PaginationTracerSnapshot {
  diagnostics: PaginationDiagnostics | null;
  timings: PaginationRunTimings;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_TIMINGS: PaginationRunTimings = {
  startedAtMs: null,
  firstVisibleAtMs: null,
  readyAtMs: null,
  timeToFirstVisibleMs: null,
  timeToReadyMs: null,
};

// ---------------------------------------------------------------------------
// PaginationTracer
// ---------------------------------------------------------------------------

/**
 * Small external store for reader diagnostics.
 *
 * It intentionally tracks only the timings we use to compare startup behavior:
 * time from pagination init to the first visible spread, time until all
 * chapters are ready, and aggregate worker stage totals.
 */
export class PaginationTracer {
  private chapterDiagnostics = new Map<number, PaginationChapterDiagnostics>();

  private snapshot: PaginationTracerSnapshot = {
    diagnostics: null,
    timings: EMPTY_TIMINGS,
  };
  private listeners = new Set<() => void>();

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
  // Run timings
  // -------------------------------------------------------------------------

  startRun(): void {
    this.chapterDiagnostics.clear();
    this.snapshot = {
      diagnostics: null,
      timings: {
        ...EMPTY_TIMINGS,
        startedAtMs: performance.now(),
      },
    };
    this.emitChange();
  }

  markFirstVisible(): void {
    const startedAtMs = this.snapshot.timings.startedAtMs;
    if (startedAtMs === null || this.snapshot.timings.firstVisibleAtMs !== null) {
      return;
    }

    const firstVisibleAtMs = performance.now();
    this.snapshot = {
      ...this.snapshot,
      timings: {
        ...this.snapshot.timings,
        firstVisibleAtMs,
        timeToFirstVisibleMs: firstVisibleAtMs - startedAtMs,
      },
    };
    this.emitChange();
  }

  markReady(): void {
    const startedAtMs = this.snapshot.timings.startedAtMs;
    if (startedAtMs === null || this.snapshot.timings.readyAtMs !== null) {
      return;
    }

    const readyAtMs = performance.now();
    const firstVisibleAtMs =
      this.snapshot.timings.firstVisibleAtMs ?? readyAtMs;

    this.snapshot = {
      ...this.snapshot,
      timings: {
        ...this.snapshot.timings,
        firstVisibleAtMs,
        readyAtMs,
        timeToFirstVisibleMs: firstVisibleAtMs - startedAtMs,
        timeToReadyMs: readyAtMs - startedAtMs,
      },
    };
    this.emitChange();
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  recordChapterDiagnostics(
    diagnostics: PaginationChapterDiagnostics | null | undefined,
  ): void {
    if (!diagnostics) return;

    this.chapterDiagnostics.set(diagnostics.chapterIndex, diagnostics);
    this.publishDiagnostics();
  }

  recordChapterDiagnosticsList(
    diagnostics: readonly PaginationChapterDiagnostics[],
  ): void {
    for (const diagnostic of diagnostics) {
      this.chapterDiagnostics.set(diagnostic.chapterIndex, diagnostic);
    }
    this.publishDiagnostics();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  reset(): void {
    this.chapterDiagnostics.clear();

    const hadDebugState =
      this.snapshot.diagnostics !== null ||
      this.snapshot.timings.startedAtMs !== null;

    this.snapshot = {
      diagnostics: null,
      timings: EMPTY_TIMINGS,
    };

    if (hadDebugState) {
      this.emitChange();
    }
  }

  cleanup(): void {
    // No-op: tracer publishes changes immediately.
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private publishDiagnostics(): void {
    this.snapshot = {
      ...this.snapshot,
      diagnostics: this.buildDiagnostics(),
    };
    this.emitChange();
  }

  private buildDiagnostics(): PaginationDiagnostics | null {
    if (this.chapterDiagnostics.size === 0) return null;

    const chapterTimings = Array.from(this.chapterDiagnostics.values()).sort(
      (a, b) => a.chapterIndex - b.chapterIndex,
    );

    const blockCount = chapterTimings.reduce(
      (sum, chapter) => sum + chapter.blockCount,
      0,
    );
    const lineCount = chapterTimings.reduce(
      (sum, chapter) => sum + chapter.lineCount,
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
    const totalMs = stage2PrepareMs + stage3LayoutMs;

    return {
      blockCount,
      lineCount,
      computeMs: totalMs,
      stage2PrepareMs,
      stage3LayoutMs,
      totalMs,
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

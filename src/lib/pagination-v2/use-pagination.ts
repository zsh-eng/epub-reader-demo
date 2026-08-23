import { useCallback, useEffect, useRef, useState } from "react";
import {
  endReaderTraceSpan,
  startReaderTraceSpan,
  type ReaderTraceSpanToken,
} from "@/lib/reader-performance-trace";
import { PaginationTracer } from "./diagnostics/tracer";
import type { PaginationCommand, PaginationEvent } from "./protocol";
import type {
  Block,
  ContentAnchor,
  PaginationChapterDiagnostics,
  PaginationConfig,
  PaginationStatus,
  ResolvedSpread,
  SpreadConfig,
  SpreadIntent,
} from "./types";
import { DEFAULT_SPREAD_CONFIG } from "./types";

const REPLACE_INTENT: SpreadIntent = { kind: "replace" };
const FORWARD_LINEAR_INTENT: SpreadIntent = {
  kind: "linear",
  direction: "forward",
};
const BACKWARD_LINEAR_INTENT: SpreadIntent = {
  kind: "linear",
  direction: "backward",
};

function addPendingChapterPageCount(
  pendingCounts: Map<number, number>,
  diagnostics: PaginationChapterDiagnostics | null | undefined,
): void {
  if (!diagnostics) return;
  pendingCounts.set(diagnostics.chapterIndex, diagnostics.pageCount);
}

function mergeChapterPageCounts(
  previousCounts: Map<number, number>,
  nextChapterCounts: ReadonlyMap<number, number>,
): Map<number, number> {
  if (nextChapterCounts.size === 0) return previousCounts;

  let nextCounts: Map<number, number> | null = null;
  for (const [chapterIndex, pageCount] of nextChapterCounts) {
    if (previousCounts.get(chapterIndex) === pageCount) continue;
    nextCounts ??= new Map(previousCounts);
    nextCounts.set(chapterIndex, pageCount);
  }

  return nextCounts ?? previousCounts;
}

function roundTraceMilliseconds(value: number): number {
  return Math.round(value * 10) / 10;
}

function getWorkerTraceDetails(
  event: PaginationEvent,
  roundTripStartedAtMs: number | null,
): Record<string, number> {
  if (
    (event.type !== "partialReady" && event.type !== "ready") ||
    !event.workerTiming
  ) {
    return {};
  }

  const activeMs = roundTraceMilliseconds(event.workerTiming.activeMs);
  const elapsedMs = roundTraceMilliseconds(event.workerTiming.elapsedMs);
  const roundTripMs =
    roundTripStartedAtMs === null
      ? elapsedMs
      : performance.now() - roundTripStartedAtMs;
  return {
    workerActiveMs: activeMs,
    workerWaitMs: Math.max(0, roundTraceMilliseconds(elapsedMs - activeMs)),
    outsideWorkerMs: Math.max(
      0,
      roundTraceMilliseconds(roundTripMs - elapsedMs),
    ),
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsePaginationResult {
  spread: ResolvedSpread | null;
  status: PaginationStatus;
  /** Maps chapterIndex → page count, published with visible partials and final ready. */
  chapterPageCounts: Map<number, number>;

  nextSpread: () => void;
  prevSpread: () => void;
  goToPage: (page: number, options: { intent: SpreadIntent }) => void;
  goToChapter: (
    chapterIndex: number,
    options: { intent: SpreadIntent },
  ) => void;
  goToTarget: (
    chapterIndex: number,
    targetId: string,
    options: { intent: SpreadIntent },
  ) => void;

  init: (options: {
    totalChapters: number;
    initialChapterIndex: number;
    initialChapterProgress?: number;
    initialAnchor?: ContentAnchor;
    intent?: SpreadIntent;
    firstChapterBlocks: Block[];
  }) => void;
  /** Called by the shell once per chapter after HTML processing is complete. */
  addChapter: (chapterIndex: number, blocks: Block[]) => void;
  /** Called to relayout a single already-loaded chapter after content updates. */
  updateChapter: (chapterIndex: number, blocks: Block[]) => void;

  tracer: PaginationTracer;
}

export interface UsePaginationOptions {
  paginationConfig: PaginationConfig;
  spreadConfig?: SpreadConfig;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePagination(
  options: UsePaginationOptions,
): UsePaginationResult {
  const { paginationConfig, spreadConfig = DEFAULT_SPREAD_CONFIG } = options;

  const [spread, setSpread] = useState<ResolvedSpread | null>(null);
  const [status, setStatus] = useState<PaginationStatus>("idle");
  const [chapterPageCounts, setChapterPageCounts] = useState<
    Map<number, number>
  >(new Map());

  const workerRef = useRef<Worker | null>(null);
  const currentEpochRef = useRef(0);
  const tracerRef = useRef(new PaginationTracer());
  const pendingChapterPageCountsRef = useRef<Map<number, number>>(new Map());
  const workerStartupSpanRef = useRef<ReaderTraceSpanToken | null>(null);
  const publisherFontsSpanRef = useRef<ReaderTraceSpanToken | null>(null);
  const firstSpreadSpanRef = useRef<ReaderTraceSpanToken | null>(null);
  const allChaptersSpanRef = useRef<ReaderTraceSpanToken | null>(null);
  const firstSpreadRoundTripStartedAtRef = useRef<number | null>(null);
  const allChaptersRoundTripStartedAtRef = useRef<number | null>(null);

  // Keep config in a ref so init and config update effects can read the
  // latest value without capturing it as a closure dependency.
  const paginationConfigRef = useRef<PaginationConfig>(paginationConfig);
  paginationConfigRef.current = paginationConfig;

  const spreadConfigRef = useRef<SpreadConfig>(spreadConfig);
  spreadConfigRef.current = spreadConfig;

  // Keep config refs so the config update effects can detect changes.
  const prevPaginationConfigRef = useRef<PaginationConfig | null>(null);
  const prevSpreadConfigRef = useRef<SpreadConfig | null>(null);

  const postCommand = useCallback((cmd: PaginationCommand) => {
    workerRef.current?.postMessage(cmd);
  }, []);

  const recordChapterPageCount = useCallback(
    (diagnostics: PaginationChapterDiagnostics | null | undefined) => {
      addPendingChapterPageCount(
        pendingChapterPageCountsRef.current,
        diagnostics,
      );
    },
    [],
  );

  const publishChapterPageCounts = useCallback(
    (diagnostics: readonly PaginationChapterDiagnostics[]) => {
      for (const diagnostic of diagnostics) {
        recordChapterPageCount(diagnostic);
      }

      const pendingCounts = pendingChapterPageCountsRef.current;
      if (pendingCounts.size === 0) return;

      const nextChapterCounts = new Map(pendingCounts);
      pendingCounts.clear();

      setChapterPageCounts((prev) =>
        mergeChapterPageCounts(prev, nextChapterCounts),
      );
    },
    [recordChapterPageCount],
  );

  useEffect(() => {
    const tracer = tracerRef.current;

    return () => {
      tracer.cleanup();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Worker lifecycle
  // -------------------------------------------------------------------------

  const handleEvent = (event: PaginationEvent) => {
    // Discard events from previous layout epochs.
    if ("epoch" in event && event.epoch < currentEpochRef.current) return;
    if ("epoch" in event) currentEpochRef.current = event.epoch;

    switch (event.type) {
      case "trace":
        if (event.name === "worker-fonts-ready") {
          endReaderTraceSpan(workerStartupSpanRef.current);
          workerStartupSpanRef.current = null;
          break;
        }
        endReaderTraceSpan(publisherFontsSpanRef.current);
        publisherFontsSpanRef.current = null;
        break;

      case "partialReady": {
        const partialWorkerDetails = getWorkerTraceDetails(
          event,
          firstSpreadRoundTripStartedAtRef.current,
        );
        currentEpochRef.current = event.epoch;
        tracerRef.current.markFirstVisible();
        tracerRef.current.recordChapterDiagnostics(event.chapterDiagnostics);
        recordChapterPageCount(event.chapterDiagnostics);
        setSpread(event.spread);
        setStatus("partial");
        endReaderTraceSpan(firstSpreadSpanRef.current, {
          readiness: "partial",
          totalPagesKnown: event.spread.totalPages,
          ...partialWorkerDetails,
        });
        firstSpreadSpanRef.current = null;
        firstSpreadRoundTripStartedAtRef.current = null;
        publishChapterPageCounts([]);
        break;
      }

      case "ready": {
        const firstWorkerDetails = getWorkerTraceDetails(
          event,
          firstSpreadRoundTripStartedAtRef.current,
        );
        const allWorkerDetails = getWorkerTraceDetails(
          event,
          allChaptersRoundTripStartedAtRef.current,
        );
        currentEpochRef.current = event.epoch;
        tracerRef.current.markReady();
        tracerRef.current.recordChapterDiagnosticsList(
          event.chapterDiagnostics,
        );
        setSpread(event.spread);
        setStatus("ready");
        endReaderTraceSpan(firstSpreadSpanRef.current, {
          readiness: "complete",
          totalPagesKnown: event.spread.totalPages,
          ...firstWorkerDetails,
        });
        firstSpreadSpanRef.current = null;
        firstSpreadRoundTripStartedAtRef.current = null;
        endReaderTraceSpan(allChaptersSpanRef.current, {
          totalPages: event.spread.totalPages,
          chapterCount: event.chapterDiagnostics.length,
          ...allWorkerDetails,
        });
        allChaptersSpanRef.current = null;
        allChaptersRoundTripStartedAtRef.current = null;
        publishChapterPageCounts(event.chapterDiagnostics);
        break;
      }

      case "progress":
        tracerRef.current.recordChapterDiagnostics(event.chapterDiagnostics);
        recordChapterPageCount(event.chapterDiagnostics);
        break;

      case "pageContent":
        setSpread(event.spread);
        break;

      case "pageUnavailable":
      case "chapterUnavailable":
        // Keep current page as-is.
        break;

      case "error":
        endReaderTraceSpan(
          firstSpreadSpanRef.current,
          { error: event.message },
          "error",
        );
        firstSpreadSpanRef.current = null;
        firstSpreadRoundTripStartedAtRef.current = null;
        endReaderTraceSpan(
          allChaptersSpanRef.current,
          { error: event.message },
          "error",
        );
        allChaptersSpanRef.current = null;
        allChaptersRoundTripStartedAtRef.current = null;
        console.error("[pagination worker]", event.message);
        break;
    }
  };

  // Keep a ref so the worker's onmessage always calls the latest handler
  // without the worker effect needing to depend on it (which would terminate
  // and recreate the worker whenever the handler's identity changed).
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  useEffect(() => {
    workerStartupSpanRef.current = startReaderTraceSpan(
      "pagination-worker-fonts",
      "assets",
    );
    const worker = new Worker(
      new URL("./worker/pagination.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (e: MessageEvent<PaginationEvent>) => {
      handleEventRef.current(e.data);
    };

    worker.onerror = (e) => {
      console.error("[pagination worker error]", e);
    };

    workerRef.current = worker;

    return () => {
      endReaderTraceSpan(workerStartupSpanRef.current, {
        terminatedBeforeReady: true,
      });
      workerStartupSpanRef.current = null;
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Config updates
  // -------------------------------------------------------------------------

  useEffect(() => {
    const prev = prevPaginationConfigRef.current;
    prevPaginationConfigRef.current = paginationConfig;

    if (!prev) return; // init hasn't been called yet — config will be sent with init.

    setStatus((s) => (s === "idle" ? s : "recalculating"));
    postCommand({
      type: "updatePaginationConfig",
      paginationConfig,
    });
  }, [paginationConfig, postCommand]);

  useEffect(() => {
    const prev = prevSpreadConfigRef.current;
    prevSpreadConfigRef.current = spreadConfig;

    if (!prev) return; // init hasn't been called yet — config will be sent with init.

    postCommand({
      type: "updateSpreadConfig",
      spreadConfig,
    });
  }, [spreadConfig, postCommand]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const init = useCallback(
    (opts: {
      totalChapters: number;
      initialChapterIndex: number;
      initialChapterProgress?: number;
      initialAnchor?: ContentAnchor;
      intent?: SpreadIntent;
      firstChapterBlocks: Block[];
    }) => {
      const currentPaginationConfig = paginationConfigRef.current;
      const currentSpreadConfig = spreadConfigRef.current;
      currentEpochRef.current = 0;
      prevPaginationConfigRef.current = currentPaginationConfig;
      prevSpreadConfigRef.current = currentSpreadConfig;
      tracerRef.current.reset();
      tracerRef.current.startRun();
      const roundTripStartedAtMs = performance.now();
      firstSpreadRoundTripStartedAtRef.current = roundTripStartedAtMs;
      allChaptersRoundTripStartedAtRef.current = roundTripStartedAtMs;
      firstSpreadSpanRef.current ??= startReaderTraceSpan(
        "pagination-first-spread",
        "pagination",
        {
          initialChapterIndex: opts.initialChapterIndex,
          executionContext: "worker-round-trip-wall",
        },
      );
      allChaptersSpanRef.current ??= startReaderTraceSpan(
        "pagination-all-chapters",
        "pagination",
        {
          totalChapters: opts.totalChapters,
          executionContext: "worker-pipeline",
        },
      );
      publisherFontsSpanRef.current ??= startReaderTraceSpan(
        "pagination-publisher-fonts",
        "assets",
      );

      setSpread(null);
      setStatus("idle");
      pendingChapterPageCountsRef.current.clear();
      setChapterPageCounts(new Map());

      postCommand({
        type: "init",
        intent: opts.intent ?? REPLACE_INTENT,
        totalChapters: opts.totalChapters,
        paginationConfig: currentPaginationConfig,
        spreadConfig: currentSpreadConfig,
        initialChapterIndex: opts.initialChapterIndex,
        initialChapterProgress: opts.initialChapterProgress,
        initialAnchor: opts.initialAnchor,
        firstChapterBlocks: opts.firstChapterBlocks,
      });
    },
    [postCommand],
  );

  const addChapter = useCallback(
    (chapterIndex: number, blocks: Block[]) => {
      postCommand({ type: "addChapter", chapterIndex, blocks });
    },
    [postCommand],
  );

  const updateChapter = useCallback(
    (chapterIndex: number, blocks: Block[]) => {
      postCommand({ type: "updateChapter", chapterIndex, blocks });
    },
    [postCommand],
  );

  const nextSpread = useCallback(() => {
    postCommand({ type: "nextSpread", intent: FORWARD_LINEAR_INTENT });
  }, [postCommand]);

  const prevSpread = useCallback(() => {
    postCommand({ type: "prevSpread", intent: BACKWARD_LINEAR_INTENT });
  }, [postCommand]);

  const goToPage = useCallback(
    (p: number, options: { intent: SpreadIntent }) => {
      postCommand({
        type: "goToPage",
        page: Math.max(1, Math.floor(p)),
        intent: options.intent,
      });
    },
    [postCommand],
  );

  const goToChapter = useCallback(
    (chapterIndex: number, options: { intent: SpreadIntent }) => {
      postCommand({
        type: "goToChapter",
        chapterIndex: Math.floor(chapterIndex),
        intent: options.intent,
      });
    },
    [postCommand],
  );

  const goToTarget = useCallback(
    (
      chapterIndex: number,
      targetId: string,
      options: { intent: SpreadIntent },
    ) => {
      postCommand({
        type: "goToTarget",
        chapterIndex: Math.floor(chapterIndex),
        targetId,
        intent: options.intent,
      });
    },
    [postCommand],
  );

  return {
    spread,
    status,
    chapterPageCounts,
    nextSpread,
    prevSpread,
    goToPage,
    goToChapter,
    goToTarget,
    init,
    addChapter,
    updateChapter,
    tracer: tracerRef.current,
  };
}

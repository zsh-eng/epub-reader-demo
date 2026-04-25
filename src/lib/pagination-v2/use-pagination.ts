import { useCallback, useEffect, useRef, useState } from "react";
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
  markFontSwitchIntent: (from: string, to: string) => void;
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

  // Keep config in a ref so init and config update effects can read the
  // latest value without capturing it as a closure dependency.
  const paginationConfigRef = useRef<PaginationConfig>(paginationConfig);
  paginationConfigRef.current = paginationConfig;

  const spreadConfigRef = useRef<SpreadConfig>(spreadConfig);
  spreadConfigRef.current = spreadConfig;

  // Keep config refs so the config update effects can detect changes.
  const prevPaginationConfigRef = useRef<PaginationConfig | null>(null);
  const prevSpreadConfigRef = useRef<SpreadConfig | null>(null);

  const markFontSwitchIntent = useCallback((from: string, to: string) => {
    tracerRef.current.recordIntent(from, to);
  }, []);

  const postCommand = useCallback((cmd: PaginationCommand) => {
    tracerRef.current.recordPostedCommand(cmd, {
      immediate: cmd.type === "init",
    });
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
      case "partialReady":
        currentEpochRef.current = event.epoch;
        recordChapterPageCount(event.chapterDiagnostics);
        setSpread(event.spread);
        setStatus("partial");
        tracerRef.current.updateDiagnostics(null);
        publishChapterPageCounts([]);
        break;

      case "ready":
        currentEpochRef.current = event.epoch;
        setSpread(event.spread);
        setStatus("ready");
        tracerRef.current.markReady(
          prevPaginationConfigRef.current?.fontConfig.bodyFamily ?? "",
        );
        publishChapterPageCounts(event.chapterDiagnostics);
        break;

      case "progress":
        tracerRef.current.updateDiagnostics(null);
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

    if (
      prev &&
      prev.fontConfig.bodyFamily !== paginationConfig.fontConfig.bodyFamily
    ) {
      tracerRef.current.beginFontSwitch(paginationConfig);
    }

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
      tracerRef.current.recordChapterQueued(chapterIndex);
      postCommand({ type: "addChapter", chapterIndex, blocks });
    },
    [postCommand],
  );

  const updateChapter = useCallback(
    (chapterIndex: number, blocks: Block[]) => {
      tracerRef.current.recordChapterQueued(chapterIndex);
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
    markFontSwitchIntent,
  };
}

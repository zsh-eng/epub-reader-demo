import { useCallback, useEffect, useRef, useState } from "react";
import { PaginationTracer } from "./diagnostics/tracer";
import type { PaginationCommand, PaginationEvent } from "./protocol";
import type {
  Block,
  ContentAnchor,
  PaginationConfig,
  PaginationStatus,
  ResolvedSpread,
  SpreadConfig,
} from "./types";
import { DEFAULT_SPREAD_CONFIG } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsePaginationResult {
  spread: ResolvedSpread | null;
  status: PaginationStatus;
  /** Maps chapterIndex → page count for that chapter, populated progressively as chapters are laid out. */
  chapterPageCounts: Map<number, number>;

  nextSpread: () => void;
  prevSpread: () => void;
  goToPage: (page: number) => void;
  goToChapter: (chapterIndex: number) => void;

  init: (options: {
    totalChapters: number;
    initialChapterIndex: number;
    initialAnchor?: ContentAnchor;
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

  useEffect(() => {
    return () => {
      tracerRef.current.cleanup();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Worker lifecycle
  // -------------------------------------------------------------------------

  const handleEvent = (event: PaginationEvent) => {
    // Discard events from previous layout epochs.
    if ("epoch" in event && event.epoch < currentEpochRef.current) return;

    switch (event.type) {
      case "partialReady":
        currentEpochRef.current = event.epoch;
        setSpread(event.spread);
        setStatus("partial");
        tracerRef.current.updateDiagnostics(null);
        if (event.chapterDiagnostics) {
          const { chapterIndex, pageCount } = event.chapterDiagnostics;
          setChapterPageCounts((prev) =>
            new Map(prev).set(chapterIndex, pageCount),
          );
        }
        break;

      case "ready":
        currentEpochRef.current = event.epoch;
        setSpread(event.spread);
        setStatus("ready");
        tracerRef.current.markReady(
          prevPaginationConfigRef.current?.fontConfig.bodyFamily ?? "",
        );
        if (event.chapterDiagnostics.length > 0) {
          setChapterPageCounts((prev) => {
            const next = new Map(prev);
            for (const d of event.chapterDiagnostics) {
              next.set(d.chapterIndex, d.pageCount);
            }
            return next;
          });
        }
        break;

      case "progress":
        setSpread((prev) =>
          prev
            ? {
                ...prev,
                cause: event.cause,
                currentPage: event.currentPage,
                totalPages: event.totalPages,
                currentSpread: event.currentSpread,
                totalSpreads: event.totalSpreads,
              }
            : prev,
        );
        tracerRef.current.updateDiagnostics(null);
        if (event.chapterDiagnostics) {
          const { chapterIndex, pageCount } = event.chapterDiagnostics;
          setChapterPageCounts((prev) =>
            new Map(prev).set(chapterIndex, pageCount),
          );
        }
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
      initialAnchor?: ContentAnchor;
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
      setChapterPageCounts(new Map());

      postCommand({
        type: "init",
        totalChapters: opts.totalChapters,
        paginationConfig: currentPaginationConfig,
        spreadConfig: currentSpreadConfig,
        initialChapterIndex: opts.initialChapterIndex,
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
    postCommand({ type: "nextSpread" });
  }, [postCommand]);

  const prevSpread = useCallback(() => {
    postCommand({ type: "prevSpread" });
  }, [postCommand]);

  const goToPage = useCallback(
    (p: number) => {
      postCommand({ type: "goToPage", page: Math.max(1, Math.floor(p)) });
    },
    [postCommand],
  );

  const goToChapter = useCallback(
    (chapterIndex: number) => {
      postCommand({
        type: "goToChapter",
        chapterIndex: Math.floor(chapterIndex),
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
    init,
    addChapter,
    updateChapter,
    tracer: tracerRef.current,
    markFontSwitchIntent,
  };
}

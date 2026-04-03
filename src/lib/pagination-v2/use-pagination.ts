import { useCallback, useEffect, useRef, useState } from "react";
import { PaginationTracer } from "../pagination/pagination-tracer";
import type { Block } from "../pagination/types";
import type { PaginationCommand, PaginationEvent } from "./engine-types";
import type {
  ContentAnchor,
  PaginationConfig,
  PaginationStatus,
  ResolvedPage,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsePaginationResult {
  page: ResolvedPage | null;
  status: PaginationStatus;

  nextPage: () => void;
  prevPage: () => void;
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

  tracer: PaginationTracer;
  markFontSwitchIntent: (from: string, to: string) => void;
}

export interface UsePaginationOptions {
  config: PaginationConfig;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePagination(
  options: UsePaginationOptions,
): UsePaginationResult {
  const { config } = options;

  const [page, setPage] = useState<ResolvedPage | null>(null);
  const [status, setStatus] = useState<PaginationStatus>("idle");

  const workerRef = useRef<Worker | null>(null);
  const currentEpochRef = useRef(0);
  const tracerRef = useRef(new PaginationTracer());

  // Keep config in a ref so init and the updateConfig effect can read the
  // latest value without capturing it as a closure dependency.
  const configRef = useRef<PaginationConfig>(config);
  configRef.current = config;

  // Keep config in a ref so the updateConfig effect can detect changes.
  const prevConfigRef = useRef<PaginationConfig | null>(null);

  const markFontSwitchIntent = useCallback((from: string, to: string) => {
    tracerRef.current.recordIntent(from, to);
  }, []);

  const postCommand = useCallback((cmd: PaginationCommand) => {
    tracerRef.current.recordPostedCommand(
      cmd as Parameters<typeof tracerRef.current.recordPostedCommand>[0],
      {
        immediate: cmd.type === "init",
      },
    );
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
        setPage(event.page);
        setStatus("partial");
        tracerRef.current.updateDiagnostics(null);
        break;

      case "ready":
        currentEpochRef.current = event.epoch;
        setPage(event.page);
        setStatus("ready");
        tracerRef.current.markReady(
          prevConfigRef.current?.fontConfig.bodyFamily ?? "",
        );
        break;

      case "progress":
        setPage((prev) =>
          prev
            ? {
                ...prev,
                currentPage: event.currentPage,
                totalPages: event.totalPages,
              }
            : prev,
        );
        tracerRef.current.updateDiagnostics(null);
        break;

      case "pageContent":
        setPage(event.page);
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
      new URL("./pagination.worker.ts", import.meta.url),
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
    const prev = prevConfigRef.current;
    prevConfigRef.current = config;

    if (!prev) return; // init hasn't been called yet — config will be sent with init.

    if (prev && prev.fontConfig.bodyFamily !== config.fontConfig.bodyFamily) {
      tracerRef.current.beginFontSwitch(config);
    }

    setStatus((s) => (s === "idle" ? s : "recalculating"));
    postCommand({ type: "updateConfig", config });
  }, [config, postCommand]);

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
      const currentConfig = configRef.current;
      currentEpochRef.current = 0;
      prevConfigRef.current = currentConfig;
      tracerRef.current.reset();

      setPage(null);
      setStatus("idle");

      postCommand({
        type: "init",
        totalChapters: opts.totalChapters,
        config: currentConfig,
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

  const nextPage = useCallback(() => {
    postCommand({ type: "nextPage" });
  }, [postCommand]);

  const prevPage = useCallback(() => {
    postCommand({ type: "prevPage" });
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
    page,
    status,
    nextPage,
    prevPage,
    goToPage,
    goToChapter,
    init,
    addChapter,
    tracer: tracerRef.current,
    markFontSwitchIntent,
  };
}

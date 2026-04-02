import { useCallback, useEffect, useRef, useState } from "react";
import {
  nextPaginationCommandHistory,
  type PaginationCommandHistoryEntry,
} from "./command-history";
import type {
  ContentAnchor,
  PaginationCommand,
  PaginationEvent,
} from "./engine-types";
import {
  PaginationTracer,
  type PaginationFontSwitchLatencyTrace,
} from "./pagination-tracer";
import { parseChapterHtml } from "./parse-html";
import {
  areFontConfigsEqual,
  type PageSlice,
  type PaginationConfig,
  type PaginationDiagnostics,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaginationStatus = "idle" | "loading" | "partial" | "ready";
export type { PaginationCommandHistoryEntry, PaginationFontSwitchLatencyTrace };

export interface UsePaginationResult {
  slices: PageSlice[];
  currentPage: number;
  currentChapterIndex: number;
  // COMMENT: any way for discriminated union or something to note down the possible
  // states?
  // Also we should be clear and add some comments here when each state occurs
  // e.g. when loading, when layout shift, etc.
  totalPages: number | null;
  estimatedTotalPages: number | null;
  resolvedAnchor: ContentAnchor | null;

  // COMMENT: I think this is good, exposing the commands as functions
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
  goToChapterIndex: (chapterIndex: number) => void;
  addChapter: (chapterIndex: number, html: string) => void;

  status: PaginationStatus;
  diagnostics: PaginationDiagnostics | null;
  commandHistory: PaginationCommandHistoryEntry[];
  fontSwitchLatencyTraces: PaginationFontSwitchLatencyTrace[];
  markFontSwitchIntent: (from: string, to: string) => void;
}

export interface UsePaginationOptions {
  totalChapters: number;
  config: PaginationConfig;
  initialChapterIndex?: number;
  initialAnchor?: ContentAnchor | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function anchorToKey(anchor: ContentAnchor | null | undefined): string {
  if (!anchor) return "null";
  const offset = anchor.offset;
  if (!offset) {
    return `${anchor.chapterIndex}:${anchor.blockId}`;
  }
  return `${anchor.chapterIndex}:${anchor.blockId}:${offset.itemIndex}:${offset.segmentIndex}:${offset.graphemeIndex}`;
}

export function usePagination(
  options: UsePaginationOptions,
): UsePaginationResult {
  const { totalChapters, config, initialChapterIndex, initialAnchor } = options;
  // COMMENT: why is this inside the hook? It's a constant
  const MAX_FONT_SWITCH_LATENCY_TRACES = 12;

  const [slices, setSlices] = useState<PageSlice[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(
    initialChapterIndex ?? 0,
  );
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [estimatedTotalPages, setEstimatedTotalPages] = useState<number | null>(
    null,
  );
  const [resolvedAnchor, setResolvedAnchor] = useState<ContentAnchor | null>(
    initialAnchor ?? null,
  );
  const [status, setStatus] = useState<PaginationStatus>("idle");
  const [diagnostics, setDiagnostics] = useState<PaginationDiagnostics | null>(
    null,
  );
  const [commandHistory, setCommandHistory] = useState<
    PaginationCommandHistoryEntry[]
  >([]);
  const [fontSwitchLatencyTraces, setFontSwitchLatencyTraces] = useState<
    PaginationFontSwitchLatencyTrace[]
  >([]);

  const workerRef = useRef<Worker | null>(null);
  const commandSequenceRef = useRef(0);
  const commandHistoryRef = useRef<PaginationCommandHistoryEntry[]>([]);
  const commandHistoryFlushTimerRef = useRef<number | null>(null);
  const currentPageRef = useRef(1);
  const totalPagesRef = useRef<number | null>(null);
  const estimatedTotalPagesRef = useRef<number | null>(null);
  const latestBodyFamilyRef = useRef(config.fontConfig.bodyFamily);
  const tracerRef = useRef(
    new PaginationTracer(MAX_FONT_SWITCH_LATENCY_TRACES, setFontSwitchLatencyTraces),
  );

  // Keep refs in sync for use in callbacks.
  // Use effects so re-renders from unrelated state (e.g. command history)
  // don't reset optimistic navigation refs before worker responses arrive.
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    totalPagesRef.current = totalPages;
  }, [totalPages]);

  useEffect(() => {
    estimatedTotalPagesRef.current = estimatedTotalPages;
  }, [estimatedTotalPages]);

  useEffect(() => {
    latestBodyFamilyRef.current = config.fontConfig.bodyFamily;
  }, [config.fontConfig.bodyFamily]);

  // Track previous values to detect changes
  const prevTotalChaptersRef = useRef<number | null>(null);
  const prevInitialChapterIndexRef = useRef<number | null>(null);
  const prevInitialAnchorKeyRef = useRef<string>("null");

  const previousConfigRef = useRef<PaginationConfig | null>(null);

  const flushCommandHistory = useCallback(() => {
    commandHistoryFlushTimerRef.current = null;
    setCommandHistory(commandHistoryRef.current);
  }, []);

  const scheduleCommandHistoryFlush = useCallback(
    (immediate = false) => {
      if (immediate) {
        if (commandHistoryFlushTimerRef.current !== null) {
          window.clearTimeout(commandHistoryFlushTimerRef.current);
          commandHistoryFlushTimerRef.current = null;
        }
        flushCommandHistory();
        return;
      }

      if (commandHistoryFlushTimerRef.current !== null) return;

      commandHistoryFlushTimerRef.current = window.setTimeout(() => {
        flushCommandHistory();
      }, 120);
    },
    [flushCommandHistory],
  );

  const markFontSwitchIntent = useCallback((from: string, to: string) => {
    tracerRef.current.recordIntent(from, to);
  }, []);

  const postCommand = useCallback((cmd: PaginationCommand) => {
    commandSequenceRef.current += 1;
    commandHistoryRef.current = nextPaginationCommandHistory(
      commandHistoryRef.current,
      cmd,
      commandSequenceRef.current,
    );
    scheduleCommandHistoryFlush(cmd.type === "init");
    workerRef.current?.postMessage(cmd);
  }, [scheduleCommandHistoryFlush]);

  useEffect(() => {
    return () => {
      if (commandHistoryFlushTimerRef.current !== null) {
        window.clearTimeout(commandHistoryFlushTimerRef.current);
        commandHistoryFlushTimerRef.current = null;
      }
      tracerRef.current.cleanup();
    };
  }, []);


  const applyResolvedPage = useCallback(
    (
      globalPage: number,
      pageSlices: PageSlice[],
      chapterIndex: number | null,
      anchor: ContentAnchor | null,
    ) => {
      currentPageRef.current = globalPage;
      setCurrentPage(globalPage);
      if (chapterIndex !== null) {
        setCurrentChapterIndex(chapterIndex);
      }
      setSlices(pageSlices);
      setResolvedAnchor(anchor);
    },
    [],
  );


  // Handle worker events
  const handleEvent = useCallback(
    (event: PaginationEvent) => {
      switch (event.type) {
        case "ready": {
          tracerRef.current.markReady(latestBodyFamilyRef.current);

          setTotalPages(event.totalPages);
          totalPagesRef.current = event.totalPages;
          setEstimatedTotalPages(null);
          estimatedTotalPagesRef.current = null;
          for (const chapter of event.diagnostics.chapterTimings ?? []) {
            tracerRef.current.finalizeChapter(chapter.chapterIndex, chapter);
          }
          setDiagnostics(tracerRef.current.getDiagnostics(event.diagnostics));
          setStatus("ready");

          const resolvedPage =
            event.resolvedPage === null
              ? null
              : clamp(event.resolvedPage, 1, event.totalPages);

          if (resolvedPage !== null) {
            applyResolvedPage(
              resolvedPage,
              event.slices,
              event.slicesChapterIndex,
              event.resolvedAnchor,
            );
            break;
          }

          applyResolvedPage(
            1,
            event.slices,
            event.slicesChapterIndex,
            event.resolvedAnchor,
          );
          break;
        }

        case "pageContent": {
          applyResolvedPage(
            event.globalPage,
            event.slices,
            event.chapterIndex,
            event.resolvedAnchor,
          );
          break;
        }

        case "pageUnavailable": {
          // Keep current page/slices as-is for unresolved navigation targets.
          break;
        }

        case "partialReady": {
          const partialAtMs = performance.now();
          tracerRef.current.markActive((trace) => ({
            ...trace,
            firstPartialAtMs: trace.firstPartialAtMs ?? partialAtMs,
            partialEvents: trace.partialEvents + 1,
          }));

          setEstimatedTotalPages(event.estimatedTotalPages);
          tracerRef.current.finalizeChapter(event.chapterIndex, event.chapterDiagnostics);
          setDiagnostics(tracerRef.current.getDiagnostics(null));
          setStatus("partial");

          if (event.resolvedPage !== null) {
            applyResolvedPage(
              event.resolvedPage,
              event.slices,
              event.slicesChapterIndex,
              event.resolvedAnchor,
            );
          } else {
            setResolvedAnchor(event.resolvedAnchor);
          }
          break;
        }

        case "progress": {
          const progressAtMs = performance.now();
          tracerRef.current.markActive((trace) => ({
            ...trace,
            firstProgressAtMs: trace.firstProgressAtMs ?? progressAtMs,
            progressEvents: trace.progressEvents + 1,
          }));

          setEstimatedTotalPages(event.runningTotalPages);
          tracerRef.current.finalizeChapter(event.chapterIndex, event.chapterDiagnostics);
          setDiagnostics(tracerRef.current.getDiagnostics(null));
          break;
        }

        case "error": {
          console.error("[pagination worker]", event.message);
          break;
        }
      }
    },
    [applyResolvedPage],
  );

  // Create and manage worker
  useEffect(() => {
    const worker = new Worker(
      new URL("./pagination.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (e: MessageEvent<PaginationEvent>) => {
      handleEvent(e.data);
    };

    worker.onerror = (e) => {
      console.error("[pagination worker error]", e);
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [handleEvent]);

  // Send init command when chapter count changes
  useEffect(() => {
    const nextInitialChapterIndex = initialChapterIndex ?? 0;
    const nextInitialAnchor = initialAnchor ?? null;
    const nextInitialAnchorKey = anchorToKey(nextInitialAnchor);

    if (totalChapters <= 0) {
      prevTotalChaptersRef.current = totalChapters;
      prevInitialChapterIndexRef.current = nextInitialChapterIndex;
      prevInitialAnchorKeyRef.current = nextInitialAnchorKey;
      return;
    }

    const shouldInit =
      prevTotalChaptersRef.current !== totalChapters ||
      prevInitialChapterIndexRef.current !== nextInitialChapterIndex ||
      prevInitialAnchorKeyRef.current !== nextInitialAnchorKey;

    if (!shouldInit) return;

    setStatus("loading");
    setSlices([]);
    setCurrentPage(1);
    currentPageRef.current = 1;
    setCurrentChapterIndex(nextInitialChapterIndex);
    setTotalPages(null);
    totalPagesRef.current = null;
    setEstimatedTotalPages(null);
    estimatedTotalPagesRef.current = null;
    setResolvedAnchor(nextInitialAnchor);
    setDiagnostics(null);
    tracerRef.current.reset();
    setFontSwitchLatencyTraces([]);
    previousConfigRef.current = config;

    postCommand({
      type: "init",
      totalChapters,
      config,
      initialChapterIndex: nextInitialChapterIndex,
      initialAnchor: nextInitialAnchor,
    });

    prevTotalChaptersRef.current = totalChapters;
    prevInitialChapterIndexRef.current = nextInitialChapterIndex;
    prevInitialAnchorKeyRef.current = nextInitialAnchorKey;
  }, [
    totalChapters,
    config,
    initialChapterIndex,
    initialAnchor,
    postCommand,
  ]);

  const addChapter = useCallback(
    (chapterIndex: number, html: string) => {
      if (totalChapters <= 0) return;
      if (chapterIndex < 0 || chapterIndex >= totalChapters) return;

      tracerRef.current.recordChapterQueued(chapterIndex);
      const stage1StartedAt = performance.now();
      const blocks = parseChapterHtml(html);
      tracerRef.current.recordStage1(chapterIndex, performance.now() - stage1StartedAt);
      postCommand({ type: "addChapter", chapterIndex, blocks });
    },
    [postCommand, totalChapters],
  );

  // Send pagination config changes
  useEffect(() => {
    if (totalChapters <= 0) return;

    const previousConfig = previousConfigRef.current;
    if (
      previousConfig &&
      !areFontConfigsEqual(previousConfig.fontConfig, config.fontConfig)
    ) {
      tracerRef.current.beginFontSwitch(config);
    }
    previousConfigRef.current = config;

    postCommand({
      type: "updateConfig",
      config,
    });
  }, [config, totalChapters, postCommand]);

  // Navigation
  const nextPage = useCallback(() => {
    const current = currentPageRef.current;
    const knownTotal = totalPagesRef.current;
    const next =
      knownTotal === null ? current + 1 : Math.min(knownTotal, current + 1);
    if (next === current) return;

    postCommand({ type: "getPage", globalPage: next });
  }, [postCommand]);

  const prevPage = useCallback(() => {
    const current = currentPageRef.current;
    const next = Math.max(1, current - 1);
    if (next === current) return;

    postCommand({ type: "getPage", globalPage: next });
  }, [postCommand]);

  const goToPage = useCallback(
    (page: number) => {
      const normalized = Math.max(1, Math.floor(page));
      const maxKnownPages =
        totalPagesRef.current ?? estimatedTotalPagesRef.current;
      const clamped =
        maxKnownPages === null ? normalized : clamp(normalized, 1, maxKnownPages);
      if (clamped === currentPageRef.current) return;

      postCommand({ type: "getPage", globalPage: clamped });
    },
    [postCommand],
  );

  const goToChapterIndex = useCallback(
    (chapterIndex: number) => {
      if (totalChapters <= 0) return;

      const normalized = Math.floor(chapterIndex);
      if (normalized < 0 || normalized >= totalChapters) return;

      postCommand({ type: "goToChapter", chapterIndex: normalized });
    },
    [postCommand, totalChapters],
  );

  return {
    slices,
    currentPage,
    currentChapterIndex,
    totalPages,
    estimatedTotalPages,
    resolvedAnchor,
    nextPage,
    prevPage,
    goToPage,
    goToChapterIndex,
    addChapter,
    status,
    diagnostics,
    commandHistory,
    fontSwitchLatencyTraces,
    markFontSwitchIntent,
  };
}

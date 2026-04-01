import { useCallback, useEffect, useRef, useState } from "react";
import {
    nextPaginationCommandHistory,
    type PaginationCommandHistoryEntry,
} from "./command-history";
import type {
    PaginationCommand,
    PaginationEvent,
} from "./engine-types";
import { parseChapterHtml } from "./parse-html";
import type {
    PageSlice,
    PaginationChapterDiagnostics,
    PaginationConfig,
    PaginationDiagnostics,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaginationStatus = "idle" | "loading" | "partial" | "ready";
export type { PaginationCommandHistoryEntry };

export interface FontSwitchLatencyIntent {
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

export interface UsePaginationResult {
  slices: PageSlice[];
  currentPage: number;
  currentChapterIndex: number;
  totalPages: number | null;
  estimatedTotalPages: number | null;

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
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function areFontConfigsEqual(
  a: PaginationConfig["fontConfig"],
  b: PaginationConfig["fontConfig"],
): boolean {
  return (
    a.bodyFamily === b.bodyFamily &&
    a.headingFamily === b.headingFamily &&
    a.codeFamily === b.codeFamily &&
    a.baseSizePx === b.baseSizePx
  );
}

function readFontLoaded(bodyFamily: string): boolean | null {
  if (typeof document === "undefined") return null;
  if (!("fonts" in document)) return null;
  if (typeof document.fonts.check !== "function") return null;

  return document.fonts.check(`16px ${bodyFamily}`);
}

export function usePagination(
  options: UsePaginationOptions,
): UsePaginationResult {
  const { totalChapters, config, initialChapterIndex } = options;
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

  const stage1ByChapterRef = useRef<Map<number, number>>(new Map());
  const chapterQueuedAtRef = useRef<Map<number, number>>(new Map());
  const chapterLoadByChapterRef = useRef<Map<number, number>>(new Map());
  const workerChapterDiagnosticsRef = useRef<
    Map<number, PaginationChapterDiagnostics>
  >(new Map());
  const previousConfigRef = useRef<PaginationConfig | null>(null);
  const fontSwitchIntentRef = useRef<FontSwitchLatencyIntent | null>(null);
  const activeFontSwitchTraceIdRef = useRef<string | null>(null);
  const fontSwitchTraceSequenceRef = useRef(0);
  const fontSwitchLatencyTracesRef = useRef<PaginationFontSwitchLatencyTrace[]>(
    [],
  );
  const fontSwitchLatencyFlushTimerRef = useRef<number | null>(null);

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

  const flushFontSwitchLatencyTraces = useCallback(() => {
    fontSwitchLatencyFlushTimerRef.current = null;
    setFontSwitchLatencyTraces([...fontSwitchLatencyTracesRef.current]);
  }, []);

  const scheduleFontSwitchLatencyFlush = useCallback(
    (immediate = false) => {
      if (immediate) {
        if (fontSwitchLatencyFlushTimerRef.current !== null) {
          window.clearTimeout(fontSwitchLatencyFlushTimerRef.current);
          fontSwitchLatencyFlushTimerRef.current = null;
        }
        flushFontSwitchLatencyTraces();
        return;
      }

      if (fontSwitchLatencyFlushTimerRef.current !== null) return;

      fontSwitchLatencyFlushTimerRef.current = window.setTimeout(() => {
        flushFontSwitchLatencyTraces();
      }, 80);
    },
    [flushFontSwitchLatencyTraces],
  );

  const updateFontSwitchTrace = useCallback(
    (
      traceId: string,
      apply: (
        trace: PaginationFontSwitchLatencyTrace,
      ) => PaginationFontSwitchLatencyTrace,
    ) => {
      const next = fontSwitchLatencyTracesRef.current.map((trace) =>
        trace.id === traceId ? apply(trace) : trace,
      );
      fontSwitchLatencyTracesRef.current = next;
    },
    [],
  );

  const markFontSwitchIntent = useCallback((from: string, to: string) => {
    fontSwitchIntentRef.current = {
      from,
      to,
      startedAtMs: performance.now(),
    };
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
      if (fontSwitchLatencyFlushTimerRef.current !== null) {
        window.clearTimeout(fontSwitchLatencyFlushTimerRef.current);
        fontSwitchLatencyFlushTimerRef.current = null;
      }
    };
  }, []);

  const finalizeChapterTiming = useCallback(
    (chapterIndex: number, chapterDiagnostics: PaginationChapterDiagnostics | null) => {
      if (chapterDiagnostics) {
        workerChapterDiagnosticsRef.current.set(chapterIndex, chapterDiagnostics);
      }

      const queuedAt = chapterQueuedAtRef.current.get(chapterIndex);
      if (queuedAt === undefined) return;

      chapterLoadByChapterRef.current.set(chapterIndex, performance.now() - queuedAt);
      chapterQueuedAtRef.current.delete(chapterIndex);
    },
    [],
  );

  const applyResolvedPage = useCallback(
    (globalPage: number, pageSlices: PageSlice[], chapterIndex: number | null) => {
      currentPageRef.current = globalPage;
      setCurrentPage(globalPage);
      if (chapterIndex !== null) {
        setCurrentChapterIndex(chapterIndex);
      }
      setSlices(pageSlices);
    },
    [],
  );

  const buildMergedDiagnostics = useCallback(
    (base: PaginationDiagnostics | null): PaginationDiagnostics | null => {
      const chapterMap = new Map<number, PaginationChapterDiagnostics>();

      for (const chapter of base?.chapterTimings ?? []) {
        chapterMap.set(chapter.chapterIndex, chapter);
      }

      for (const [chapterIndex, chapter] of workerChapterDiagnosticsRef.current) {
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
            stage1ByChapterRef.current.get(chapter.chapterIndex) ??
            chapter.stage1ParseMs ??
            0;
          const stage2PrepareMs = chapter.stage2PrepareMs ?? 0;
          const stage3LayoutMs = chapter.stage3LayoutMs ?? 0;
          const totalMs = stage1ParseMs + stage2PrepareMs + stage3LayoutMs;
          const chapterLoadMs =
            chapterLoadByChapterRef.current.get(chapter.chapterIndex) ??
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
    },
    [],
  );

  const beginFontSwitchTrace = useCallback(
    (nextConfig: PaginationConfig) => {
      const now = performance.now();
      const traceId = `font-switch-${Date.now()}-${fontSwitchTraceSequenceRef.current + 1}`;
      fontSwitchTraceSequenceRef.current += 1;

      const activeTraceId = activeFontSwitchTraceIdRef.current;
      if (activeTraceId) {
        updateFontSwitchTrace(activeTraceId, (trace) => {
          if (trace.status !== "running") return trace;
          return { ...trace, status: "superseded" };
        });
      }

      const intent = fontSwitchIntentRef.current;
      fontSwitchIntentRef.current = null;

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
        bodyFontLoadedAtStart: readFontLoaded(nextConfig.fontConfig.bodyFamily),
        bodyFontLoadedAtReady: null,
      };

      fontSwitchLatencyTracesRef.current = [
        trace,
        ...fontSwitchLatencyTracesRef.current,
      ].slice(0, MAX_FONT_SWITCH_LATENCY_TRACES);

      activeFontSwitchTraceIdRef.current = traceId;
      scheduleFontSwitchLatencyFlush(true);
    },
    [scheduleFontSwitchLatencyFlush, updateFontSwitchTrace],
  );

  const schedulePaintProbeForTrace = useCallback(
    (traceId: string) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const paintedAtMs = performance.now();
          updateFontSwitchTrace(traceId, (trace) => {
            if (trace.paintedAtMs !== null) return trace;
            return { ...trace, paintedAtMs };
          });
          scheduleFontSwitchLatencyFlush(true);
        });
      });
    },
    [scheduleFontSwitchLatencyFlush, updateFontSwitchTrace],
  );

  const markActiveFontSwitchTrace = useCallback(
    (
      apply: (
        trace: PaginationFontSwitchLatencyTrace,
      ) => PaginationFontSwitchLatencyTrace,
      immediate = false,
    ) => {
      const traceId = activeFontSwitchTraceIdRef.current;
      if (!traceId) return;

      updateFontSwitchTrace(traceId, apply);
      scheduleFontSwitchLatencyFlush(immediate);
    },
    [scheduleFontSwitchLatencyFlush, updateFontSwitchTrace],
  );

  // Handle worker events
  const handleEvent = useCallback(
    (event: PaginationEvent) => {
      switch (event.type) {
        case "ready": {
          const readyAtMs = performance.now();
          const activeTraceId = activeFontSwitchTraceIdRef.current;

          if (activeTraceId) {
            updateFontSwitchTrace(activeTraceId, (trace) => {
              return {
                ...trace,
                status: "ready",
                readyAtMs,
                bodyFontLoadedAtReady: readFontLoaded(
                  latestBodyFamilyRef.current,
                ),
              };
            });
            activeFontSwitchTraceIdRef.current = null;
            scheduleFontSwitchLatencyFlush(true);
            schedulePaintProbeForTrace(activeTraceId);
          }

          setTotalPages(event.totalPages);
          totalPagesRef.current = event.totalPages;
          setEstimatedTotalPages(null);
          estimatedTotalPagesRef.current = null;
          for (const chapter of event.diagnostics.chapterTimings ?? []) {
            finalizeChapterTiming(chapter.chapterIndex, chapter);
          }
          setDiagnostics(buildMergedDiagnostics(event.diagnostics));
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
            );
            break;
          }

          applyResolvedPage(1, event.slices, event.slicesChapterIndex);
          break;
        }

        case "pageContent": {
          console.log("page content for", event.globalPage, event.chapterIndex)
          applyResolvedPage(event.globalPage, event.slices, event.chapterIndex);
          break;
        }

        case "pageUnavailable": {
          // Keep current page/slices as-is for unresolved navigation targets.
          break;
        }

        case "partialReady": {
          console.log("partial ready")
          const partialAtMs = performance.now();
          markActiveFontSwitchTrace(
            (trace) => ({
              ...trace,
              firstPartialAtMs: trace.firstPartialAtMs ?? partialAtMs,
              partialEvents: trace.partialEvents + 1,
            }),
            false,
          );

          setEstimatedTotalPages(event.estimatedTotalPages);
          finalizeChapterTiming(event.chapterIndex, event.chapterDiagnostics);
          setDiagnostics((prev) => buildMergedDiagnostics(prev));
          setStatus("partial");

          if (event.resolvedPage !== null) {
            applyResolvedPage(
              event.resolvedPage,
              event.slices,
              event.slicesChapterIndex,
            );
          }
          break;
        }

        case "progress": {
          console.log("received progress for", event.chapterIndex);
          const progressAtMs = performance.now();
          markActiveFontSwitchTrace(
            (trace) => ({
              ...trace,
              firstProgressAtMs: trace.firstProgressAtMs ?? progressAtMs,
              progressEvents: trace.progressEvents + 1,
            }),
            false,
          );

          setEstimatedTotalPages(event.runningTotalPages);
          finalizeChapterTiming(event.chapterIndex, event.chapterDiagnostics);
          setDiagnostics((prev) => buildMergedDiagnostics(prev));
          break;
        }

        case "error": {
          console.error("[pagination worker]", event.message);
          break;
        }
      }
    },
    [
      buildMergedDiagnostics,
      finalizeChapterTiming,
      applyResolvedPage,
      markActiveFontSwitchTrace,
      postCommand,
      scheduleFontSwitchLatencyFlush,
      schedulePaintProbeForTrace,
      updateFontSwitchTrace,
    ],
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

    if (totalChapters <= 0) {
      prevTotalChaptersRef.current = totalChapters;
      prevInitialChapterIndexRef.current = nextInitialChapterIndex;
      return;
    }

    const shouldInit =
      prevTotalChaptersRef.current !== totalChapters ||
      prevInitialChapterIndexRef.current !== nextInitialChapterIndex;

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
    setDiagnostics(null);
    stage1ByChapterRef.current.clear();
    chapterQueuedAtRef.current.clear();
    chapterLoadByChapterRef.current.clear();
    workerChapterDiagnosticsRef.current.clear();
    previousConfigRef.current = config;
    fontSwitchIntentRef.current = null;
    activeFontSwitchTraceIdRef.current = null;
    fontSwitchLatencyTracesRef.current = [];
    setFontSwitchLatencyTraces([]);

    postCommand({
      type: "init",
      totalChapters,
      config,
      initialChapterIndex: nextInitialChapterIndex,
    });

    prevTotalChaptersRef.current = totalChapters;
    prevInitialChapterIndexRef.current = nextInitialChapterIndex;
  }, [
    totalChapters,
    config,
    initialChapterIndex,
    postCommand,
  ]);

  const addChapter = useCallback(
    (chapterIndex: number, html: string) => {
      if (totalChapters <= 0) return;
      if (chapterIndex < 0 || chapterIndex >= totalChapters) return;

      chapterQueuedAtRef.current.set(chapterIndex, performance.now());
      const stage1StartedAt = performance.now();
      const blocks = parseChapterHtml(html);
      stage1ByChapterRef.current.set(
        chapterIndex,
        performance.now() - stage1StartedAt,
      );
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
      beginFontSwitchTrace(config);
    }
    previousConfigRef.current = config;

    postCommand({
      type: "updateConfig",
      config,
    });
  }, [
    beginFontSwitchTrace,
    config,
    totalChapters,
    postCommand,
  ]);

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

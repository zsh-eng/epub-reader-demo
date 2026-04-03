import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ContentAnchor,
  PaginationCommand,
  PaginationEvent,
} from "./engine-types";
import { shouldAcceptPaginationEvent } from "./pagination-revision";
import { PaginationTracer } from "./pagination-tracer";
import { parseChapterHtml } from "./parse-html";
import {
  areFontConfigsEqual,
  type PageSlice,
  type PaginationConfig,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaginationStatus = "idle" | "loading" | "partial" | "ready";

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

  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
  goToChapterIndex: (chapterIndex: number) => void;
  addChapter: (chapterIndex: number, html: string) => void;

  status: PaginationStatus;
  tracer: PaginationTracer;
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

  const workerRef = useRef<Worker | null>(null);
  const currentPageRef = useRef(1);
  const totalPagesRef = useRef<number | null>(null);
  const estimatedTotalPagesRef = useRef<number | null>(null);
  const latestBodyFamilyRef = useRef(config.fontConfig.bodyFamily);
  const nextLayoutRevisionRef = useRef(1);
  const latestPostedLayoutRevisionRef = useRef(0);
  const tracerRef = useRef(new PaginationTracer());

  // Keep refs in sync for use in callbacks.
  // Use effects so re-renders don't reset optimistic navigation refs
  // before worker responses arrive.
  useEffect(() => {
    console.log("current page was updated", performance.now() / 1000);
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

  const markFontSwitchIntent = useCallback((from: string, to: string) => {
    tracerRef.current.recordIntent(from, to);
  }, []);

  const postCommand = useCallback((cmd: PaginationCommand) => {
    const advancesLayoutRevision =
      cmd.type === "init" || cmd.type === "updateConfig";
    const revision = advancesLayoutRevision
      ? nextLayoutRevisionRef.current++
      : latestPostedLayoutRevisionRef.current;

    if (advancesLayoutRevision) {
      latestPostedLayoutRevisionRef.current = revision;
    }

    const commandWithRevision: PaginationCommand = {
      ...cmd,
      revision,
    };

    tracerRef.current.recordPostedCommand(commandWithRevision, {
      immediate: cmd.type === "init",
    });
    workerRef.current?.postMessage(commandWithRevision);
  }, []);

  useEffect(() => {
    return () => {
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
      if (
        !shouldAcceptPaginationEvent(
          event,
          latestPostedLayoutRevisionRef.current,
        )
      ) {
        return;
      }

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
          tracerRef.current.updateDiagnostics(event.diagnostics);
          setStatus("ready");

          const resolvedPage =
            event.resolvedPage === null
              ? null
              : clamp(event.resolvedPage, 1, event.totalPages);

          if (resolvedPage !== null) {
            console.log(
              "applying the READY resolved page",
              performance.now() / 1000,
              event.slices,
            );
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
          tracerRef.current.finalizeChapter(
            event.chapterIndex,
            event.chapterDiagnostics,
          );
          tracerRef.current.updateDiagnostics(null);
          setStatus("partial");

          if (event.resolvedPage !== null) {
            console.log(
              "applying the partial ready resolved page",
              performance.now() / 1000,
              event.slices,
            );
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
          tracerRef.current.finalizeChapter(
            event.chapterIndex,
            event.chapterDiagnostics,
          );
          tracerRef.current.updateDiagnostics(null);
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
    tracerRef.current.reset();
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
  }, [totalChapters, config, initialChapterIndex, initialAnchor, postCommand]);

  const addChapter = useCallback(
    (chapterIndex: number, html: string) => {
      if (totalChapters <= 0) return;
      if (chapterIndex < 0 || chapterIndex >= totalChapters) return;

      tracerRef.current.recordChapterQueued(chapterIndex);
      const stage1StartedAt = performance.now();
      const blocks = parseChapterHtml(html);
      tracerRef.current.recordStage1(
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
      tracerRef.current.beginFontSwitch(config);
    }
    previousConfigRef.current = config;

    console.log("sending update for config", performance.now() / 1000, config);
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
        maxKnownPages === null
          ? normalized
          : clamp(normalized, 1, maxKnownPages);
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
    tracer: tracerRef.current,
    markFontSwitchIntent,
  };
}

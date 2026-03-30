import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ContentAnchor,
  PaginationCommand,
  PaginationEvent,
} from "./engine-types";
import { parseChapterHtml } from "./parse-html";
import type {
  FontConfig,
  LayoutTheme,
  PageSlice,
  PaginationDiagnostics,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaginationStatus = "idle" | "loading" | "partial" | "ready";

export interface UsePaginationResult {
  slices: PageSlice[];
  currentPage: number;
  totalPages: number | null;
  estimatedTotalPages: number | null;

  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
  addChapter: (chapterIndex: number, html: string) => void;

  status: PaginationStatus;
  diagnostics: PaginationDiagnostics | null;
}

export interface UsePaginationOptions {
  totalChapters: number;
  fontConfig: FontConfig;
  layoutTheme: LayoutTheme;
  viewport: { width: number; height: number };
  initialChapterIndex?: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function usePagination(
  options: UsePaginationOptions,
): UsePaginationResult {
  const {
    totalChapters,
    fontConfig,
    layoutTheme,
    viewport,
    initialChapterIndex,
  } = options;

  const [slices, setSlices] = useState<PageSlice[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [estimatedTotalPages, setEstimatedTotalPages] = useState<number | null>(
    null,
  );
  const [status, setStatus] = useState<PaginationStatus>("idle");
  const [diagnostics, setDiagnostics] = useState<PaginationDiagnostics | null>(
    null,
  );

  const workerRef = useRef<Worker | null>(null);
  const chapterPageOffsetsRef = useRef<number[]>([]);
  const currentPageRef = useRef(1);
  const totalPagesRef = useRef<number | null>(null);

  // Keep refs in sync for use in callbacks
  currentPageRef.current = currentPage;
  totalPagesRef.current = totalPages;

  // Track previous values to detect changes
  const prevTotalChaptersRef = useRef<number | null>(null);
  const prevInitialChapterIndexRef = useRef<number | null>(null);
  const prevFontConfigRef = useRef<FontConfig>(fontConfig);
  const prevViewportRef = useRef(viewport);
  const prevLayoutThemeRef = useRef<LayoutTheme>(layoutTheme);

  // Store last known slices' first blockId for content anchoring
  const lastAnchorRef = useRef<ContentAnchor | null>(null);

  const postCommand = useCallback((cmd: PaginationCommand) => {
    workerRef.current?.postMessage(cmd);
  }, []);

  const getContentAnchor = useCallback((): ContentAnchor | null => {
    return lastAnchorRef.current;
  }, []);

  const updateAnchorFromSlices = useCallback(
    (pageSlices: PageSlice[], page: number) => {
      if (pageSlices.length === 0) return;
      const offsets = chapterPageOffsetsRef.current;
      const pageIndex = page - 1;

      // Find which chapter this page belongs to
      let chapterIndex = 0;
      for (let i = offsets.length - 1; i >= 0; i--) {
        if (pageIndex >= (offsets[i] ?? 0)) {
          chapterIndex = i;
          break;
        }
      }

      const firstSlice = pageSlices[0];
      if (firstSlice) {
        lastAnchorRef.current = {
          chapterIndex,
          blockId: firstSlice.blockId,
        };
      }
    },
    [],
  );

  // Handle worker events
  const handleEvent = useCallback(
    (event: PaginationEvent) => {
      switch (event.type) {
        case "ready": {
          chapterPageOffsetsRef.current = event.chapterPageOffsets;
          setTotalPages(event.totalPages);
          setEstimatedTotalPages(null);
          setDiagnostics(event.diagnostics);
          setStatus("ready");

          if (event.anchorPage !== null) {
            const clamped = clamp(event.anchorPage, 1, event.totalPages);
            setCurrentPage(clamped);
            setSlices(event.slices);
            updateAnchorFromSlices(event.slices, clamped);
          } else {
            // Clamp current page to new total
            setCurrentPage((prev) => {
              const clamped = clamp(prev, 1, event.totalPages);
              if (clamped === 1 && event.slices.length > 0) {
                setSlices(event.slices);
                updateAnchorFromSlices(event.slices, 1);
              } else if (clamped !== 1) {
                // Request the correct page
                postCommand({ type: "getPage", globalPage: clamped });
              }
              return clamped;
            });

            // If page is 1, use the provided slices
            if (currentPageRef.current === 1) {
              setSlices(event.slices);
              updateAnchorFromSlices(event.slices, 1);
            }
          }
          break;
        }

        case "pageContent": {
          setSlices(event.slices);
          updateAnchorFromSlices(event.slices, event.globalPage);
          break;
        }

        case "partialReady": {
          chapterPageOffsetsRef.current = event.chapterPageOffsets;
          setEstimatedTotalPages(event.estimatedTotalPages);
          setStatus("partial");

          if (event.anchorPage !== null) {
            setCurrentPage(event.anchorPage);
            setSlices(event.slices);
            updateAnchorFromSlices(event.slices, event.anchorPage);
          }
          break;
        }

        case "progress": {
          chapterPageOffsetsRef.current = event.chapterPageOffsets;
          setEstimatedTotalPages(event.runningTotalPages);
          break;
        }

        case "error": {
          console.error("[pagination worker]", event.message);
          break;
        }
      }
    },
    [postCommand, updateAnchorFromSlices],
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
    setTotalPages(null);
    setEstimatedTotalPages(null);
    setDiagnostics(null);
    chapterPageOffsetsRef.current = [];
    lastAnchorRef.current = null;

    postCommand({
      type: "init",
      totalChapters,
      fontConfig,
      layoutTheme,
      viewport,
      initialChapterIndex: nextInitialChapterIndex,
    });

    prevTotalChaptersRef.current = totalChapters;
    prevInitialChapterIndexRef.current = nextInitialChapterIndex;

    // Update prev refs so we don't immediately re-send config changes
    prevFontConfigRef.current = fontConfig;
    prevViewportRef.current = viewport;
    prevLayoutThemeRef.current = layoutTheme;
  }, [
    totalChapters,
    fontConfig,
    layoutTheme,
    viewport,
    initialChapterIndex,
    postCommand,
  ]);

  const addChapter = useCallback(
    (chapterIndex: number, html: string) => {
      if (totalChapters <= 0) return;

      const blocks = parseChapterHtml(html);
      postCommand({ type: "addChapter", chapterIndex, blocks });
    },
    [postCommand, totalChapters],
  );

  // Send font config changes
  useEffect(() => {
    if (totalChapters <= 0) return;
    if (fontConfig === prevFontConfigRef.current) return;
    prevFontConfigRef.current = fontConfig;

    setStatus("loading");
    postCommand({
      type: "setFontConfig",
      fontConfig,
      anchor: getContentAnchor(),
    });
  }, [fontConfig, totalChapters, postCommand, getContentAnchor]);

  // Send viewport changes
  useEffect(() => {
    if (totalChapters <= 0) return;
    const prev = prevViewportRef.current;
    if (viewport.width === prev.width && viewport.height === prev.height)
      return;
    prevViewportRef.current = viewport;

    postCommand({
      type: "setViewport",
      width: viewport.width,
      height: viewport.height,
      anchor: getContentAnchor(),
    });
  }, [viewport, totalChapters, postCommand, getContentAnchor]);

  // Send layout theme changes
  useEffect(() => {
    if (totalChapters <= 0) return;
    if (layoutTheme === prevLayoutThemeRef.current) return;
    prevLayoutThemeRef.current = layoutTheme;

    postCommand({
      type: "setLayoutTheme",
      layoutTheme,
      anchor: getContentAnchor(),
    });
  }, [layoutTheme, totalChapters, postCommand, getContentAnchor]);

  // Navigation
  const nextPage = useCallback(() => {
    setCurrentPage((prev) => {
      const max = totalPagesRef.current ?? prev;
      const next = Math.min(max, prev + 1);
      if (next !== prev) {
        postCommand({ type: "getPage", globalPage: next });
      }
      return next;
    });
  }, [postCommand]);

  const prevPage = useCallback(() => {
    setCurrentPage((prev) => {
      const next = Math.max(1, prev - 1);
      if (next !== prev) {
        postCommand({ type: "getPage", globalPage: next });
      }
      return next;
    });
  }, [postCommand]);

  const goToPage = useCallback(
    (page: number) => {
      const max = totalPagesRef.current ?? 1;
      const clamped = clamp(page, 1, max);
      setCurrentPage(clamped);
      postCommand({ type: "getPage", globalPage: clamped });
    },
    [postCommand],
  );

  return {
    slices,
    currentPage,
    totalPages,
    estimatedTotalPages,
    nextPage,
    prevPage,
    goToPage,
    addChapter,
    status,
    diagnostics,
  };
}

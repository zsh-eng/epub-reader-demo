import { useCallback, useEffect, useRef, useState } from "react";
import type {
    ContentAnchor,
    PaginationCommand,
    PaginationEvent,
} from "./engine-types";
import { parseChapterHtml } from "./parse-html";
import type {
    Block,
    FontConfig,
    LayoutTheme,
    PageSlice,
    PaginationDiagnostics,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChapterInput {
  index: number;
  html: string;
}

export type PaginationStatus = "idle" | "loading" | "partial" | "ready";

export interface UsePaginationResult {
  slices: PageSlice[];
  currentPage: number;
  totalPages: number | null;
  estimatedTotalPages: number | null;

  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;

  status: PaginationStatus;
  diagnostics: PaginationDiagnostics | null;
}

export interface UsePaginationOptions {
  chapters: ChapterInput[] | undefined;
  fontConfig: FontConfig;
  layoutTheme: LayoutTheme;
  viewport: { width: number; height: number };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function usePagination(options: UsePaginationOptions): UsePaginationResult {
  const { chapters, fontConfig, layoutTheme, viewport } = options;

  const [slices, setSlices] = useState<PageSlice[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [estimatedTotalPages, setEstimatedTotalPages] = useState<number | null>(null);
  const [status, setStatus] = useState<PaginationStatus>("idle");
  const [diagnostics, setDiagnostics] = useState<PaginationDiagnostics | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const chapterPageOffsetsRef = useRef<number[]>([]);
  const currentPageRef = useRef(1);
  const totalPagesRef = useRef<number | null>(null);

  // Keep refs in sync for use in callbacks
  currentPageRef.current = currentPage;
  totalPagesRef.current = totalPages;

  // Track previous values to detect changes
  const prevChaptersRef = useRef<ChapterInput[] | undefined>(undefined);
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

  const updateAnchorFromSlices = useCallback((pageSlices: PageSlice[], page: number) => {
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
  }, []);

  // Handle worker events
  const handleEvent = useCallback((event: PaginationEvent) => {
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
  }, [postCommand, updateAnchorFromSlices]);

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

  // Send load command when chapters change
  useEffect(() => {
    if (!chapters || chapters.length === 0) {
      prevChaptersRef.current = chapters;
      return;
    }

    if (chapters === prevChaptersRef.current) return;
    prevChaptersRef.current = chapters;

    setStatus("loading");
    setTotalPages(null);
    setEstimatedTotalPages(null);

    // Parse HTML on main thread (DOMParser not available in worker)
    const blocksByChapter: Block[][] = chapters.map((ch) => parseChapterHtml(ch.html));

    postCommand({
      type: "load",
      blocksByChapter,
      fontConfig,
      layoutTheme,
      viewport,
    });

    // Update prev refs so we don't re-send config changes
    prevFontConfigRef.current = fontConfig;
    prevViewportRef.current = viewport;
    prevLayoutThemeRef.current = layoutTheme;
  }, [chapters, fontConfig, layoutTheme, viewport, postCommand]);

  // Send font config changes
  useEffect(() => {
    if (!chapters || chapters.length === 0) return;
    if (fontConfig === prevFontConfigRef.current) return;
    prevFontConfigRef.current = fontConfig;

    setStatus("loading");
    postCommand({
      type: "setFontConfig",
      fontConfig,
      anchor: getContentAnchor(),
    });
  }, [fontConfig, chapters, postCommand, getContentAnchor]);

  // Send viewport changes
  useEffect(() => {
    if (!chapters || chapters.length === 0) return;
    const prev = prevViewportRef.current;
    if (viewport.width === prev.width && viewport.height === prev.height) return;
    prevViewportRef.current = viewport;

    console.log("Viewport changed to", viewport);
    postCommand({
      type: "setViewport",
      width: viewport.width,
      height: viewport.height,
      anchor: getContentAnchor(),
    });
  }, [viewport, chapters, postCommand, getContentAnchor]);

  // Send layout theme changes
  useEffect(() => {
    if (!chapters || chapters.length === 0) return;
    if (layoutTheme === prevLayoutThemeRef.current) return;
    prevLayoutThemeRef.current = layoutTheme;

    postCommand({
      type: "setLayoutTheme",
      layoutTheme,
      anchor: getContentAnchor(),
    });
  }, [layoutTheme, chapters, postCommand, getContentAnchor]);

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

  const goToPage = useCallback((page: number) => {
    const max = totalPagesRef.current ?? 1;
    const clamped = clamp(page, 1, max);
    setCurrentPage(clamped);
    postCommand({ type: "getPage", globalPage: clamped });
  }, [postCommand]);

  return {
    slices,
    currentPage,
    totalPages,
    estimatedTotalPages,
    nextPage,
    prevPage,
    goToPage,
    status,
    diagnostics,
  };
}

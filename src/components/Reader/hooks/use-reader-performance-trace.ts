import type { Book } from "@/lib/db";
import type { PaginationStatus } from "@/lib/pagination-v2";
import {
  completeReaderTrace,
  endReaderTraceSpan,
  ensureReaderTrace,
  markReaderTraceOnce,
  recordReaderTraceSpan,
  startReaderTraceSpan,
  updateReaderTraceMetadata,
} from "@/lib/reader-performance-trace";
import type { ReaderSettings } from "@/types/reader.types";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReaderSessionStatus } from "./use-reader-session";

/** Starts a fallback trace for direct reader URLs and browser restores. */
export function useReaderPerformanceTraceRoute(
  bookId: string | undefined,
): void {
  const deferredInterruptRef = useRef<number | null>(null);

  useEffect(() => {
    if (!bookId) return;
    if (deferredInterruptRef.current !== null) {
      window.clearTimeout(deferredInterruptRef.current);
      deferredInterruptRef.current = null;
    }

    ensureReaderTrace({ bookId });
    markReaderTraceOnce("reader-route-mounted", "navigation");
    const supportsLongTasks =
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes?.includes("longtask");
    const longTaskObserver = supportsLongTasks
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            recordReaderTraceSpan({
              name: "main-thread-long-task",
              lane: "processing",
              startPerformanceMs: entry.startTime,
              endPerformanceMs: entry.startTime + entry.duration,
              details: { durationMs: Math.round(entry.duration * 10) / 10 },
            });
          }
        })
      : null;
    longTaskObserver?.observe({ type: "longtask", buffered: true });

    return () => {
      longTaskObserver?.disconnect();
      // Defer the interrupt so React Strict Mode can remount the same route
      // without producing a false interrupted trace in development.
      deferredInterruptRef.current = window.setTimeout(() => {
        completeReaderTrace("interrupted", {
          reason: "reader-route-unmounted",
        });
        deferredInterruptRef.current = null;
      }, 0);
    };
  }, [bookId]);
}

/**
 * Records separate first-content and fully-settled paint milestones. The first
 * spread stays mounted while its images load, so asset readiness must not be
 * reported as the first time browser content can paint.
 */
export function useReaderPerformanceTraceLifecycle(options: {
  bookId: string | undefined;
  book: Book | null;
  status: ReaderSessionStatus;
  paginationStatus: PaginationStatus;
  displayReady: boolean;
  chapterCount: number;
  viewport: { width: number; height: number };
  spreadColumns: 1 | 2 | 3;
  settings: ReaderSettings;
}): void {
  const {
    bookId,
    book,
    status,
    paginationStatus,
    displayReady,
    chapterCount,
    viewport,
    spreadColumns,
    settings,
  } = options;
  const [paintedBookId, setPaintedBookId] = useState<string | null>(null);

  useEffect(() => {
    if (!book) return;

    updateReaderTraceMetadata(
      {
        author: book.author,
        fileSizeBytes: book.fileSize,
        chapterCount,
        viewportWidth: Math.round(viewport.width),
        viewportHeight: Math.round(viewport.height),
        spreadColumns,
        publisherBookStylingEnabled: settings.publisherBookStylingEnabled,
        matchPublisherBodyTextSize: settings.matchPublisherBodyTextSize,
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize,
      },
      book.title,
    );
    markReaderTraceOnce("book-metadata-ready", "storage");
  }, [
    book,
    chapterCount,
    settings.fontFamily,
    settings.fontSize,
    settings.matchPublisherBodyTextSize,
    settings.publisherBookStylingEnabled,
    spreadColumns,
    viewport.height,
    viewport.width,
  ]);

  useEffect(() => {
    if (status === "ready") {
      markReaderTraceOnce("first-spread-resolved", "pagination");
      return;
    }

    if (status === "not-found" || status === "file-error") {
      completeReaderTrace("error", { reason: status });
    }
  }, [status]);

  useLayoutEffect(() => {
    if (!bookId || status !== "ready") return;

    markReaderTraceOnce("first-spread-dom-committed", "reveal");
    const frameSpan = startReaderTraceSpan(
      "first-spread-commit-to-painted-frame",
      "reveal",
    );
    let secondFrameId: number | null = null;
    const firstFrameId = requestAnimationFrame(() => {
      secondFrameId = requestAnimationFrame(() => {
        endReaderTraceSpan(frameSpan);
        markReaderTraceOnce("first-spread-frame-painted", "reveal");
      });
    });

    return () => {
      cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== null) cancelAnimationFrame(secondFrameId);
    };
  }, [bookId, status]);

  useEffect(() => {
    if (!bookId || !displayReady) return;

    markReaderTraceOnce("reader-display-ready", "reveal");
    let secondFrameId: number | null = null;
    const firstFrameId = requestAnimationFrame(() => {
      secondFrameId = requestAnimationFrame(() => {
        markReaderTraceOnce("reader-settled-frame-painted", "reveal");
        setPaintedBookId(bookId);
      });
    });

    return () => {
      cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== null) cancelAnimationFrame(secondFrameId);
    };
  }, [bookId, displayReady]);

  useEffect(() => {
    if (!bookId || paintedBookId !== bookId || paginationStatus !== "ready") {
      return;
    }

    markReaderTraceOnce("all-chapters-paginated", "pagination");
    completeReaderTrace("completed");
  }, [bookId, paginationStatus, paintedBookId]);
}

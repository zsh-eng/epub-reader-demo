import type { Book } from "@/lib/db";
import type { PaginationStatus } from "@/lib/pagination-v2";
import {
  completeReaderTrace,
  ensureReaderTrace,
  markReaderTraceOnce,
  updateReaderTraceMetadata,
} from "@/lib/reader-performance-trace";
import type { ReaderSettings } from "@/types/reader.types";
import { useEffect, useRef, useState } from "react";
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

    return () => {
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
 * Records the reader-level milestones which sit above storage and pagination.
 * The trace ends after two animation frames so its duration includes the first
 * frame which can contain the fully revealed reader.
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

  useEffect(() => {
    if (!bookId || !displayReady) return;

    markReaderTraceOnce("reader-display-ready", "reveal");
    let secondFrameId: number | null = null;
    const firstFrameId = requestAnimationFrame(() => {
      secondFrameId = requestAnimationFrame(() => {
        markReaderTraceOnce("first-reader-frame-painted", "reveal");
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

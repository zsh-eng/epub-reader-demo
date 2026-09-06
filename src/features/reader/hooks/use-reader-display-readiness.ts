import {
  endReaderTraceSpan,
  markReaderTraceOnce,
  startReaderTraceSpan,
  type ReaderTraceSpanToken,
} from "@/lib/reader-performance-trace";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

interface UseReaderDisplayReadinessOptions {
  bookId?: string;
  contentReady: boolean;
  stageContentRef: RefObject<HTMLDivElement | null>;
}

interface ReaderDisplayReadiness {
  displayReady: boolean;
  settledPaintReady: boolean;
}

const VISIBLE_PENDING_IMAGE_SELECTOR =
  "[data-reader-spread-layer='current'] [data-reader-image-pending]";

/**
 * Keeps the reader hidden until its first spread, fonts, and visible images
 * are ready to paint. The result stays ready for later page changes so normal
 * navigation does not blank the reader again.
 */
export function useReaderDisplayReadiness({
  bookId,
  contentReady,
  stageContentRef,
}: UseReaderDisplayReadinessOptions): ReaderDisplayReadiness {
  const [readyBookId, setReadyBookId] = useState<string | null>(null);
  const [settledBookId, setSettledBookId] = useState<string | null>(null);
  const readyCommitSpanRef = useRef<ReaderTraceSpanToken | null>(null);
  const settledFrameSpanRef = useRef<ReaderTraceSpanToken | null>(null);
  const displayReady = !!bookId && readyBookId === bookId;
  const settledPaintReady = !!bookId && settledBookId === bookId;

  useLayoutEffect(() => {
    if (!displayReady) return;
    endReaderTraceSpan(readyCommitSpanRef.current);
    readyCommitSpanRef.current = null;
  }, [displayReady]);

  useLayoutEffect(() => {
    if (!settledPaintReady) return;
    markReaderTraceOnce("reader-settled-react-commit", "reveal", {
      visibilityState: document.visibilityState,
      documentHasFocus: document.hasFocus(),
    });
    endReaderTraceSpan(settledFrameSpanRef.current, {
      visibilityState: document.visibilityState,
      documentHasFocus: document.hasFocus(),
    });
    settledFrameSpanRef.current = null;
  }, [settledPaintReady]);

  useEffect(() => {
    if (!bookId || !contentReady || readyBookId === bookId) return;

    const stage = stageContentRef.current;
    if (!stage) return;

    let cancelled = false;
    let frameId: number | null = null;
    const displaySettleSpan = startReaderTraceSpan(
      "display-assets-settle",
      "reveal",
    );
    const documentFontsSpan = startReaderTraceSpan(
      "document-fonts-ready",
      "assets",
    );
    let visibleImagesSpan = stage.querySelector(
      VISIBLE_PENDING_IMAGE_SELECTOR,
    )
      ? startReaderTraceSpan("visible-images-ready", "assets")
      : null;

    const markReadyIfSettled = () => {
      if (stage.querySelector(VISIBLE_PENDING_IMAGE_SELECTOR)) {
        visibleImagesSpan ??= startReaderTraceSpan(
          "visible-images-ready",
          "assets",
        );
        return;
      }

      endReaderTraceSpan(visibleImagesSpan);
      visibleImagesSpan = null;

      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;
        if (cancelled) return;
        if (stage.querySelector(VISIBLE_PENDING_IMAGE_SELECTOR)) return;
        endReaderTraceSpan(displaySettleSpan);
        readyCommitSpanRef.current = startReaderTraceSpan(
          "display-ready-react-transition",
          "processing",
          { trigger: "visible-assets-settled" },
        );
        setReadyBookId(bookId);
      });
    };

    const observer = new MutationObserver(markReadyIfSettled);
    observer.observe(stage, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    void document.fonts.ready.then(() => {
      if (cancelled) return;
      endReaderTraceSpan(documentFontsSpan);
      markReadyIfSettled();
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [bookId, contentReady, readyBookId, stageContentRef]);

  useEffect(() => {
    if (!bookId || !displayReady || settledBookId === bookId) return;

    settledFrameSpanRef.current = startReaderTraceSpan(
      "reader-settled-frame-confirmation",
      "reveal",
      {
        visibilityState: document.visibilityState,
        documentHasFocus: document.hasFocus(),
      },
    );
    markReaderTraceOnce("reader-settled-frame-scheduled", "reveal", {
      visibilityState: document.visibilityState,
      documentHasFocus: document.hasFocus(),
    });
    let secondFrameId: number | null = null;
    const firstFrameId = requestAnimationFrame(() => {
      markReaderTraceOnce("reader-settled-frame-raf-1", "reveal", {
        visibilityState: document.visibilityState,
        documentHasFocus: document.hasFocus(),
      });
      secondFrameId = requestAnimationFrame(() => {
        markReaderTraceOnce("reader-settled-frame-raf-2", "reveal", {
          visibilityState: document.visibilityState,
          documentHasFocus: document.hasFocus(),
        });
        setSettledBookId(bookId);
      });
    });

    return () => {
      cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== null) cancelAnimationFrame(secondFrameId);
      endReaderTraceSpan(settledFrameSpanRef.current, { cancelled: true });
      settledFrameSpanRef.current = null;
    };
  }, [bookId, displayReady, settledBookId]);

  return {
    displayReady,
    settledPaintReady,
  };
}

import { useEffect, useState, type RefObject } from "react";

interface UseReaderDisplayReadinessOptions {
  bookId?: string;
  contentReady: boolean;
  stageContentRef: RefObject<HTMLDivElement | null>;
}

/**
 * Keeps the reader hidden until its first spread, fonts, and visible images
 * are ready to paint. The result stays ready for later page changes so normal
 * navigation does not blank the reader again.
 */
export function useReaderDisplayReadiness({
  bookId,
  contentReady,
  stageContentRef,
}: UseReaderDisplayReadinessOptions): boolean {
  const [readyBookId, setReadyBookId] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId || !contentReady || readyBookId === bookId) return;

    const stage = stageContentRef.current;
    if (!stage) return;

    let cancelled = false;
    let frameId: number | null = null;

    const markReadyIfSettled = () => {
      if (stage.querySelector("[data-reader-image-pending]")) return;

      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;
        if (cancelled) return;
        if (stage.querySelector("[data-reader-image-pending]")) return;
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
      if (!cancelled) markReadyIfSettled();
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [bookId, contentReady, readyBookId, stageContentRef]);

  return !!bookId && readyBookId === bookId;
}

import type { AnnotationColor } from "@/lib/highlight-constants";
import {
  prepareBlocks,
  resolveContentAnchorRangeToHighlight,
  resolveDomEndpointToContentAnchor,
  type Block,
  type FontConfig,
  type PreparedBlock,
  type ResolvedSpread,
} from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import { getSelectionPosition } from "@zsh-eng/text-highlighter";
import {
  useCallback,
  useEffect,
  useState,
  type RefObject,
} from "react";
import type { ChapterEntry } from "../types";

interface PendingHighlightDraft {
  position: { x: number; y: number };
  spineItemId: string;
  highlight: NonNullable<
    ReturnType<typeof resolveContentAnchorRangeToHighlight>
  >;
}

interface UseReaderTextSelectionOptions {
  bookId?: string;
  spread: ResolvedSpread | null;
  stageContentRef: RefObject<HTMLDivElement | null>;
  chapterEntries: ChapterEntry[];
  fontConfig: FontConfig;
  getChapterBlocks: (chapterIndex: number) => Block[] | null;
  onHighlightCreate?: (highlight: Highlight) => void;
}

interface UseReaderTextSelectionResult {
  showHighlightToolbar: boolean;
  toolbarPosition: { x: number; y: number };
  handleHighlightColorSelect: (color: AnnotationColor) => void;
  handleCloseHighlightToolbar: () => void;
}

function clearDomSelection(): void {
  window.getSelection()?.removeAllRanges();
}

function buildPreparedByVisibleChapter(
  spread: ResolvedSpread,
  fontConfig: FontConfig,
  getChapterBlocks: (chapterIndex: number) => Block[] | null,
): (PreparedBlock[] | null)[] {
  const preparedByChapter: (PreparedBlock[] | null)[] = [];

  for (const slot of spread.slots) {
    if (slot.kind !== "page") continue;

    const { chapterIndex } = slot.page;
    if (preparedByChapter[chapterIndex] !== undefined) continue;

    const chapterBlocks = getChapterBlocks(chapterIndex);
    preparedByChapter[chapterIndex] = chapterBlocks
      ? prepareBlocks(chapterBlocks, fontConfig)
      : null;
  }

  return preparedByChapter;
}

function isSelectionInsideContainer(
  selection: Selection,
  container: HTMLDivElement,
): boolean {
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;

  return (
    !!anchorNode &&
    !!focusNode &&
    container.contains(anchorNode) &&
    container.contains(focusNode)
  );
}

export function useReaderTextSelection({
  bookId,
  spread,
  stageContentRef,
  chapterEntries,
  fontConfig,
  getChapterBlocks,
  onHighlightCreate,
}: UseReaderTextSelectionOptions): UseReaderTextSelectionResult {
  const [pendingHighlight, setPendingHighlight] =
    useState<PendingHighlightDraft | null>(null);

  const clearPendingHighlight = useCallback((clearSelection: boolean) => {
    if (clearSelection) {
      clearDomSelection();
    }
    setPendingHighlight(null);
  }, []);

  const resolvePendingHighlight = useCallback(
    (selection: Selection): PendingHighlightDraft | null => {
      const container = stageContentRef.current;
      if (!container || !spread) return null;
      if (!selection.rangeCount || selection.isCollapsed) return null;
      if (!selection.toString().trim()) return null;
      if (!isSelectionInsideContainer(selection, container)) return null;

      const range = selection.getRangeAt(0);
      const position = getSelectionPosition(selection);
      if (!position) return null;

      const preparedByChapter = buildPreparedByVisibleChapter(
        spread,
        fontConfig,
        getChapterBlocks,
      );

      const startAnchor = resolveDomEndpointToContentAnchor({
        node: range.startContainer,
        offset: range.startOffset,
        spread,
        preparedByChapter,
      });
      const endAnchor = resolveDomEndpointToContentAnchor({
        node: range.endContainer,
        offset: range.endOffset,
        spread,
        preparedByChapter,
      });

      if (!startAnchor || !endAnchor) return null;
      if (startAnchor.chapterIndex !== endAnchor.chapterIndex) return null;

      const chapterBlocks = getChapterBlocks(startAnchor.chapterIndex);
      const preparedChapter = preparedByChapter[startAnchor.chapterIndex];
      if (!chapterBlocks || !preparedChapter) return null;

      const highlight = resolveContentAnchorRangeToHighlight({
        startAnchor,
        endAnchor,
        chapterBlocks,
        preparedChapter,
      });
      if (!highlight) return null;

      const chapter = chapterEntries[startAnchor.chapterIndex];
      if (!chapter) return null;

      return {
        position,
        spineItemId: chapter.spineItemId,
        highlight,
      };
    },
    [chapterEntries, fontConfig, getChapterBlocks, spread, stageContentRef],
  );

  useEffect(() => {
    const handleResolvedSelection = () => {
      const selection = window.getSelection();
      if (!selection) {
        setPendingHighlight(null);
        return;
      }

      const nextPendingHighlight = resolvePendingHighlight(selection);
      setPendingHighlight(nextPendingHighlight);
    };

    let timeoutId = 0;
    const isTouchDevice =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const delay = isTouchDevice ? 300 : 100;

    const handlePointerUp = () => {
      timeoutId = window.setTimeout(handleResolvedSelection, delay);
    };

    const handleSelectionChange = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };

    document.addEventListener("mouseup", handlePointerUp);
    document.addEventListener("touchend", handlePointerUp);
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("mouseup", handlePointerUp);
      document.removeEventListener("touchend", handlePointerUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [resolvePendingHighlight]);

  useEffect(() => {
    clearPendingHighlight(true);
  }, [
    clearPendingHighlight,
    spread?.currentSpread,
    spread?.chapterIndexStart,
    spread?.chapterIndexEnd,
  ]);

  const handleHighlightColorSelect = useCallback(
    (color: AnnotationColor) => {
      if (!pendingHighlight || !bookId) {
        clearPendingHighlight(true);
        return;
      }

      onHighlightCreate?.({
        id: crypto.randomUUID(),
        bookId,
        spineItemId: pendingHighlight.spineItemId,
        startOffset: pendingHighlight.highlight.startOffset,
        endOffset: pendingHighlight.highlight.endOffset,
        selectedText: pendingHighlight.highlight.selectedText,
        textBefore: pendingHighlight.highlight.textBefore,
        textAfter: pendingHighlight.highlight.textAfter,
        color,
        createdAt: new Date(),
      });

      clearPendingHighlight(true);
    },
    [bookId, clearPendingHighlight, onHighlightCreate, pendingHighlight],
  );

  const handleCloseHighlightToolbar = useCallback(() => {
    clearPendingHighlight(true);
  }, [clearPendingHighlight]);

  return {
    showHighlightToolbar: !!pendingHighlight,
    toolbarPosition: pendingHighlight?.position ?? { x: 0, y: 0 },
    handleHighlightColorSelect,
    handleCloseHighlightToolbar,
  };
}

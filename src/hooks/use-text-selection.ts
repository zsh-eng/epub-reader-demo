import { getSelectionPosition } from "@/lib/highlight-utils";
import { createHighlightFromSelection } from "@/lib/highlight-utils";
import type { Highlight, HighlightColor } from "@/types/highlight";
import { useEffect, useState } from "react";

export interface UseTextSelectionReturn {
  showHighlightToolbar: boolean;
  toolbarPosition: { x: number; y: number };
  currentSelection: Selection | null;
  handleHighlightColorSelect: (color: HighlightColor) => void;
  handleCloseHighlightToolbar: () => void;
}

export function useTextSelection(
  contentRef: React.RefObject<HTMLDivElement | null>,
  bookId: string | undefined,
  spineItemId: string | undefined,
  onHighlightCreate?: (highlight: Highlight) => void,
): UseTextSelectionReturn {
  const [showHighlightToolbar, setShowHighlightToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ x: 0, y: 0 });
  const [currentSelection, setCurrentSelection] = useState<Selection | null>(
    null,
  );

  // Text selection handler
  useEffect(() => {
    const handleTextSelection = () => {
      const selection = window.getSelection();

      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setShowHighlightToolbar(false);
        return;
      }

      // Check if selection is within the reader content
      if (!contentRef.current?.contains(selection.anchorNode)) {
        setShowHighlightToolbar(false);
        return;
      }

      const position = getSelectionPosition(selection);
      if (position) {
        setToolbarPosition(position);
        setCurrentSelection(selection);
        setShowHighlightToolbar(true);
      }
    };

    // Use a small delay (100ms) to prevent flickering during drag selection
    let timeoutId: number;
    const handleMouseUp = () => {
      timeoutId = window.setTimeout(handleTextSelection, 100);
    };

    const handleSelectionChange = () => {
      // Clear timeout on selection change to avoid showing toolbar prematurely
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [contentRef]);

  const handleHighlightColorSelect = (color: HighlightColor) => {
    if (!currentSelection || !contentRef.current || !bookId || !spineItemId) {
      setShowHighlightToolbar(false);
      return;
    }

    console.log("creating selection", currentSelection);
    const highlightData = createHighlightFromSelection(
      currentSelection,
      contentRef.current,
    );
    console.log("created selection, highlight data is", highlightData);

    if (highlightData) {
      // Create full highlight object
      const highlight: Highlight = {
        id: crypto.randomUUID(),
        bookId,
        spineItemId,
        startOffset: highlightData.startOffset,
        endOffset: highlightData.endOffset,
        selectedText: highlightData.selectedText,
        textBefore: highlightData.textBefore,
        textAfter: highlightData.textAfter,
        color,
        createdAt: new Date(),
      };

      console.log("=== Highlight Created ===");
      console.log("ID:", highlight.id);
      console.log("Color:", highlight.color);
      console.log("Spine Item:", highlight.spineItemId);
      console.log("Start Offset:", highlight.startOffset);
      console.log("End Offset:", highlight.endOffset);
      console.log("Selected Text:", highlight.selectedText);
      console.log("========================");

      // Call the callback to store the highlight
      onHighlightCreate?.(highlight);
    }

    // Clear selection and hide toolbar
    currentSelection.removeAllRanges();
    setShowHighlightToolbar(false);
    setCurrentSelection(null);
  };

  const handleCloseHighlightToolbar = () => {
    setShowHighlightToolbar(false);
    setCurrentSelection(null);
  };

  return {
    showHighlightToolbar,
    toolbarPosition,
    currentSelection,
    handleHighlightColorSelect,
    handleCloseHighlightToolbar,
  };
}

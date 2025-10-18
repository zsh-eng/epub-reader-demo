import { getSelectionPosition } from "@/lib/highlight-utils";
import { createHighlightFromSelection } from "@/lib/highlight-utils";
import { useEffect, useState } from "react";

export interface UseTextSelectionReturn {
  showHighlightToolbar: boolean;
  toolbarPosition: { x: number; y: number };
  currentSelection: Selection | null;
  handleHighlightColorSelect: (color: string) => void;
  handleCloseHighlightToolbar: () => void;
}

export function useTextSelection(
  contentRef: React.RefObject<HTMLDivElement | null>,
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

  const handleHighlightColorSelect = (color: string) => {
    if (!currentSelection || !contentRef.current) {
      setShowHighlightToolbar(false);
      return;
    }

    const highlightData = createHighlightFromSelection(
      currentSelection,
      contentRef.current,
    );

    if (highlightData) {
      console.log("=== Highlight Created ===");
      console.log("Color:", color);
      console.log("Start Offset:", highlightData.startOffset);
      console.log("End Offset:", highlightData.endOffset);
      console.log("Selected Text:", highlightData.selectedText);
      console.log("Text Before:", highlightData.textBefore);
      console.log("Text After:", highlightData.textAfter);
      console.log("========================");

      // TODO: Save to database in next iteration
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

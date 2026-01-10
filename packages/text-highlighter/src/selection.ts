/**
 * Functions for creating highlights from user selections
 */

import type { CreateHighlightResult, SelectionPosition } from "./types";
import { getTextOffset } from "./offsets";

/**
 * Default number of characters to capture for context
 */
const DEFAULT_CONTEXT_LENGTH = 50;

/**
 * Creates highlight data from a user Selection.
 *
 * @param selection - The browser Selection object
 * @param containerElement - The container element that bounds the selectable area
 * @param contextLength - Number of characters to capture before/after (default: 50)
 * @returns Highlight data or null if selection is invalid
 */
export function createHighlightFromSelection(
  selection: Selection,
  containerElement: HTMLElement,
  contextLength: number = DEFAULT_CONTEXT_LENGTH
): CreateHighlightResult | null {
  if (!selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  return createHighlightFromRange(range, containerElement, contextLength);
}

/**
 * Creates highlight data from a Range object.
 * Useful when the Selection is no longer valid but you've preserved the Range.
 *
 * @param range - The DOM Range object
 * @param containerElement - The container element that bounds the selectable area
 * @param contextLength - Number of characters to capture before/after (default: 50)
 * @returns Highlight data or null if range is invalid
 */
export function createHighlightFromRange(
  range: Range,
  containerElement: HTMLElement,
  contextLength: number = DEFAULT_CONTEXT_LENGTH
): CreateHighlightResult | null {
  const selectedText = range.toString().trim();

  if (!selectedText) return null;

  // Get the full text content
  const fullText = containerElement.textContent || "";

  // Calculate offsets
  const startOffset = getTextOffset(
    containerElement,
    range.startContainer,
    range.startOffset
  );
  const endOffset = getTextOffset(
    containerElement,
    range.endContainer,
    range.endOffset
  );

  // Extract context
  const textBefore = fullText.substring(
    Math.max(0, startOffset - contextLength),
    startOffset
  );
  const textAfter = fullText.substring(
    endOffset,
    Math.min(fullText.length, endOffset + contextLength)
  );

  return {
    startOffset,
    endOffset,
    selectedText,
    textBefore,
    textAfter,
  };
}

/**
 * Gets the position of a selection for positioning UI elements (e.g., toolbar).
 * Returns the center-top of the selection bounding box.
 *
 * @param selection - The browser Selection object
 * @returns Position coordinates or null if selection is invalid
 */
export function getSelectionPosition(selection: Selection): SelectionPosition | null {
  if (!selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2,
    y: rect.top,
  };
}

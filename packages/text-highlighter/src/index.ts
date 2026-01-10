/**
 * text-highlighter
 *
 * A lightweight library for creating and restoring text highlights in the DOM.
 * Uses text offsets (not XPath/DOM references) for portable, robust highlights.
 */

// Types
export type {
  TextHighlight,
  ApplyHighlightOptions,
  CreateHighlightResult,
  SelectionPosition,
} from "./types";

// Offset utilities
export { getTextOffset, findRangeByTextOffset, verifyRangeText } from "./offsets";

// Selection utilities
export {
  createHighlightFromSelection,
  createHighlightFromRange,
  getSelectionPosition,
} from "./selection";

// DOM manipulation
export {
  wrapRangeWithHighlight,
  applyHighlight,
  applyHighlights,
  removeHighlight,
  removeHighlightById,
} from "./dom";

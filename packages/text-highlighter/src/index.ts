/**
 * text-highlighter
 *
 * A lightweight library for creating and restoring text highlights in the DOM.
 * Uses text offsets (not XPath/DOM references) for portable, robust highlights.
 */

// Types
export type {
  ApplyHighlightOptions,
  CreateHighlightResult,
  SelectionPosition,
  TextHighlight,
} from "./types";

// Constants
export { HIGHLIGHT_DEFAULTS } from "./constants";
export type { HighlightDefaults } from "./constants";

// Offset utilities
export {
  findRangeByTextOffset,
  getTextOffset,
  verifyRangeText,
} from "./offsets";

// Selection utilities
export {
  createHighlightFromRange,
  createHighlightFromSelection,
  getSelectionPosition,
} from "./selection";

// DOM manipulation
export {
  applyHighlight,
  applyHighlights,
  removeHighlight,
  removeHighlightById,
  wrapRangeWithHighlight,
} from "./dom";

// Interaction management
export { createHighlightInteractionManager } from "./interaction";
export type {
  HighlightInteractionManager,
  HighlightInteractionOptions,
} from "./interaction";

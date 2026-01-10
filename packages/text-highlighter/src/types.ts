/**
 * Core types for text-highlighter
 */

/**
 * Represents a text highlight with position data and context for fallback matching.
 * This schema is designed to be portable and DOM-agnostic.
 */
export interface TextHighlight {
  /** Character offset in text-only content where highlight starts */
  startOffset: number;
  /** Character offset in text-only content where highlight ends */
  endOffset: number;
  /** The actual highlighted text */
  selectedText: string;
  /** Context before the highlight for fallback matching (~50 chars) */
  textBefore?: string;
  /** Context after the highlight for fallback matching (~50 chars) */
  textAfter?: string;
}

/**
 * Options for applying highlights to the DOM
 */
export interface ApplyHighlightOptions {
  /** HTML tag name for the highlight element (default: 'mark') */
  tagName?: string;
  /** CSS class name(s) to add to the highlight element */
  className?: string;
  /** Custom attributes to set on the highlight element */
  attributes?: Record<string, string>;
}

/**
 * Result of creating a highlight from a selection or range
 */
export interface CreateHighlightResult {
  startOffset: number;
  endOffset: number;
  selectedText: string;
  textBefore: string;
  textAfter: string;
}

/**
 * Position information for UI elements (e.g., toolbar positioning)
 */
export interface SelectionPosition {
  x: number;
  y: number;
}

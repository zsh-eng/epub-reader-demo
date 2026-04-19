/**
 * React-specific types for text-highlighter
 */

import type { RefObject } from "react";

/**
 * Base interface for highlights that can be synced to the DOM.
 * Extend this with your own app-specific fields (e.g., color, bookId).
 */
export interface SyncableHighlight {
  id: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  textBefore?: string;
  textAfter?: string;
}

/**
 * Options for the useHighlighter hook.
 *
 * @typeParam T - Your highlight type extending SyncableHighlight
 */
export interface UseHighlighterOptions<T extends SyncableHighlight> {
  /** Ref to the container element holding the highlightable content */
  containerRef: RefObject<HTMLElement | null>;

  /** Array of highlights to sync to the DOM */
  highlights: T[];

  /**
   * Set to true when the container content is ready (e.g., after chapter load).
   * The hook will re-run sync and re-attach event listeners when this changes.
   */
  contentReady: boolean;

  // --- Styling ---

  /** CSS class for highlight elements (default: 'text-highlight') */
  className?: string;

  /** Data attribute for highlight ID (default: 'data-highlight-id') */
  idAttribute?: string;

  /** HTML tag for highlight elements (default: 'mark') */
  tagName?: string;

  /** Class added on hover to all segments of a highlight */
  hoverClass?: string;

  /** Class added when a highlight is active/selected */
  activeClass?: string;

  /**
   * Optional attributes to stamp on the first/last DOM segment for each highlight.
   * Segments between them receive neither attribute.
   */
  segmentBoundaryAttributes?: {
    start: string;
    end: string;
  };

  /**
   * Map a highlight to additional DOM attributes.
   *
   * This function is called for each highlight when syncing to the DOM.
   * When the returned attributes change (e.g., color update), the DOM
   * elements are updated to reflect the new values.
   *
   * @example
   * ```ts
   * getAttributes: (h) => ({ 'data-color': h.color })
   * ```
   */
  getAttributes?: (highlight: T) => Record<string, string>;

  // --- Callbacks ---

  /** Called when a highlight element is clicked */
  onHighlightClick?: (id: string, position: { x: number; y: number }) => void;

  /** Called when hover state changes on a highlight */
  onHighlightHover?: (id: string, isHovering: boolean) => void;
}

/**
 * Return type for the useHighlighter hook.
 */
export interface UseHighlighterReturn {
  /**
   * Set the active highlight (adds active class to matching elements).
   * Pass null to clear the active state.
   */
  setActiveHighlight: (id: string | null) => void;

  /** Get the currently active highlight ID, or null if none */
  getActiveHighlight: () => string | null;
}

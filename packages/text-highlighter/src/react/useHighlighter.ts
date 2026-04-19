/**
 * React hook for managing text highlights in a container.
 *
 * This is the unified hook that combines DOM synchronization and interaction
 * management into a single API. It handles:
 * - Syncing highlight data to the DOM (adding, removing, updating mark elements)
 * - Hover states (grouping multi-segment highlights)
 * - Active/selected states
 * - Click and hover event callbacks
 *
 * @example
 * ```tsx
 * const { setActiveHighlight } = useHighlighter({
 *   containerRef: contentRef,
 *   highlights,
 *   contentReady: !!content,
 *   className: 'highlight',
 *   hoverClass: 'highlight-hover',
 *   activeClass: 'highlight-active',
 *   getAttributes: (h) => ({ 'data-color': h.color }),
 *   onHighlightClick: (id, pos) => showToolbar(id, pos),
 * });
 *
 * // Sync external active state to DOM
 * useEffect(() => {
 *   setActiveHighlight(activeId);
 * }, [activeId, setActiveHighlight]);
 * ```
 */

import { useCallback, useEffect, useRef } from "react";
import { HIGHLIGHT_DEFAULTS } from "../constants";
import { applyHighlight, removeHighlightById } from "../dom";
import {
  createHighlightInteractionManager,
  type HighlightInteractionManager,
} from "../interaction";
import type {
  SyncableHighlight,
  UseHighlighterOptions,
  UseHighlighterReturn,
} from "./types";

export function useHighlighter<T extends SyncableHighlight>({
  containerRef,
  highlights,
  contentReady,
  getAttributes,
  className = HIGHLIGHT_DEFAULTS.className,
  idAttribute = HIGHLIGHT_DEFAULTS.idAttribute,
  tagName = "mark",
  hoverClass,
  activeClass,
  segmentBoundaryAttributes,
  onHighlightClick,
  onHighlightHover,
}: UseHighlighterOptions<T>): UseHighlighterReturn {
  // Track previous highlights for diffing
  const prevHighlightsRef = useRef<T[]>([]);
  // Track interaction manager instance
  const managerRef = useRef<HighlightInteractionManager | null>(null);

  // Refs for callbacks (prevents effect re-runs on callback identity changes)
  const onClickRef = useRef(onHighlightClick);
  const onHoverRef = useRef(onHighlightHover);
  const getAttributesRef = useRef(getAttributes);

  // Sync refs every render (no deps = runs every render, intentional)
  useEffect(() => {
    onClickRef.current = onHighlightClick;
    onHoverRef.current = onHighlightHover;
    getAttributesRef.current = getAttributes;
  });

  // --- DOM Synchronization Effect ---
  // Handles adding, removing, and updating highlight elements
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const prevHighlights = prevHighlightsRef.current;
    const currentIds = new Set(highlights.map((h) => h.id));

    // Remove highlights that no longer exist
    for (const prevH of prevHighlights) {
      if (!currentIds.has(prevH.id)) {
        removeHighlightById(container, prevH.id, idAttribute);
      }
    }

    // Add new highlights and update existing ones
    for (const highlight of highlights) {
      const selector = `${tagName}[${idAttribute}="${highlight.id}"]`;
      const existingMark = container.querySelector(selector);

      if (!existingMark) {
        // Build attributes: always include ID, plus any from getAttributes
        const attributes: Record<string, string> = {
          [idAttribute]: highlight.id,
          ...(getAttributesRef.current?.(highlight) ?? {}),
        };

        applyHighlight(container, highlight, {
          className,
          tagName,
          attributes,
          segmentBoundaryAttributes,
        });
        continue;
      }

      // Update existing marks if attributes changed
      if (getAttributesRef.current) {
        const newAttrs = getAttributesRef.current(highlight);
        const marks = container.querySelectorAll(selector);

        marks.forEach((mark) => {
          if (mark instanceof HTMLElement) {
            Object.entries(newAttrs).forEach(([key, value]) => {
              // Handle data-* attributes via dataset
              if (key.startsWith("data-")) {
                const dataKey = key
                  .slice(5)
                  .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                if (mark.dataset[dataKey] !== value) {
                  mark.dataset[dataKey] = value;
                }
              } else if (mark.getAttribute(key) !== value) {
                mark.setAttribute(key, value);
              }
            });
          }
        });
      }
    }
    prevHighlightsRef.current = highlights;
  }, [
    highlights,
    containerRef,
    contentReady,
    className,
    idAttribute,
    tagName,
    segmentBoundaryAttributes,
  ]);

  // --- Interaction Manager Effect ---
  // Handles hover, click, and active states
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const manager = createHighlightInteractionManager(container, {
      highlightClass: className,
      idAttribute,
      hoverClass,
      activeClass,
      onHighlightClick: (id, pos) => onClickRef.current?.(id, pos),
      onHighlightHover: (id, pos) => onHoverRef.current?.(id, pos),
    });

    managerRef.current = manager;

    return () => {
      manager.destroy();
      managerRef.current = null;
    };
  }, [
    containerRef,
    className,
    idAttribute,
    hoverClass,
    activeClass,
    // Recreate when content changes to re-attach listeners
    contentReady,
  ]);

  // --- Public API ---
  const setActiveHighlight = useCallback((id: string | null) => {
    managerRef.current?.setActiveHighlight(id);
  }, []);

  const getActiveHighlight = useCallback(() => {
    return managerRef.current?.getActiveHighlight() ?? null;
  }, []);

  return {
    setActiveHighlight,
    getActiveHighlight,
  };
}

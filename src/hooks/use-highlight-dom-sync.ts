import type { Highlight } from "@/types/highlight";
import {
  EPUB_HIGHLIGHT_CLASS,
  EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
} from "@/types/reader.types";
import { applyHighlight, removeHighlightById } from "@zsh-eng/text-highlighter";
import { useEffect, useRef } from "react";

/**
 * Hook that synchronizes highlights data to the DOM.
 *
 * This is a reactive side effect that responds to changes in the highlights array.
 * When highlights are added (including optimistic updates), they're applied to the DOM.
 * When highlights are removed (including rollbacks), they're removed from the DOM.
 * When highlight colors change, the DOM is updated to reflect the new color.
 *
 * @param contentRef - Ref to the container element with the content
 * @param highlights - Array of highlights to sync to the DOM
 * @param contentReady - Flag that changes when content changes (e.g., chapter content string).
 *                     This ensures the effect re-runs when the DOM content is ready,
 *                     ensuring that the highlights are applied to the DOM.
 */
export function useHighlightDOMSync(
  contentRef: React.RefObject<HTMLElement | null>,
  highlights: Highlight[],
  contentReady: boolean,
): void {
  const prevHighlightsRef = useRef<Highlight[]>([]);

  useEffect(() => {
    // Early return if container is not yet available
    if (!contentRef.current) return;

    const container = contentRef.current;
    const prevHighlights = prevHighlightsRef.current;

    const currentIds = new Set(highlights.map((h) => h.id));

    // Remove highlights that no longer exist (e.g., deleted or rolled back)
    for (const prevH of prevHighlights) {
      if (!currentIds.has(prevH.id)) {
        removeHighlightById(container, prevH.id);
      }
    }

    // Add new highlights and update existing ones
    for (const highlight of highlights) {
      const existingMark = container.querySelector(
        `mark[${EPUB_HIGHLIGHT_DATA_ATTRIBUTE}="${highlight.id}"]`,
      );

      if (!existingMark) {
        // New highlight - apply it to the DOM
        applyHighlight(container, highlight, {
          className: EPUB_HIGHLIGHT_CLASS,
          attributes: {
            [EPUB_HIGHLIGHT_DATA_ATTRIBUTE]: highlight.id,
            "data-color": highlight.color,
          },
        });
        continue;
      }

      if (!(existingMark instanceof HTMLElement)) {
        continue;
      }

      // Existing highlight - check if color needs updating
      if (existingMark.dataset.color === highlight.color) {
        continue;
      }

      // Sync the color in case it changed
      const allMarkElementsForId = container.querySelectorAll(
        `mark[${EPUB_HIGHLIGHT_DATA_ATTRIBUTE}="${highlight.id}"]`,
      );
      allMarkElementsForId.forEach((mark) => {
        if (mark instanceof HTMLElement) {
          mark.dataset.color = highlight.color;
        }
      });
    }

    // Update the ref for the next comparison
    prevHighlightsRef.current = highlights;
  }, [highlights, contentRef, contentReady]);
}

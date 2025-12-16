// Utility functions for calculating text offsets and creating highlights

import type { Highlight } from "@/types/highlight";
import { EPUB_HIGHLIGHT_CLASS } from "@/types/reader.types";

/**
 * Extracts text-only content from HTML, stripping all tags
 */
export function extractTextContent(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return doc.body.textContent || "";
}

/**
 * Calculates the text offset of a position within a container
 * @param container The root container element
 * @param targetNode The node where the position is
 * @param targetOffset The offset within the target node
 * @returns The character offset in the text-only content
 */
export function getTextOffset(
  container: Node,
  targetNode: Node,
  targetOffset: number,
): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  range.setEnd(targetNode, targetOffset);
  return range.toString().length;
}

/**
 * Creates highlight data from a user selection
 */
export function createHighlightFromSelection(
  selection: Selection,
  containerElement: HTMLElement,
): {
  startOffset: number;
  endOffset: number;
  selectedText: string;
  textBefore: string;
  textAfter: string;
} | null {
  if (!selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const selectedText = selection.toString().trim();

  if (!selectedText) return null;

  // Get the full text content
  const fullText = containerElement.textContent || "";

  // Calculate offsets
  const startOffset = getTextOffset(
    containerElement,
    range.startContainer,
    range.startOffset,
  );
  const endOffset = getTextOffset(
    containerElement,
    range.endContainer,
    range.endOffset,
  );

  // Extract context (50 chars before and after)
  const textBefore = fullText.substring(
    Math.max(0, startOffset - 50),
    startOffset,
  );
  const textAfter = fullText.substring(
    endOffset,
    Math.min(fullText.length, endOffset + 50),
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
 * Gets the position of a selection for positioning the toolbar
 */
export function getSelectionPosition(selection: Selection): {
  x: number;
  y: number;
} | null {
  if (!selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2,
    y: rect.top,
  };
}

/**
 * Finds a DOM Range by text offset positions
 * @param container The root container element
 * @param startOffset Character offset for range start
 * @param endOffset Character offset for range end
 * @returns A Range object or null if not found
 */
export function findRangeByTextOffset(
  container: Node,
  startOffset: number,
  endOffset: number,
): Range | null {
  const range = document.createRange();
  let currentOffset = 0;

  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null,
  );

  let startNode: Node | null = null;
  let startNodeOffset = 0;
  let endNode: Node | null = null;
  let endNodeOffset = 0;
  let foundStart = false;

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const text = textNode.textContent || "";
    const length = text.length;

    // Find start position
    if (!foundStart && currentOffset + length > startOffset) {
      startNode = textNode;
      startNodeOffset = startOffset - currentOffset;
      foundStart = true;
    }

    // Find end position
    if (foundStart && currentOffset + length >= endOffset) {
      endNode = textNode;
      endNodeOffset = endOffset - currentOffset;
      break;
    }

    currentOffset += length;
  }

  if (startNode && endNode) {
    try {
      range.setStart(startNode, startNodeOffset);
      range.setEnd(endNode, endNodeOffset);
      return range;
    } catch (error) {
      console.error("Invalid range:", error);
      return null;
    }
  }

  return null;
}

/**
 * Verifies that a range's text matches expected text
 */
function verifyRangeText(range: Range, expectedText: string): boolean {
  const rangeText = range.toString().trim();
  const expected = expectedText.trim();

  // Allow minor whitespace differences
  return (
    rangeText === expected ||
    rangeText.replace(/\s+/g, " ") === expected.replace(/\s+/g, " ")
  );
}

/**
 * Creates a highlight mark element with the given highlight's styling
 */
export function createHighlightMark(
  doc: Document,
  highlight: Highlight,
): HTMLElement {
  const mark = doc.createElement("mark");
  mark.className = EPUB_HIGHLIGHT_CLASS;
  mark.dataset.highlightId = highlight.id;
  mark.dataset.color = highlight.color;
  return mark;
}

/**
 * Wraps a text node with a mark element, inserting it before the node
 * and then appending the node as a child
 */
export function wrapTextNodeWithMark(node: Text, mark: HTMLElement): void {
  node.parentNode?.insertBefore(mark, node);
  mark.appendChild(node);
}

/**
 * Wraps a DOM Range with highlight mark elements, respecting block boundaries.
 * Creates multiple <mark> elements as needed to avoid wrapping block elements.
 * All marks share the same data-highlight-id for grouping.
 */
export function wrapRangeWithHighlight(
  range: Range,
  highlight: Highlight,
  doc: Document,
): void {
  // Get all text nodes that intersect with the range
  const textNodes: { node: Text; startOffset: number; endOffset: number }[] =
    [];

  const walker = doc.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        // Check if this text node intersects with our range
        const nodeRange = doc.createRange();
        nodeRange.selectNodeContents(node);

        // Compare ranges: do they intersect?
        const startsBeforeEnd =
          range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0;
        const endsAfterStart =
          range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0;

        if (startsBeforeEnd && endsAfterStart) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      },
    },
  );

  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    const text = textNode as Text;
    const nodeRange = doc.createRange();
    nodeRange.selectNodeContents(text);

    // Determine the portion of this text node that falls within our highlight range
    let startOffset = 0;
    let endOffset = text.length;

    // Adjust start if range starts within this node
    if (range.compareBoundaryPoints(Range.START_TO_START, nodeRange) > 0) {
      if (range.startContainer === text) {
        startOffset = range.startOffset;
      } else if (
        text.contains(range.startContainer) ||
        range.startContainer.contains(text)
      ) {
        // Range starts somewhere within or related to this node
        const tempRange = doc.createRange();
        tempRange.setStart(text, 0);
        tempRange.setEnd(range.startContainer, range.startOffset);
        // If we can measure it, calculate offset
        try {
          const beforeText = tempRange.toString();
          startOffset = beforeText.length;
        } catch {
          startOffset = 0;
        }
      }
    }

    // Adjust end if range ends within this node
    if (range.compareBoundaryPoints(Range.END_TO_END, nodeRange) < 0) {
      if (range.endContainer === text) {
        endOffset = range.endOffset;
      } else if (
        text.contains(range.endContainer) ||
        range.endContainer.contains(text)
      ) {
        // Range ends somewhere within or related to this node
        const tempRange = doc.createRange();
        tempRange.setStart(text, 0);
        tempRange.setEnd(range.endContainer, range.endOffset);
        try {
          const beforeText = tempRange.toString();
          endOffset = beforeText.length;
        } catch {
          endOffset = text.length;
        }
      }
    }

    if (startOffset < endOffset) {
      textNodes.push({ node: text, startOffset, endOffset });
    }
  }

  // If no text nodes found, try a simpler approach
  if (textNodes.length === 0) {
    const startNode = range.startContainer;
    const endNode = range.endContainer;

    if (startNode === endNode && startNode.nodeType === Node.TEXT_NODE) {
      textNodes.push({
        node: startNode as Text,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
      });
    }
  }

  // Now wrap each text node segment with a mark element
  // Process in reverse order to avoid offset issues when modifying the DOM
  for (let i = textNodes.length - 1; i >= 0; i--) {
    const { node, startOffset, endOffset } = textNodes[i];

    // Skip if this would result in an empty or whitespace-only highlight
    const textToHighlight =
      node.textContent?.substring(startOffset, endOffset) || "";
    if (textToHighlight.trim().length === 0) {
      continue;
    }

    try {
      const textLength = node.length;
      const mark = createHighlightMark(doc, highlight);

      // Handle four cases based on where the highlight starts and ends within the text node:

      // Case 1: Middle section - "abc[de]fg" → split into 3 parts: "abc" + "[de]" + "fg"
      // We need to isolate the middle portion and wrap only that
      if (startOffset > 0 && endOffset < textLength) {
        node.splitText(endOffset); // Split at end first to preserve startOffset
        const highlightNode = node.splitText(startOffset); // Then split at start
        wrapTextNodeWithMark(highlightNode, mark);
      }
      // Case 2: Middle to end - "abc[def]" → split into 2 parts: "abc" + "[def]"
      // Wrap everything from startOffset to the end of the node
      else if (startOffset > 0) {
        const highlightNode = node.splitText(startOffset);
        wrapTextNodeWithMark(highlightNode, mark);
      }
      // Case 3: Start to middle - "[abc]def" → split into 2 parts: "[abc]" + "def"
      // Wrap everything from the start to endOffset
      else if (endOffset < textLength) {
        node.splitText(endOffset); // This creates the "def" part, original node becomes "[abc]"
        wrapTextNodeWithMark(node, mark);
      }
      // Case 4: Entire node - "[abcdef]" → no split needed
      // Wrap the entire text node
      else {
        wrapTextNodeWithMark(node, mark);
      }
    } catch (error) {
      console.error("Error wrapping text node:", error);
    }
  }
}

/**
 * Applies highlights to a DOM Document
 * @param doc The DOM Document to apply highlights to
 * @param highlights Array of highlights to apply
 * @returns HTML string with highlights wrapped in mark elements
 */
export function applyHighlightsToDocument(
  doc: Document,
  highlights: Highlight[],
): string {
  const body = doc.body;

  if (highlights.length === 0) return body.innerHTML;

  const sorted = [...highlights].sort((a, b) => a.startOffset - b.startOffset);

  for (const highlight of sorted) {
    try {
      const range = findRangeByTextOffset(
        body,
        highlight.startOffset,
        highlight.endOffset,
      );

      if (range && verifyRangeText(range, highlight.selectedText)) {
        wrapRangeWithHighlight(range, highlight, doc);
      } else {
        console.warn("Failed to apply highlight:", highlight.id);
      }
    } catch (err) {
      console.error("Error applying highlight:", highlight.id, err);
    }
  }

  return body.innerHTML;
}

/**
 * Applies a single highlight to the live DOM without re-rendering
 * @param containerElement The container element with the content
 * @param highlight The highlight to apply
 * @returns true if successful, false otherwise
 */
export function applyHighlightToLiveDOM(
  containerElement: HTMLElement,
  highlight: Highlight,
): boolean {
  try {
    // Find the range in the live DOM
    const range = findRangeByTextOffset(
      containerElement,
      highlight.startOffset,
      highlight.endOffset,
    );

    if (!range) {
      console.warn("Could not find range for highlight:", highlight.id);
      return false;
    }

    // Verify the text matches
    if (!verifyRangeText(range, highlight.selectedText)) {
      console.warn("Range text does not match expected text:", highlight.id);
      return false;
    }

    // Wrap the range with highlight marks
    wrapRangeWithHighlight(range, highlight, document);

    return true;
  } catch (error) {
    console.error("Error applying highlight to live DOM:", error);
    return false;
  }
}

/**
 * Removes a highlight from the live DOM
 * @param containerElement The container element with the content
 * @param highlightId The ID of the highlight to remove
 */
export function removeHighlightFromLiveDOM(
  containerElement: HTMLElement,
  highlightId: string,
): void {
  try {
    // Find all mark elements with this highlight ID
    const marks = containerElement.querySelectorAll(
      `mark[data-highlight-id="${highlightId}"]`,
    );

    // Unwrap each mark element (replace it with its text content)
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;

      // Move all child nodes of the mark to before the mark
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }

      // Remove the now-empty mark element
      parent.removeChild(mark);

      // Normalize the parent to merge adjacent text nodes
      parent.normalize();
    });
  } catch (error) {
    console.error("Error removing highlight from live DOM:", error);
  }
}

/**
 * Functions for applying and removing highlights in the DOM
 */

import type { TextHighlight, ApplyHighlightOptions } from "./types";
import { findRangeByTextOffset, verifyRangeText } from "./offsets";

const DEFAULT_OPTIONS: Required<ApplyHighlightOptions> = {
  tagName: "mark",
  className: "",
  attributes: {},
};

/**
 * Creates a highlight element with the specified options.
 */
function createHighlightElement(
  doc: Document,
  options: Required<ApplyHighlightOptions>,
): HTMLElement {
  const element = doc.createElement(options.tagName);
  if (options.className) {
    element.className = options.className;
  }
  for (const [key, value] of Object.entries(options.attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

/**
 * Wraps a text node with an element, inserting the element before the node
 * and then appending the node as a child.
 */
function wrapTextNode(node: Text, wrapper: HTMLElement): void {
  node.parentNode?.insertBefore(wrapper, node);
  wrapper.appendChild(node);
}

/**
 * Wraps a DOM Range with highlight elements, respecting block boundaries.
 * Creates multiple elements as needed to avoid wrapping block elements.
 *
 * @param range - The DOM Range to wrap
 * @param doc - The Document to create elements in
 * @param options - Options for the highlight elements
 */
export function wrapRangeWithHighlight(
  range: Range,
  doc: Document,
  options: ApplyHighlightOptions = {},
): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Get all text nodes that intersect with the range
  const textNodes: { node: Text; startOffset: number; endOffset: number }[] =
    [];

  const walker = doc.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const nodeRange = doc.createRange();
        nodeRange.selectNodeContents(node);

        // Check if ranges intersect
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

    // Determine the portion of this text node within the highlight range
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
        const tempRange = doc.createRange();
        tempRange.setStart(text, 0);
        tempRange.setEnd(range.startContainer, range.startOffset);
        try {
          startOffset = tempRange.toString().length;
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
        const tempRange = doc.createRange();
        tempRange.setStart(text, 0);
        tempRange.setEnd(range.endContainer, range.endOffset);
        try {
          endOffset = tempRange.toString().length;
        } catch {
          endOffset = text.length;
        }
      }
    }

    if (startOffset < endOffset) {
      textNodes.push({ node: text, startOffset, endOffset });
    }
  }

  // Fallback for simple single-node case
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

  // Wrap each text node segment (process in reverse to avoid offset issues)
  for (let i = textNodes.length - 1; i >= 0; i--) {
    const { node, startOffset, endOffset } = textNodes[i];

    // Skip whitespace-only highlights
    const textToHighlight =
      node.textContent?.substring(startOffset, endOffset) || "";
    if (textToHighlight.trim().length === 0) {
      continue;
    }

    try {
      const textLength = node.length;
      const element = createHighlightElement(doc, opts);

      // Handle four cases based on highlight position within the text node:
      if (startOffset > 0 && endOffset < textLength) {
        // Middle section: "abc[de]fg"
        node.splitText(endOffset);
        const highlightNode = node.splitText(startOffset);
        wrapTextNode(highlightNode, element);
      } else if (startOffset > 0) {
        // Start to end: "abc[def]"
        const highlightNode = node.splitText(startOffset);
        wrapTextNode(highlightNode, element);
      } else if (endOffset < textLength) {
        // Beginning to middle: "[abc]def"
        node.splitText(endOffset);
        wrapTextNode(node, element);
      } else {
        // Entire node: "[abcdef]"
        wrapTextNode(node, element);
      }
    } catch {
      // Silently skip nodes that can't be wrapped
    }
  }
}

/**
 * Applies a highlight to the DOM.
 *
 * @param container - The container element
 * @param highlight - The highlight data
 * @param options - Options for the highlight elements
 * @returns true if successful, false otherwise
 */
export function applyHighlight(
  container: HTMLElement,
  highlight: TextHighlight,
  options: ApplyHighlightOptions = {},
): boolean {
  try {
    const range = findRangeByTextOffset(
      container,
      highlight.startOffset,
      highlight.endOffset,
    );

    if (!range) {
      return false;
    }

    // Verify the text matches
    if (!verifyRangeText(range, highlight.selectedText)) {
      return false;
    }

    wrapRangeWithHighlight(range, container.ownerDocument, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies multiple highlights to the DOM.
 * Highlights are sorted by start offset to avoid conflicts.
 *
 * @param container - The container element
 * @param highlights - Array of highlight data
 * @param options - Options for the highlight elements
 * @returns Array of highlight IDs that were successfully applied
 */
export function applyHighlights(
  container: HTMLElement,
  highlights: Array<TextHighlight & { id?: string }>,
  options: ApplyHighlightOptions = {},
): string[] {
  const applied: string[] = [];
  const sorted = [...highlights].sort((a, b) => a.startOffset - b.startOffset);

  for (const highlight of sorted) {
    // Add ID to attributes if present
    const highlightOptions = highlight.id
      ? {
          ...options,
          attributes: {
            ...options.attributes,
            "data-highlight-id": highlight.id,
          },
        }
      : options;

    if (applyHighlight(container, highlight, highlightOptions)) {
      if (highlight.id) {
        applied.push(highlight.id);
      }
    }
  }

  return applied;
}

/**
 * Removes a highlight from the DOM by selector.
 * Unwraps the highlight elements and normalizes text nodes.
 *
 * @param container - The container element
 * @param selector - CSS selector for highlight elements (e.g., '[data-highlight-id="abc"]')
 */
export function removeHighlight(
  container: HTMLElement,
  selector: string,
): void {
  try {
    const elements = container.querySelectorAll(selector);

    elements.forEach((element) => {
      const parent = element.parentNode;
      if (!parent) return;

      // Move all children before the element
      while (element.firstChild) {
        parent.insertBefore(element.firstChild, element);
      }

      // Remove the empty element
      parent.removeChild(element);

      // Normalize to merge adjacent text nodes
      parent.normalize();
    });
  } catch {
    // Silently fail
  }
}

/**
 * Removes a highlight by ID (convenience wrapper).
 *
 * @param container - The container element
 * @param highlightId - The highlight ID to remove
 * @param idAttribute - The attribute name for the ID (default: 'data-highlight-id')
 */
export function removeHighlightById(
  container: HTMLElement,
  highlightId: string,
  idAttribute: string = "data-highlight-id",
): void {
  removeHighlight(container, `[${idAttribute}="${highlightId}"]`);
}

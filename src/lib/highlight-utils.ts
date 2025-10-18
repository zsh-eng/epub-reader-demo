// Utility functions for calculating text offsets and creating highlights

import type { Highlight } from "@/types/highlight";
import { getMimeTypeForContent } from "./epub-resource-utils";

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

  console.log("\n=== createHighlightFromSelection DEBUG ===");
  console.log("Full text length:", fullText.length);
  console.log("Start offset:", startOffset);
  console.log("End offset:", endOffset);
  console.log("Selected text:", selectedText);
  console.log("First 200 chars:\n", fullText.substring(0, 200));
  console.log(
    "Text at offset position:",
    fullText.substring(startOffset, endOffset),
  );
  console.log(
    "Text before (last 20 chars):",
    fullText.substring(Math.max(0, startOffset - 20), startOffset),
  );
  console.log(
    "Text after (first 20 chars):",
    fullText.substring(endOffset, Math.min(fullText.length, endOffset + 20)),
  );
  console.log("=== END DEBUG ===\n");

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
  console.log("\n=== findRangeByTextOffset DEBUG ===");
  console.log("Looking for startOffset:", startOffset, "endOffset:", endOffset);

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

  let nodeIndex = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const text = textNode.textContent || "";
    const length = text.length;

    console.log(`Node ${nodeIndex}:`, {
      currentOffset,
      length,
      text: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
      parent: textNode.parentElement?.tagName,
    });

    // Find start position
    if (!foundStart && currentOffset + length > startOffset) {
      startNode = textNode;
      startNodeOffset = startOffset - currentOffset;
      foundStart = true;
      console.log("✓ FOUND START:", {
        nodeIndex,
        startNodeOffset,
        currentOffset,
        textAtStart: text.substring(
          Math.max(0, startNodeOffset - 5),
          startNodeOffset + 20,
        ),
      });
    }

    // Find end position
    if (foundStart && currentOffset + length >= endOffset) {
      endNode = textNode;
      endNodeOffset = endOffset - currentOffset;
      console.log("✓ FOUND END:", {
        nodeIndex,
        endNodeOffset,
        currentOffset,
        textAtEnd: text.substring(
          Math.max(0, endNodeOffset - 20),
          endNodeOffset + 5,
        ),
      });
      break;
    }

    currentOffset += length;
    nodeIndex++;
  }

  if (startNode && endNode) {
    try {
      range.setStart(startNode, startNodeOffset);
      range.setEnd(endNode, endNodeOffset);
      console.log("Range created successfully");
      console.log("Range text:", range.toString());
      console.log("=== END DEBUG ===\n");
      return range;
    } catch (error) {
      console.error("Invalid range:", error);
      return null;
    }
  }

  console.log("❌ Failed to find start/end nodes");
  console.log("=== END DEBUG ===\n");
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
 * Wraps a DOM Range with a highlight mark element
 */
function wrapRangeWithHighlight(
  range: Range,
  highlight: Highlight,
  doc: Document,
): void {
  const mark = doc.createElement("mark");
  mark.className = "epub-highlight";
  mark.dataset.highlightId = highlight.id;
  mark.dataset.color = highlight.color;
  mark.style.cursor = "pointer";

  try {
    range.surroundContents(mark);
  } catch {
    // surroundContents fails if range crosses element boundaries
    // Use extractContents + appendChild instead
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
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

  console.log("\n=== applyHighlightsToDocument DEBUG ===");
  console.log("Number of highlights:", highlights.length);
  console.log("Body text length:", body.textContent?.length);
  console.log("First 200 chars:\n", body.textContent?.substring(0, 200));
  console.log("=== END DEBUG ===\n");

  // Sort highlights by position to handle them in order
  const sorted = [...highlights].sort((a, b) => b.startOffset - a.startOffset);

  for (const highlight of sorted) {
    try {
      // Try primary method: direct offset
      console.log("\n=== Applying Highlight ===");
      console.log("Highlight ID:", highlight.id);
      console.log("Expected text:", highlight.selectedText);
      console.log("Offsets:", highlight.startOffset, "to", highlight.endOffset);

      const bodyText = body.textContent || "";
      console.log("Text at those offsets in current DOM:");
      console.log(
        bodyText.substring(highlight.startOffset, highlight.endOffset),
      );

      const range = findRangeByTextOffset(
        body,
        highlight.startOffset,
        highlight.endOffset,
      );

      console.log("Range found:", range);
      console.log("Range text:", range?.toString());
      console.log("Match:", range?.toString() === highlight.selectedText);

      if (range && verifyRangeText(range, highlight.selectedText)) {
        wrapRangeWithHighlight(range, highlight, doc);
        console.log("✓ Highlight applied successfully");
      } else {
        console.warn("Failed to apply highlight:", highlight.id);
      }
    } catch (err) {
      console.error("Error applying highlight:", highlight.id, err);
    }
  }

  return body.innerHTML;
}

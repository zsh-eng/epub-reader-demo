// Utility functions for calculating text offsets and creating highlights

/**
 * Extracts text-only content from HTML, stripping all tags
 */
export function extractTextContent(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return doc.body.textContent || '';
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
  targetOffset: number
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
  containerElement: HTMLElement
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
  const fullText = containerElement.textContent || '';

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

  // Extract context (50 chars before and after)
  const textBefore = fullText.substring(
    Math.max(0, startOffset - 50),
    startOffset
  );
  const textAfter = fullText.substring(
    endOffset,
    Math.min(fullText.length, endOffset + 50)
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

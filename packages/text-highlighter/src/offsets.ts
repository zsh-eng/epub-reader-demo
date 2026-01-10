/**
 * Functions for calculating and resolving text offsets in the DOM
 */

/**
 * Calculates the text offset of a position within a container.
 * The offset is the number of characters from the start of the container's
 * text content to the specified position.
 *
 * @param container - The root container element
 * @param targetNode - The node where the position is
 * @param targetOffset - The offset within the target node
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
 * Finds a DOM Range by text offset positions.
 * This is the inverse of getTextOffset - it converts character offsets
 * back into a DOM Range that can be used for highlighting.
 *
 * @param container - The root container element
 * @param startOffset - Character offset for range start
 * @param endOffset - Character offset for range end
 * @returns A Range object or null if the offsets are invalid
 */
export function findRangeByTextOffset(
  container: Node,
  startOffset: number,
  endOffset: number
): Range | null {
  const range = document.createRange();
  let currentOffset = 0;

  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
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
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Verifies that a range's text matches expected text.
 * Useful for validating that a highlight still points to the correct content
 * after DOM changes.
 *
 * @param range - The DOM Range to verify
 * @param expectedText - The text that should be selected
 * @returns true if the texts match (allowing minor whitespace differences)
 */
export function verifyRangeText(range: Range, expectedText: string): boolean {
  const rangeText = range.toString().trim();
  const expected = expectedText.trim();

  // Allow minor whitespace differences
  return (
    rangeText === expected ||
    rangeText.replace(/\s+/g, " ") === expected.replace(/\s+/g, " ")
  );
}

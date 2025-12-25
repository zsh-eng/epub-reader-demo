import { findRangeByTextOffset } from "@/lib/highlight-utils";
import { saveReadingProgress } from "@/lib/db";

/**
 * Represents a scroll anchor - a precise position in the text content
 * that can be used to restore scroll position after reflows.
 */
export interface ScrollAnchor {
  /** Character offset from the start of the content's text */
  textOffset: number;
  /** A snippet of text around the anchor point for verification */
  textContext: string;
}

/**
 * Waits for content to stop resizing, indicating it has finished loading/reflowing.
 * Uses ResizeObserver to detect when the element's size stabilizes.
 *
 * @param element - The element to observe
 * @param stabilityMs - How long the size must remain stable (default 100ms)
 * @param maxWaitMs - Maximum time to wait before giving up (default 3000ms)
 */
export function waitForContentStability(
  element: HTMLElement,
  stabilityMs: number = 100,
  maxWaitMs: number = 3000,
): Promise<void> {
  return new Promise((resolve) => {
    let stabilityTimeoutId: number;
    const maxWaitTimeoutId: number = window.setTimeout(() => {
      cleanup();
      resolve();
    }, maxWaitMs);

    const cleanup = () => {
      clearTimeout(stabilityTimeoutId);
      clearTimeout(maxWaitTimeoutId);
      observer.disconnect();
    };

    const observer = new ResizeObserver(() => {
      // Reset the stability timer on each resize
      clearTimeout(stabilityTimeoutId);
      stabilityTimeoutId = window.setTimeout(() => {
        cleanup();
        resolve();
      }, stabilityMs);
    });

    observer.observe(element);

    // Start the initial stability timer (in case no resize happens)
    stabilityTimeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, stabilityMs);

    // maxWaitTimeoutId is set above at initialization
  });
}

/**
 * Calculates the total text offset for a position within the container.
 * This counts all text characters from the start of the container to the given node/offset.
 */
function calculateTextOffset(
  container: HTMLElement,
  targetNode: Node,
  targetOffset: number,
): number {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null,
  );

  let offset = 0;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    if (node === targetNode) {
      return offset + targetOffset;
    }
    offset += node.textContent?.length ?? 0;
  }

  return offset;
}

/**
 * Gets a snippet of text around a given offset for context verification.
 */
function getTextContext(
  container: HTMLElement,
  offset: number,
  contextLength: number = 50,
): string {
  const fullText = container.textContent ?? "";
  const start = Math.max(0, offset - contextLength);
  const end = Math.min(fullText.length, offset + contextLength);
  return fullText.slice(start, end);
}

/**
 * Finds the first visible text node in the viewport and calculates its offset.
 * This is used to create a scroll anchor that can survive content reflows.
 *
 * @param container - The content container element
 * @returns A ScrollAnchor if a visible text node is found, null otherwise
 */
export function findVisibleScrollAnchor(
  container: HTMLElement,
): ScrollAnchor | null {
  const viewportTop = 0; // Top of viewport

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // Skip empty text nodes
      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();

    // Check if this text node is visible (at or crossing the viewport top)
    if (rect.bottom > viewportTop && rect.top < window.innerHeight) {
      // Find the character offset at the viewport top
      const text = textNode.textContent ?? "";

      // For simplicity, use the start of the visible text node
      // A more precise implementation would find the exact character at viewport top
      let charOffset = 0;

      // If the text node starts above viewport, estimate which character is at top
      if (rect.top < viewportTop && text.length > 0) {
        const charHeight = rect.height / text.length;
        if (charHeight > 0) {
          charOffset = Math.floor((viewportTop - rect.top) / charHeight);
          charOffset = Math.min(charOffset, text.length - 1);
        }
      }

      const totalOffset = calculateTextOffset(container, textNode, charOffset);

      return {
        textOffset: totalOffset,
        textContext: getTextContext(container, totalOffset),
      };
    }
  }

  return null;
}

/**
 * Restores scroll position from a scroll anchor.
 * Finds the text position and scrolls to place it at the top of the viewport.
 *
 * @param container - The content container element
 * @param anchor - The scroll anchor to restore to
 * @returns true if restoration succeeded, false otherwise
 */
export function restoreScrollFromAnchor(
  container: HTMLElement,
  anchor: ScrollAnchor,
): boolean {
  try {
    // Use a small range around the offset to find the position
    const range = findRangeByTextOffset(
      container,
      anchor.textOffset,
      anchor.textOffset + 1,
    );

    if (!range) {
      return false;
    }

    // Verify the context matches (fuzzy match)
    const currentContext = getTextContext(container, anchor.textOffset);
    const contextMatch =
      anchor.textContext.length > 0 &&
      (currentContext.includes(anchor.textContext.slice(20, 30)) ||
        anchor.textContext.includes(currentContext.slice(20, 30)));

    if (!contextMatch && anchor.textContext.length > 0) {
      console.warn(
        "Scroll anchor context mismatch, falling back to percentage",
      );
      return false;
    }

    const rect = range.getBoundingClientRect();
    const scrollTop = window.scrollY + rect.top;

    window.scrollTo({
      top: scrollTop,
      behavior: "instant",
    });

    return true;
  } catch (error) {
    console.error("Failed to restore scroll from anchor:", error);
    return false;
  }
}

/**
 * Restores scroll position from a percentage (fallback method).
 *
 * @param percentage - Scroll percentage (0-100)
 */
export function restoreScrollFromPercentage(percentage: number): void {
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = window.innerHeight;
  const maxScroll = scrollHeight - clientHeight;

  // Convert percentage (0-100) to scroll position
  const scrollTop = (percentage / 100) * maxScroll;

  window.scrollTo({
    top: Math.max(0, scrollTop),
    behavior: "instant",
  });
}

/**
 * Calculates the current scroll progress as a percentage (0-100).
 */
export function calculateScrollPercentage(): number {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = window.innerHeight;

  const scrollable = scrollHeight - clientHeight;
  if (scrollable <= 0) return 0;

  const progress = (scrollTop / scrollable) * 100;
  return isNaN(progress) ? 0 : Math.min(100, Math.max(0, progress));
}

/**
 * Saves the current reading progress for a book.
 * This is a convenience function for chapter navigation that resets scroll to 0.
 *
 * @param bookId - The book ID
 * @param currentChapterIndex - The current chapter/spine index
 * @param scrollProgress - Scroll progress percentage (0-100), defaults to 0
 */
export async function saveCurrentProgress(
  bookId: string,
  currentChapterIndex: number,
  scrollProgress: number = 0,
): Promise<void> {
  // Handle NaN values
  const validScrollProgress = isNaN(scrollProgress) ? 0 : scrollProgress;

  await saveReadingProgress({
    bookId,
    currentSpineIndex: currentChapterIndex,
    scrollProgress: validScrollProgress,
    lastRead: new Date().getTime(),
  });
}

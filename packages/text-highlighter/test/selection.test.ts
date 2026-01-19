/**
 * Tests for selection creation functions
 */

import { describe, test, expect } from "vitest";
import { createHighlightFromRange } from "../src/selection";
import { findRangeByTextOffset } from "../src/offsets";

/**
 * Helper to create a DOM container from HTML string
 */
function createContainer(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("createHighlightFromRange", () => {
  test("creates highlight data from a simple range", () => {
    const container = createContainer("<p>Hello world</p>");
    const range = findRangeByTextOffset(container, 0, 5)!;

    const result = createHighlightFromRange(range, container);

    expect(result).not.toBeNull();
    expect(result!.startOffset).toBe(0);
    expect(result!.endOffset).toBe(5);
    expect(result!.selectedText).toBe("Hello");
    expect(result!.textBefore).toBe("");
    expect(result!.textAfter).toBe(" world");
  });

  test("captures context before and after", () => {
    const container = createContainer(
      "<p>The quick brown fox jumps over the lazy dog</p>",
    );
    const range = findRangeByTextOffset(container, 16, 19)!; // "fox"

    const result = createHighlightFromRange(range, container);

    expect(result).not.toBeNull();
    expect(result!.selectedText).toBe("fox");
    expect(result!.textBefore).toBe("The quick brown ");
    expect(result!.textAfter).toBe(" jumps over the lazy dog");
  });

  test("limits context to specified length", () => {
    const container = createContainer(
      "<p>The quick brown fox jumps over the lazy dog</p>",
    );
    const range = findRangeByTextOffset(container, 16, 19)!; // "fox"

    const result = createHighlightFromRange(range, container, 10);

    expect(result).not.toBeNull();
    expect(result!.textBefore).toBe("ick brown ");
    expect(result!.textAfter).toBe(" jumps ove");
  });

  test("returns null for empty selection", () => {
    const container = createContainer("<p>Hello world</p>");
    const range = findRangeByTextOffset(container, 5, 5)!;

    const result = createHighlightFromRange(range, container);

    expect(result).toBeNull();
  });

  test("returns null for whitespace-only selection", () => {
    const container = createContainer("<p>Hello    world</p>");
    const range = findRangeByTextOffset(container, 5, 9)!; // "    "

    const result = createHighlightFromRange(range, container);

    expect(result).toBeNull();
  });

  test("handles selection spanning multiple elements", () => {
    const container = createContainer("<p>Hello</p><p>World</p>");
    const range = findRangeByTextOffset(container, 3, 8)!; // "loWor"

    const result = createHighlightFromRange(range, container);

    expect(result).not.toBeNull();
    expect(result!.selectedText).toBe("loWor");
    expect(result!.startOffset).toBe(3);
    expect(result!.endOffset).toBe(8);
  });

  test("handles selection in nested elements", () => {
    const container = createContainer("<p>Hello <b>bold</b> text</p>");
    const range = findRangeByTextOffset(container, 6, 10)!; // "bold"

    const result = createHighlightFromRange(range, container);

    expect(result).not.toBeNull();
    expect(result!.selectedText).toBe("bold");
    expect(result!.textBefore).toBe("Hello ");
    expect(result!.textAfter).toBe(" text");
  });
});

describe("context extraction edge cases", () => {
  test("handles selection at start of content", () => {
    const container = createContainer("<p>Hello world</p>");
    const range = findRangeByTextOffset(container, 0, 5)!;

    const result = createHighlightFromRange(range, container);

    expect(result!.textBefore).toBe("");
    expect(result!.textAfter).toBe(" world");
  });

  test("handles selection at end of content", () => {
    const container = createContainer("<p>Hello world</p>");
    const range = findRangeByTextOffset(container, 6, 11)!;

    const result = createHighlightFromRange(range, container);

    expect(result!.textBefore).toBe("Hello ");
    expect(result!.textAfter).toBe("");
  });

  test("handles entire content selection", () => {
    const container = createContainer("<p>Hello</p>");
    const range = findRangeByTextOffset(container, 0, 5)!;

    const result = createHighlightFromRange(range, container);

    expect(result!.selectedText).toBe("Hello");
    expect(result!.textBefore).toBe("");
    expect(result!.textAfter).toBe("");
  });

  test("handles short content with long context request", () => {
    const container = createContainer("<p>Hi</p>");
    const range = findRangeByTextOffset(container, 0, 2)!;

    // Request 100 chars of context
    const result = createHighlightFromRange(range, container, 100);

    expect(result!.selectedText).toBe("Hi");
    expect(result!.textBefore).toBe("");
    expect(result!.textAfter).toBe("");
  });
});

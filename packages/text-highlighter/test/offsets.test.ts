/**
 * Tests for offset calculation functions
 */

import { describe, test, expect, beforeEach } from "vitest";
import {
  getTextOffset,
  findRangeByTextOffset,
  verifyRangeText,
} from "../src/offsets";

/**
 * Helper to create a DOM container from HTML string
 */
function createContainer(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("getTextOffset", () => {
  test("calculates offset for simple text", () => {
    const container = createContainer("<p>Hello world</p>");
    const textNode = container.querySelector("p")!.firstChild!;

    expect(getTextOffset(container, textNode, 0)).toBe(0);
    expect(getTextOffset(container, textNode, 5)).toBe(5);
    expect(getTextOffset(container, textNode, 11)).toBe(11);
  });

  test("calculates offset across multiple elements", () => {
    const container = createContainer("<p>Hello</p><p>World</p>");
    const secondP = container.querySelectorAll("p")[1];
    const textNode = secondP.firstChild!;

    // "Hello" = 5 chars, then "World" starts at offset 5
    expect(getTextOffset(container, textNode, 0)).toBe(5);
    expect(getTextOffset(container, textNode, 5)).toBe(10);
  });

  test("handles nested elements", () => {
    const container = createContainer("<p>Hello <b>bold</b> text</p>");
    const boldText = container.querySelector("b")!.firstChild!;

    // "Hello " = 6 chars
    expect(getTextOffset(container, boldText, 0)).toBe(6);
    expect(getTextOffset(container, boldText, 4)).toBe(10);
  });
});

describe("findRangeByTextOffset", () => {
  test("finds range in simple text", () => {
    const container = createContainer("<p>Hello world</p>");

    const range = findRangeByTextOffset(container, 0, 5);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("Hello");
  });

  test("finds range spanning multiple elements", () => {
    const container = createContainer("<p>One</p><p>Two</p><p>Three</p>");

    // "OneTwoThree" - select "eTwoTh" (offset 2 to 8)
    const range = findRangeByTextOffset(container, 2, 8);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("eTwoTh");
  });

  test("finds range with nested elements", () => {
    const container = createContainer("<p>Hello <b>world</b>!</p>");

    // Select "world"
    const range = findRangeByTextOffset(container, 6, 11);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("world");
  });

  test("finds range spanning nested elements", () => {
    const container = createContainer("<p>Hello <b>bold</b> text</p>");

    // Select "o bold t" (offset 4 to 12)
    const range = findRangeByTextOffset(container, 4, 12);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("o bold t");
  });

  test("returns null for invalid offsets", () => {
    const container = createContainer("<p>Hello</p>");

    expect(findRangeByTextOffset(container, 100, 200)).toBeNull();
  });

  test("handles empty container", () => {
    const container = createContainer("");

    expect(findRangeByTextOffset(container, 0, 5)).toBeNull();
  });
});

describe("verifyRangeText", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer("<p>Hello world</p>");
  });

  test("returns true for exact match", () => {
    const range = findRangeByTextOffset(container, 0, 5)!;
    expect(verifyRangeText(range, "Hello")).toBe(true);
  });

  test("returns true with whitespace differences", () => {
    const range = findRangeByTextOffset(container, 0, 5)!;
    expect(verifyRangeText(range, "  Hello  ")).toBe(true);
  });

  test("returns true with normalized internal whitespace", () => {
    const containerWithSpaces = createContainer("<p>Hello   world</p>");
    // The range will select "Hello   " (8 chars including the spaces)
    const range = findRangeByTextOffset(containerWithSpaces, 0, 8)!;
    // The actual text has multiple spaces, verify it matches when normalized
    expect(verifyRangeText(range, "Hello ")).toBe(true);
  });

  test("returns false for mismatched text", () => {
    const range = findRangeByTextOffset(container, 0, 5)!;
    expect(verifyRangeText(range, "Goodbye")).toBe(false);
  });

  test("returns false for partial match", () => {
    const range = findRangeByTextOffset(container, 0, 5)!;
    expect(verifyRangeText(range, "Hell")).toBe(false);
  });
});

describe("round-trip: getTextOffset <-> findRangeByTextOffset", () => {
  test("offsets are preserved through round-trip", () => {
    const container = createContainer("<p>Hello <b>world</b>!</p>");

    // Create a range for "world"
    const originalRange = findRangeByTextOffset(container, 6, 11)!;
    expect(originalRange.toString()).toBe("world");

    // Get offsets from the range
    const start = getTextOffset(
      container,
      originalRange.startContainer,
      originalRange.startOffset,
    );
    const end = getTextOffset(
      container,
      originalRange.endContainer,
      originalRange.endOffset,
    );

    expect(start).toBe(6);
    expect(end).toBe(11);

    // Find range again using those offsets
    const restoredRange = findRangeByTextOffset(container, start, end)!;
    expect(restoredRange.toString()).toBe("world");
  });

  test("works with complex nested structure", () => {
    const container = createContainer(`
      <div>
        <p>First <em>paragraph</em> here.</p>
        <p>Second <strong>paragraph <span>with</span> nesting</strong>.</p>
      </div>
    `);

    // Find "paragraph with nest" across multiple nested elements
    const text = container.textContent!;
    const searchText = "paragraph with nest";
    const startIdx = text.indexOf(searchText);

    const range = findRangeByTextOffset(
      container,
      startIdx,
      startIdx + searchText.length,
    )!;

    expect(range.toString()).toBe(searchText);

    // Round-trip
    const start = getTextOffset(
      container,
      range.startContainer,
      range.startOffset,
    );
    const end = getTextOffset(container, range.endContainer, range.endOffset);
    const restored = findRangeByTextOffset(container, start, end)!;

    expect(restored.toString()).toBe(searchText);
  });
});

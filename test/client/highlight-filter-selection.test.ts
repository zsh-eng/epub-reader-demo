import {
  ALL_HIGHLIGHT_COLORS,
  toggleHighlightColorSelection,
} from "@/lib/highlight-filter-selection";
import { describe, expect, it } from "vitest";

describe("toggleHighlightColorSelection", () => {
  it("selects only the clicked color when all colors are active", () => {
    expect(toggleHighlightColorSelection(ALL_HIGHLIGHT_COLORS, "blue")).toEqual(
      ["blue"],
    );
  });

  it("returns to all colors instead of clearing the final color", () => {
    expect(toggleHighlightColorSelection(["green"], "green")).toEqual(
      ALL_HIGHLIGHT_COLORS,
    );
  });

  it("toggles colors within a partial selection", () => {
    expect(toggleHighlightColorSelection(["yellow", "blue"], "yellow")).toEqual(
      ["blue"],
    );
    expect(
      toggleHighlightColorSelection(["yellow", "blue"], "magenta"),
    ).toEqual(["yellow", "blue", "magenta"]);
  });
});

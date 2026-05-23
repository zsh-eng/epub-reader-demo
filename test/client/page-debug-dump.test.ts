import { createVisualLineGroups } from "@/components/Reader/debug/page-debug-dump";
import { describe, expect, it } from "vitest";

function rect(top: number, bottom: number, left = 24, right = 300): DOMRect {
  return {
    top,
    bottom,
    left,
    right,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("createVisualLineGroups", () => {
  it("keeps raised superscript rects on their baseline visual line", () => {
    const groups = createVisualLineGroups(
      [
        rect(105, 127),
        rect(122, 138, 60, 74),
        rect(124, 136, 60, 74),
        rect(129, 151),
        rect(153, 175),
      ],
      24,
    );

    expect(groups.map((group) => group.top)).toEqual([105, 122, 153]);
    expect(groups.map((group) => group.rectCount)).toEqual([1, 3, 1]);
  });

  it("separates ordinary line-height-spaced rects", () => {
    const groups = createVisualLineGroups(
      [rect(105, 127), rect(129, 151), rect(153, 175)],
      24,
    );

    expect(groups.map((group) => group.top)).toEqual([105, 129, 153]);
  });
});

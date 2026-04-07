import {
  getHorizontalTapZone,
  isInteractiveTapTarget,
  resolveTapNavigationAction,
} from "@/components/ReaderV2/hooks/use-pagination-tap-nav";
import { describe, expect, it } from "vitest";

describe("ReaderV2 tap navigation", () => {
  describe("getHorizontalTapZone", () => {
    it("resolves left, center, and right thirds", () => {
      const rect = { left: 0, width: 300 };

      expect(getHorizontalTapZone(0, rect)).toBe("left");
      expect(getHorizontalTapZone(99.9, rect)).toBe("left");

      expect(getHorizontalTapZone(100, rect)).toBe("center");
      expect(getHorizontalTapZone(199.9, rect)).toBe("center");

      expect(getHorizontalTapZone(200, rect)).toBe("right");
      expect(getHorizontalTapZone(299.9, rect)).toBe("right");
    });

    it("falls back to center when container width is invalid", () => {
      expect(getHorizontalTapZone(50, { left: 0, width: 0 })).toBe("center");
      expect(getHorizontalTapZone(50, { left: 0, width: -10 })).toBe("center");
    });
  });

  describe("isInteractiveTapTarget", () => {
    it("returns true for highlights and common controls", () => {
      const highlight = document.createElement("mark");
      highlight.setAttribute("data-highlight-id", "h1");

      const button = document.createElement("button");
      const buttonChild = document.createElement("span");
      button.append(buttonChild);

      const link = document.createElement("a");
      link.href = "/reader";

      const editable = document.createElement("div");
      editable.contentEditable = "true";

      expect(isInteractiveTapTarget(highlight)).toBe(true);
      expect(isInteractiveTapTarget(buttonChild)).toBe(true);
      expect(isInteractiveTapTarget(link)).toBe(true);
      expect(isInteractiveTapTarget(editable)).toBe(true);
    });

    it("returns false for non-interactive elements", () => {
      const paragraph = document.createElement("p");
      const span = document.createElement("span");
      paragraph.append(span);

      expect(isInteractiveTapTarget(paragraph)).toBe(false);
      expect(isInteractiveTapTarget(span)).toBe(false);
      expect(isInteractiveTapTarget(null)).toBe(false);
    });
  });

  describe("resolveTapNavigationAction", () => {
    const rect = { left: 0, width: 300 };

    it("maps side-zone non-interactive taps to prev/next", () => {
      const plain = document.createElement("p");

      expect(
        resolveTapNavigationAction({
          clientX: 40,
          rect,
          target: plain,
          isDefaultPrevented: false,
          canGoPrev: true,
          canGoNext: true,
        }),
      ).toBe("prev");

      expect(
        resolveTapNavigationAction({
          clientX: 260,
          rect,
          target: plain,
          isDefaultPrevented: false,
          canGoPrev: true,
          canGoNext: true,
        }),
      ).toBe("next");
    });

    it("returns null for center taps, interactive taps, or prevented events", () => {
      const plain = document.createElement("p");
      const highlight = document.createElement("mark");
      highlight.setAttribute("data-highlight-id", "h2");

      expect(
        resolveTapNavigationAction({
          clientX: 150,
          rect,
          target: plain,
          isDefaultPrevented: false,
          canGoPrev: true,
          canGoNext: true,
        }),
      ).toBeNull();

      expect(
        resolveTapNavigationAction({
          clientX: 40,
          rect,
          target: highlight,
          isDefaultPrevented: false,
          canGoPrev: true,
          canGoNext: true,
        }),
      ).toBeNull();

      expect(
        resolveTapNavigationAction({
          clientX: 260,
          rect,
          target: plain,
          isDefaultPrevented: true,
          canGoPrev: true,
          canGoNext: true,
        }),
      ).toBeNull();
    });

    it("respects canGoPrev/canGoNext guards", () => {
      const plain = document.createElement("p");

      expect(
        resolveTapNavigationAction({
          clientX: 40,
          rect,
          target: plain,
          isDefaultPrevented: false,
          canGoPrev: false,
          canGoNext: true,
        }),
      ).toBeNull();

      expect(
        resolveTapNavigationAction({
          clientX: 260,
          rect,
          target: plain,
          isDefaultPrevented: false,
          canGoPrev: true,
          canGoNext: false,
        }),
      ).toBeNull();
    });
  });
});

import {
  CHROME_HIDE_DELAY_MS,
  ReaderController,
} from "@/components/Reader/ReaderController";
import type { ChromeInteractionMode } from "@/hooks/use-input-behavior";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface HarnessProps {
  chromeInteractionMode: ChromeInteractionMode;
  isChromePinned?: boolean;
  onNextPage?: () => void;
  onPrevPage?: () => void;
}

function ControllerHarness({
  chromeInteractionMode,
  isChromePinned = false,
  onNextPage = () => {},
  onPrevPage = () => {},
}: HarnessProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return createElement(
    ReaderController,
    {
      onNextPage,
      onPrevPage,
      canGoPrev: true,
      canGoNext: true,
      chromeInteractionMode,
      isChromePinned,
      containerRef,
      topRailHeight: 60,
      bottomRailHeight: 72,
    },
    ({
      chromeVisible,
      showHoverRails,
      topRailProps,
      bottomRailProps,
      chromeSurfaceProps,
    }) =>
      createElement(
        "div",
        null,
        createElement("output", { "data-testid": "chrome-visible" }, String(chromeVisible)),
        createElement("div", { ref: containerRef, "data-testid": "stage" }),
        showHoverRails
          ? createElement("div", {
              ...topRailProps,
              "data-testid": "top-rail",
            })
          : null,
        showHoverRails
          ? createElement("div", {
              ...bottomRailProps,
              "data-testid": "bottom-rail",
            })
          : null,
        createElement(
          "button",
          {
            ...chromeSurfaceProps,
            "data-testid": "header",
            tabIndex: 0,
            type: "button",
          },
          "header",
        ),
        createElement(
          "button",
          {
            ...chromeSurfaceProps,
            "data-testid": "footer",
            tabIndex: 0,
            type: "button",
          },
          "footer",
        ),
      ),
  );
}

function createHarness() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  return {
    container,
    root,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function getByTestId(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector(`[data-testid='${testId}']`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element with test id "${testId}"`);
  }

  return element;
}

function isChromeVisible(container: HTMLElement) {
  return getByTestId(container, "chrome-visible").textContent === "true";
}

function setStageBounds(stage: HTMLElement) {
  Object.defineProperty(stage, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 300,
      height: 200,
      right: 300,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });
}

function renderHarness(root: Root, props: HarnessProps) {
  act(() => {
    root.render(createElement(ControllerHarness, props));
  });
}

function dispatchPointerTransition(
  element: HTMLElement,
  type: "pointerover" | "pointerout",
) {
  const PointerEventCtor = window.PointerEvent ?? window.MouseEvent;

  act(() => {
    element.dispatchEvent(new PointerEventCtor(type, { bubbles: true }));
  });
}

function dispatchClick(stage: HTMLElement, clientX: number) {
  act(() => {
    stage.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        clientX,
      }),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ReaderController", () => {
  it("starts hidden in hover mode and hides after the rail leave delay", () => {
    const harness = createHarness();
    renderHarness(harness.root, { chromeInteractionMode: "hover" });

    expect(isChromeVisible(harness.container)).toBe(false);

    const topRail = getByTestId(harness.container, "top-rail");
    dispatchPointerTransition(topRail, "pointerover");
    expect(isChromeVisible(harness.container)).toBe(true);

    dispatchPointerTransition(topRail, "pointerout");
    act(() => {
      vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS - 1);
    });
    expect(isChromeVisible(harness.container)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(isChromeVisible(harness.container)).toBe(false);

    harness.cleanup();
  });

  it("keeps chrome visible when hover moves from a rail into the chrome surface", () => {
    const harness = createHarness();
    renderHarness(harness.root, { chromeInteractionMode: "hover" });

    const topRail = getByTestId(harness.container, "top-rail");
    const header = getByTestId(harness.container, "header");

    dispatchPointerTransition(topRail, "pointerover");
    expect(isChromeVisible(harness.container)).toBe(true);

    dispatchPointerTransition(topRail, "pointerout");
    dispatchPointerTransition(header, "pointerover");

    act(() => {
      vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS);
    });
    expect(isChromeVisible(harness.container)).toBe(true);

    harness.cleanup();
  });

  it("keeps chrome visible while pinned", () => {
    const harness = createHarness();
    renderHarness(harness.root, {
      chromeInteractionMode: "hover",
      isChromePinned: true,
    });

    expect(isChromeVisible(harness.container)).toBe(true);

    const header = getByTestId(harness.container, "header");
    dispatchPointerTransition(header, "pointerout");

    act(() => {
      vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS);
    });
    expect(isChromeVisible(harness.container)).toBe(true);

    harness.cleanup();
  });

  it("resets chrome visibility when the interaction mode changes", () => {
    const harness = createHarness();
    renderHarness(harness.root, { chromeInteractionMode: "touch" });

    expect(isChromeVisible(harness.container)).toBe(true);
    expect(harness.container.querySelector("[data-testid='top-rail']")).toBeNull();

    renderHarness(harness.root, { chromeInteractionMode: "hover" });
    expect(isChromeVisible(harness.container)).toBe(false);
    expect(getByTestId(harness.container, "top-rail")).toBeTruthy();

    renderHarness(harness.root, { chromeInteractionMode: "touch" });
    expect(isChromeVisible(harness.container)).toBe(true);
    expect(harness.container.querySelector("[data-testid='top-rail']")).toBeNull();

    harness.cleanup();
  });

  it("does not apply tap-zone behavior in hover mode", () => {
    const onNextPage = vi.fn();
    const onPrevPage = vi.fn();
    const harness = createHarness();
    renderHarness(harness.root, {
      chromeInteractionMode: "hover",
      onNextPage,
      onPrevPage,
    });

    const stage = getByTestId(harness.container, "stage");
    setStageBounds(stage);

    dispatchClick(stage, 40);
    dispatchClick(stage, 150);
    dispatchClick(stage, 260);

    expect(onPrevPage).not.toHaveBeenCalled();
    expect(onNextPage).not.toHaveBeenCalled();
    expect(isChromeVisible(harness.container)).toBe(false);

    harness.cleanup();
  });

  it("keeps touch mode tap zones for toggle and page navigation", () => {
    const onNextPage = vi.fn();
    const onPrevPage = vi.fn();
    const harness = createHarness();
    renderHarness(harness.root, {
      chromeInteractionMode: "touch",
      onNextPage,
      onPrevPage,
    });

    const stage = getByTestId(harness.container, "stage");
    setStageBounds(stage);

    expect(isChromeVisible(harness.container)).toBe(true);

    dispatchClick(stage, 150);
    expect(isChromeVisible(harness.container)).toBe(false);

    dispatchClick(stage, 40);
    dispatchClick(stage, 260);

    expect(onPrevPage).toHaveBeenCalledTimes(1);
    expect(onNextPage).toHaveBeenCalledTimes(1);

    harness.cleanup();
  });
});

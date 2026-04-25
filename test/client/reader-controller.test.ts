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
  isChromeSuppressed?: boolean;
  onNextPage?: () => void;
  onPrevPage?: () => void;
}

function ControllerHarness({
  chromeInteractionMode,
  isChromeSuppressed = false,
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
      isChromeSuppressed,
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
      chromeDismissLayerProps,
    }) =>
      createElement(
        "div",
        null,
        createElement(
          "output",
          { "data-testid": "chrome-visible" },
          String(chromeVisible),
        ),
        createElement("div", { ref: containerRef, "data-testid": "stage" }),
        chromeDismissLayerProps
          ? createElement("div", {
              ...chromeDismissLayerProps,
              "data-testid": "dismiss-layer",
            })
          : null,
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

function dispatchPointerTap(
  element: HTMLElement,
  clientX: number,
  pointerType: "touch" | "mouse" = "touch",
) {
  const dispatch = (type: "pointerdown" | "pointerup") => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      button: { value: 0 },
      clientX: { value: clientX },
      clientY: { value: 80 },
      pointerId: { value: 1 },
      pointerType: { value: pointerType },
    });
    element.dispatchEvent(event);
  };

  act(() => {
    dispatch("pointerdown");
    dispatch("pointerup");
  });
}

function dispatchClick(element: HTMLElement, clientX = 150) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
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

  it("hides chrome immediately while suppressed by a peer sheet", () => {
    const harness = createHarness();
    renderHarness(harness.root, {
      chromeInteractionMode: "hover",
    });

    const topRail = getByTestId(harness.container, "top-rail");
    dispatchPointerTransition(topRail, "pointerover");
    expect(isChromeVisible(harness.container)).toBe(true);

    renderHarness(harness.root, {
      chromeInteractionMode: "hover",
      isChromeSuppressed: true,
    });
    expect(isChromeVisible(harness.container)).toBe(false);

    dispatchPointerTransition(topRail, "pointerover");
    act(() => {
      vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS);
    });
    expect(isChromeVisible(harness.container)).toBe(false);

    harness.cleanup();
  });

  it("resets chrome visibility when the interaction mode changes", () => {
    const harness = createHarness();
    renderHarness(harness.root, { chromeInteractionMode: "touch" });

    expect(isChromeVisible(harness.container)).toBe(false);
    expect(
      harness.container.querySelector("[data-testid='top-rail']"),
    ).toBeNull();

    renderHarness(harness.root, { chromeInteractionMode: "hover" });
    expect(isChromeVisible(harness.container)).toBe(false);
    expect(getByTestId(harness.container, "top-rail")).toBeTruthy();

    renderHarness(harness.root, { chromeInteractionMode: "touch" });
    expect(isChromeVisible(harness.container)).toBe(false);
    expect(
      harness.container.querySelector("[data-testid='top-rail']"),
    ).toBeNull();

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

    dispatchPointerTap(stage, 40, "touch");
    dispatchPointerTap(stage, 150, "touch");
    dispatchPointerTap(stage, 260, "touch");

    expect(onPrevPage).not.toHaveBeenCalled();
    expect(onNextPage).not.toHaveBeenCalled();
    expect(isChromeVisible(harness.container)).toBe(false);

    harness.cleanup();
  });

  it("uses exposed touch spread taps for chrome reveal and page navigation", () => {
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

    expect(isChromeVisible(harness.container)).toBe(false);

    dispatchPointerTap(stage, 150);
    expect(isChromeVisible(harness.container)).toBe(true);

    const dismissLayer = getByTestId(harness.container, "dismiss-layer");
    dispatchClick(dismissLayer);
    expect(isChromeVisible(harness.container)).toBe(false);

    dispatchPointerTap(stage, 40);
    dispatchPointerTap(stage, 260);

    expect(onPrevPage).toHaveBeenCalledTimes(1);
    expect(onNextPage).toHaveBeenCalledTimes(1);

    harness.cleanup();
  });

  it("ignores mouse pointer taps even in touch chrome mode", () => {
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

    dispatchPointerTap(stage, 40, "mouse");
    dispatchPointerTap(stage, 150, "mouse");
    dispatchPointerTap(stage, 260, "mouse");

    expect(onPrevPage).not.toHaveBeenCalled();
    expect(onNextPage).not.toHaveBeenCalled();
    expect(isChromeVisible(harness.container)).toBe(false);

    harness.cleanup();
  });
});

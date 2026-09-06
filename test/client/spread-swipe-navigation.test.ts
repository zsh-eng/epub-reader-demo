import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  projectSwipeOffset,
  rebaseSwipeOffset,
  resolveSwipeTarget,
  rubberBandSwipeOffset,
  useSpreadSwipeNavigation,
} from "@/features/reader/hooks/use-spread-swipe-navigation";
import { useTouchSpreadTapNav } from "@/features/reader/hooks/use-touch-spread-tap-nav";

interface SwipeHarnessProps {
  currentSpreadId?: number;
  previousSpreadId?: number | null;
  nextSpreadId?: number | null;
  onPrevious?: () => void;
  onNext?: () => void;
  onShowChrome?: () => void;
  disableMotion?: boolean;
}

function SwipeHarness({
  currentSpreadId = 1,
  previousSpreadId = null,
  nextSpreadId = 2,
  onPrevious = () => {},
  onNext = () => {},
  onShowChrome = () => {},
  disableMotion = true,
}: SwipeHarnessProps) {
  const tapSurfaceRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const swipe = useSpreadSwipeNavigation({
    containerRef: stageRef,
    enabled: true,
    currentSpreadId,
    previousSpreadId,
    nextSpreadId,
    onPrevious,
    onNext,
    disableMotion,
  });
  useTouchSpreadTapNav({
    containerRef: tapSurfaceRef,
    enabled: true,
    onPrevSpread: onPrevious,
    onNextSpread: onNext,
    onShowChrome,
    canGoPrev: previousSpreadId !== null,
    canGoNext: nextSpreadId !== null,
  });

  return createElement(
    "div",
    { ref: tapSurfaceRef, "data-testid": "tap-surface" },
    createElement("div", {
      ref: stageRef,
      "data-testid": "stage",
      "data-phase": swipe.phase,
    }),
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
      act(() => root.unmount());
      container.remove();
    },
  };
}

function renderHarness(root: Root, props: SwipeHarnessProps) {
  act(() => root.render(createElement(SwipeHarness, props)));
}

function prepareStage(container: HTMLElement): HTMLElement {
  const stage = container.querySelector("[data-testid='stage']");
  if (!(stage instanceof HTMLElement)) throw new Error("Missing swipe stage");
  const tapSurface = container.querySelector("[data-testid='tap-surface']");
  if (!(tapSurface instanceof HTMLElement)) {
    throw new Error("Missing tap surface");
  }

  Object.defineProperties(stage, {
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ left: 0, width: 600 }),
    },
    setPointerCapture: { configurable: true, value: () => {} },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: () => {} },
  });
  Object.defineProperty(tapSurface, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, width: 600 }),
  });
  return stage;
}

function dispatchTouchPointer(
  stage: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY = 100,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
    isPrimary: { value: true },
    pointerId: { value: 1 },
    pointerType: { value: "touch" },
  });
  stage.dispatchEvent(event);
}

describe("spread swipe navigation", () => {
  it("projects release velocity in the drag direction", () => {
    expect(projectSwipeOffset(0, -1000)).toBeCloseTo(-99);
    expect(projectSwipeOffset(40, 1000)).toBeCloseTo(139);
  });

  it("commits a slow drag at one quarter of the stage", () => {
    expect(
      resolveSwipeTarget({
        offset: -150,
        velocity: 0,
        width: 600,
        canGoPrevious: true,
        canGoNext: true,
      }),
    ).toBe(-600);
    expect(
      resolveSwipeTarget({
        offset: 150,
        velocity: 0,
        width: 600,
        canGoPrevious: true,
        canGoNext: true,
      }),
    ).toBe(600);
    expect(
      resolveSwipeTarget({
        offset: -149,
        velocity: 0,
        width: 600,
        canGoPrevious: true,
        canGoNext: true,
      }),
    ).toBe(0);
  });

  it("uses velocity to commit a short flick", () => {
    expect(
      resolveSwipeTarget({
        offset: -40,
        velocity: -2000,
        width: 600,
        canGoPrevious: true,
        canGoNext: true,
      }),
    ).toBe(-600);
  });

  it("resolves a new swipe independently from a prior settle offset", () => {
    expect(
      resolveSwipeTarget({
        startOffset: 360,
        offset: 110,
        velocity: 0,
        width: 600,
        canGoPrevious: true,
        canGoNext: true,
      }),
    ).toBe(-600);
  });

  it("returns to the current page for an incomplete gesture", () => {
    expect(
      resolveSwipeTarget({
        offset: -80,
        velocity: 0,
        width: 600,
        canGoPrevious: true,
        canGoNext: true,
      }),
    ).toBe(0);
  });

  it("does not commit through either book boundary", () => {
    expect(
      resolveSwipeTarget({
        offset: -400,
        velocity: -2000,
        width: 600,
        canGoPrevious: true,
        canGoNext: false,
      }),
    ).toBe(0);
    expect(
      resolveSwipeTarget({
        offset: 400,
        velocity: 2000,
        width: 600,
        canGoPrevious: false,
        canGoNext: true,
      }),
    ).toBe(0);
  });

  it("adds resistance without reversing an edge pull", () => {
    const resisted = rubberBandSwipeOffset(300, 600);
    expect(resisted).toBeGreaterThan(0);
    expect(resisted).toBeLessThan(300);
    expect(rubberBandSwipeOffset(-300, 600)).toBeCloseTo(-resisted);
  });

  it("rebases the live offset when an adjacent spread becomes current", () => {
    expect(rebaseSwipeOffset(-240, "next", 600)).toBe(360);
    expect(rebaseSwipeOffset(240, "previous", 600)).toBe(-360);
  });

  it("commits a horizontal gesture and waits for the new spread", () => {
    const harness = createHarness();
    const onNext = vi.fn();
    renderHarness(harness.root, { onNext });
    const stage = prepareStage(harness.container);

    act(() => {
      dispatchTouchPointer(stage, "pointerdown", 500);
      dispatchTouchPointer(stage, "pointermove", 250);
      dispatchTouchPointer(stage, "pointerup", 250);
    });

    expect(onNext).toHaveBeenCalledOnce();
    expect(stage.dataset.phase).toBe("awaiting-navigation");

    renderHarness(harness.root, { currentSpreadId: 2, onNext });
    expect(stage.dataset.phase).toBe("idle");
    harness.cleanup();
  });

  it("accepts another swipe while the confirmed turn is still settling", () => {
    const harness = createHarness();
    const onNext = vi.fn();
    renderHarness(harness.root, { disableMotion: false, onNext });
    const stage = prepareStage(harness.container);

    act(() => {
      dispatchTouchPointer(stage, "pointerdown", 500);
      dispatchTouchPointer(stage, "pointermove", 250);
      dispatchTouchPointer(stage, "pointerup", 250);
    });
    expect(onNext).toHaveBeenCalledOnce();

    renderHarness(harness.root, {
      currentSpreadId: 2,
      previousSpreadId: 1,
      nextSpreadId: 3,
      disableMotion: false,
      onNext,
    });

    act(() => {
      dispatchTouchPointer(stage, "pointerdown", 500);
      dispatchTouchPointer(stage, "pointermove", -100);
      dispatchTouchPointer(stage, "pointerup", -100);
    });

    expect(onNext).toHaveBeenCalledTimes(2);
    harness.cleanup();
  });

  it("lets a center tap reveal chrome while a confirmed turn is settling", () => {
    const harness = createHarness();
    const onNext = vi.fn();
    const onShowChrome = vi.fn();
    renderHarness(harness.root, {
      disableMotion: false,
      onNext,
      onShowChrome,
    });
    const stage = prepareStage(harness.container);

    act(() => {
      dispatchTouchPointer(stage, "pointerdown", 500);
      dispatchTouchPointer(stage, "pointermove", 300);
      dispatchTouchPointer(stage, "pointerup", 300);
    });
    expect(onNext).toHaveBeenCalledOnce();

    renderHarness(harness.root, {
      currentSpreadId: 2,
      previousSpreadId: 1,
      nextSpreadId: 3,
      disableMotion: false,
      onNext,
      onShowChrome,
    });
    expect(stage.dataset.phase).toBe("settling");

    act(() => {
      dispatchTouchPointer(stage, "pointerdown", 300);
      dispatchTouchPointer(stage, "pointerup", 300);
    });

    expect(onShowChrome).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    harness.cleanup();
  });

  it("does not claim vertical, incomplete, or boundary gestures", () => {
    const harness = createHarness();
    const onNext = vi.fn();
    renderHarness(harness.root, { nextSpreadId: null, onNext });
    const stage = prepareStage(harness.container);

    act(() => {
      dispatchTouchPointer(stage, "pointerdown", 500);
      dispatchTouchPointer(stage, "pointermove", 490, 180);
      dispatchTouchPointer(stage, "pointerup", 490, 180);

      dispatchTouchPointer(stage, "pointerdown", 500);
      dispatchTouchPointer(stage, "pointermove", 430);
      dispatchTouchPointer(stage, "pointerup", 430);

      dispatchTouchPointer(stage, "pointerdown", 500);
      dispatchTouchPointer(stage, "pointermove", 100);
      dispatchTouchPointer(stage, "pointerup", 100);
    });

    expect(onNext).not.toHaveBeenCalled();
    expect(stage.dataset.phase).toBe("idle");
    harness.cleanup();
  });

  it("leaves a long-press drag available for text selection", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1000);
    const harness = createHarness();
    const onNext = vi.fn();
    renderHarness(harness.root, { onNext });
    const stage = prepareStage(harness.container);

    act(() => {
      dispatchTouchPointer(stage, "pointerdown", 500);
    });
    vi.setSystemTime(1501);
    act(() => {
      dispatchTouchPointer(stage, "pointermove", 250);
      dispatchTouchPointer(stage, "pointerup", 250);
    });

    expect(onNext).not.toHaveBeenCalled();
    expect(stage.dataset.phase).toBe("idle");
    harness.cleanup();
    vi.useRealTimers();
  });
});

it("keeps an in-progress swipe and uses the newly committed navigation callback", () => {
  const harness = createHarness();
  const originalNext = vi.fn();
  const updatedNext = vi.fn();
  renderHarness(harness.root, { onNext: originalNext });
  const stage = prepareStage(harness.container);
  act(() => {
    dispatchTouchPointer(stage, "pointerdown", 500);
    dispatchTouchPointer(stage, "pointermove", 480);
  });
  renderHarness(harness.root, { onNext: updatedNext });
  act(() => {
    dispatchTouchPointer(stage, "pointermove", 200);
    dispatchTouchPointer(stage, "pointerup", 200);
  });
  expect(originalNext).not.toHaveBeenCalled();
  expect(updatedNext).toHaveBeenCalledOnce();
  harness.cleanup();
});

it("uses current tap permissions and callbacks without replacing the surface", () => {
  const harness = createHarness();
  const originalNext = vi.fn();
  const updatedNext = vi.fn();
  renderHarness(harness.root, { nextSpreadId: null, onNext: originalNext });
  const stage = prepareStage(harness.container);
  renderHarness(harness.root, { nextSpreadId: 2, onNext: updatedNext });
  act(() => {
    dispatchTouchPointer(stage, "pointerdown", 550);
    dispatchTouchPointer(stage, "pointerup", 550);
  });
  expect(originalNext).not.toHaveBeenCalled();
  expect(updatedNext).toHaveBeenCalledOnce();
  harness.cleanup();
});

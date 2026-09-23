import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTouchSpreadTapNav } from "@/features/reader/hooks/use-touch-spread-tap-nav";

function setup() {
  const stage = document.createElement("div");
  stage.textContent = "Reading content for selection";
  document.body.append(stage);
  stage.setPointerCapture = vi.fn();
  stage.hasPointerCapture = () => true;
  stage.releasePointerCapture = vi.fn();
  const onShowChrome = vi.fn();
  const onNextSpread = vi.fn();
  const onPrevSpread = vi.fn();
  const containerRef = { current: stage };
  const hook = renderHook(
    ({ enabled, chromeVisible }) =>
      useTouchSpreadTapNav({
        containerRef,
        enabled,
        chromeVisible,
        onShowChrome,
        onNextSpread,
        onPrevSpread,
        canGoNext: true,
        canGoPrev: true,
      }),
    { initialProps: { enabled: true, chromeVisible: false } },
  );
  act(() => hook.result.current.height.set(100));
  function pointer(
    type: string,
    x = 150,
    y = 200,
    isPrimary = true,
    target = stage,
  ) {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: isPrimary ? 1 : 2,
      pointerType: "touch",
      isPrimary,
      button: 0,
      clientX: x,
      clientY: y,
    });
    act(() => target.dispatchEvent(event));
    return event;
  }
  return {
    ...hook,
    stage,
    pointer,
    onShowChrome,
    onNextSpread,
    onPrevSpread,
    cleanup() {
      hook.unmount();
      stage.remove();
    },
  };
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
});

describe("Reader progress peek", () => {
  it("caps the offset at the measured peek height before release", () => {
    const h = setup();
    h.pointer("pointerdown");
    h.pointer("pointermove", 150, -100);
    expect(h.result.current.offset.get()).toBe(100);
    h.cleanup();
  });

  it("tracks and reverses an upward drag without making chrome visible", () => {
    const h = setup();
    h.pointer("pointerdown");
    h.pointer("pointermove", 150, 160);
    expect(h.result.current.offset.get()).toBe(40);
    h.pointer("pointermove", 150, 120);
    expect(h.result.current.offset.get()).toBe(80);
    h.pointer("pointermove", 150, 180);
    expect(h.result.current.offset.get()).toBe(20);
    h.pointer("pointermove", 150, 205);
    expect(h.result.current.offset.get()).toBe(0);
    h.pointer("pointerup", 150, 205);
    expect(h.onShowChrome).not.toHaveBeenCalled();
    expect(h.onNextSpread).not.toHaveBeenCalled();
    expect(h.onPrevSpread).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("locks out upward peeking after a horizontal or downward start", () => {
    const h = setup();
    for (const [x, y] of [
      [180, 200],
      [150, 230],
    ]) {
      h.pointer("pointerdown");
      h.pointer("pointermove", x, y);
      h.pointer("pointermove", 150, 100);
      expect(h.result.current.offset.get()).toBe(0);
      h.pointer("pointerup", 150, 100);
    }
    expect(h.onShowChrome).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("leaves long presses, selected text, and links available to native interaction", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const h = setup();
    h.pointer("pointerdown");
    vi.advanceTimersByTime(500);
    h.pointer("pointermove", 150, 100);
    h.pointer("pointerup", 150, 100);
    expect(h.result.current.offset.get()).toBe(0);

    const range = document.createRange();
    range.selectNodeContents(h.stage);
    window.getSelection()?.addRange(range);
    h.pointer("pointerdown");
    h.pointer("pointermove", 150, 100);
    h.pointer("pointerup", 150, 100);
    expect(h.result.current.offset.get()).toBe(0);
    expect(window.getSelection()?.toString()).toBe(h.stage.textContent);
    window.getSelection()?.removeAllRanges();

    const link = document.createElement("a");
    link.href = "#chapter";
    h.stage.append(link);
    h.pointer("pointerdown", 150, 200, true, link);
    h.pointer("pointermove", 150, 100, true, link);
    h.pointer("pointerup", 150, 100, true, link);
    expect(h.result.current.offset.get()).toBe(0);
    expect(h.onShowChrome).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("clears a held peek when an overlay suppresses Reader interaction", () => {
    const h = setup();
    h.pointer("pointerdown");
    h.pointer("pointermove", 150, 100);
    expect(h.result.current.offset.get()).toBe(100);
    h.rerender({ enabled: false, chromeVisible: false });
    expect(h.result.current.offset.get()).toBe(0);
    h.rerender({ enabled: true, chromeVisible: false });
    h.pointer("pointerup", 150, 100);
    expect(h.onShowChrome).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("does not take over chrome that was already visible", () => {
    const h = setup();
    h.rerender({ enabled: true, chromeVisible: true });
    h.pointer("pointerdown");
    h.pointer("pointermove", 150, 100);
    h.pointer("pointerup", 150, 100);
    expect(h.result.current.offset.get()).toBe(0);
    expect(h.onShowChrome).not.toHaveBeenCalled();
    h.cleanup();
  });
});

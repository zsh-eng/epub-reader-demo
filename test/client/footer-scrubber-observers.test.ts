import { FooterScrubberCanvas } from "@/features/reader/footer/FooterScrubberCanvas";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("retains observers while drawing updated pagination and cleans them up", () => {
  const observers: {
    callback: () => void;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  class Observer {
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(public callback: () => void) {
      observers.push(this);
    }
  }
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("MutationObserver", Observer);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const fillText = vi.fn();
  const context = new Proxy(
    { fillText },
    { get: (target, key) => (key === "fillText" ? target.fillText : vi.fn()) },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  const props = {
    currentPage: 1,
    totalPages: 10,
    chapterStartPages: [1],
    onScrubCommit: vi.fn(),
  };
  const view = render(createElement(FooterScrubberCanvas, props));
  const canvas = view.container.querySelector("canvas")!;
  Object.defineProperties(canvas, {
    offsetWidth: { value: 600 },
    offsetHeight: { value: 60 },
  });
  expect(observers).toHaveLength(2);
  act(() => observers[0].callback());
  expect(fillText).not.toHaveBeenCalled();
  view.rerender(
    createElement(FooterScrubberCanvas, {
      ...props,
      totalPages: 40,
      chapterStartPages: [1, 20],
    }),
  );
  expect(observers).toHaveLength(2);
  for (const observer of observers) {
    fillText.mockClear();
    act(() => observer.callback());
    expect(fillText.mock.calls.some(([text]) => text === "20")).toBe(true);
    expect(observer.disconnect).not.toHaveBeenCalled();
  }
  view.unmount();
  for (const observer of observers)
    expect(observer.disconnect).toHaveBeenCalledOnce();
});

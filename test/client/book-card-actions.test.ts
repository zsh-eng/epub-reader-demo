import { BookCardActions } from "@/components/BookCardActions";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalInnerWidth = window.innerWidth;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalInnerWidth,
  });
});

describe("BookCardActions", () => {
  it("cancels a moving touch and requests the sheet after a settled long press", async () => {
    const onOpenMobileActions = vi.fn();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    });

    render(
      createElement(
        BookCardActions,
        {
          status: null,
          isUpdating: false,
          onSelectStatus: vi.fn(),
          onRemove: () => false,
          onOpenMobileActions,
        },
        createElement("button", { type: "button" }, "Book One"),
      ),
    );

    const trigger = screen.getByRole("button", { name: "Book One" });
    await waitFor(() =>
      expect(trigger.parentElement?.classList.contains("touch-pan-y")).toBe(
        true,
      ),
    );

    vi.useFakeTimers();
    fireEvent.pointerDown(trigger, {
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(trigger, {
      pointerType: "touch",
      clientX: 30,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(700));
    expect(onOpenMobileActions).not.toHaveBeenCalled();

    fireEvent.pointerDown(trigger, {
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    expect(trigger.parentElement?.dataset.longPressPhase).toBe("pressing");
    act(() => vi.advanceTimersByTime(499));
    expect(onOpenMobileActions).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));

    expect(onOpenMobileActions).not.toHaveBeenCalled();
    expect(trigger.parentElement?.dataset.longPressPhase).toBe("popping");
    act(() => vi.advanceTimersByTime(149));
    expect(onOpenMobileActions).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onOpenMobileActions).not.toHaveBeenCalled();
    expect(trigger.parentElement?.dataset.longPressPhase).toBe("popping");

    // The sheet must not mount under the active finger, even after the pop.
    act(() => vi.advanceTimersByTime(300));
    expect(onOpenMobileActions).not.toHaveBeenCalled();

    fireEvent.pointerUp(trigger, {
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });

    act(() => vi.advanceTimersByTime(49));
    expect(onOpenMobileActions).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));

    expect(onOpenMobileActions).toHaveBeenCalledOnce();
    expect(trigger.parentElement?.dataset.longPressPhase).toBe("settling");
  });
});

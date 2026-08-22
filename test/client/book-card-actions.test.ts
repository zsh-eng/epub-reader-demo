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
  document.body.classList.remove("library-long-press-active");
});

describe("BookCardActions", () => {
  it("cancels a moving touch and opens only after the committed touch ends", async () => {
    const onOpenMobileActions = vi.fn();
    const onBookClick = vi.fn();
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
        createElement(
          "button",
          { type: "button", onClick: onBookClick },
          "Book One",
        ),
      ),
    );

    const trigger = screen.getByRole("button", { name: "Book One" });
    await waitFor(() =>
      expect(trigger.parentElement?.classList.contains("touch-pan-y")).toBe(
        true,
      ),
    );

    vi.useFakeTimers();
    fireEvent.touchStart(trigger, {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    fireEvent.touchMove(trigger, {
      touches: [{ clientX: 30, clientY: 10 }],
    });
    act(() => vi.advanceTimersByTime(700));
    expect(onOpenMobileActions).not.toHaveBeenCalled();
    expect(trigger.parentElement?.dataset.longPressState).toBeUndefined();

    fireEvent.touchStart(trigger, {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    expect(trigger.parentElement?.dataset.longPressState).toBe("pressing");
    expect(document.body.classList.contains("library-long-press-active")).toBe(
      true,
    );
    act(() => vi.advanceTimersByTime(499));
    expect(onOpenMobileActions).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));

    expect(onOpenMobileActions).not.toHaveBeenCalled();
    expect(trigger.parentElement?.dataset.longPressState).toBe("popping");

    fireEvent.touchEnd(trigger, {
      touches: [],
      changedTouches: [{ clientX: 10, clientY: 10 }],
    });

    // The complete pop plays before the sheet mounts.
    act(() => vi.advanceTimersByTime(199));
    expect(onOpenMobileActions).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));

    expect(onOpenMobileActions).toHaveBeenCalledOnce();
    expect(trigger.parentElement?.dataset.longPressState).toBeUndefined();
    expect(document.body.classList.contains("library-long-press-active")).toBe(
      false,
    );

    fireEvent.click(trigger);
    expect(onBookClick).not.toHaveBeenCalled();
  });

  it("does not mount the sheet while the finger remains down", async () => {
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
        createElement("button", { type: "button" }, "Book Two"),
      ),
    );

    const trigger = screen.getByRole("button", { name: "Book Two" });
    await waitFor(() =>
      expect(trigger.parentElement?.classList.contains("touch-pan-y")).toBe(
        true,
      ),
    );

    vi.useFakeTimers();
    fireEvent.touchStart(trigger, {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    act(() => vi.advanceTimersByTime(900));

    expect(onOpenMobileActions).not.toHaveBeenCalled();
    expect(trigger.parentElement?.dataset.longPressState).toBe("settling");

    fireEvent.touchEnd(trigger, {
      touches: [],
      changedTouches: [{ clientX: 10, clientY: 10 }],
    });
    act(() => vi.advanceTimersByTime(50));

    expect(onOpenMobileActions).toHaveBeenCalledOnce();
  });
});

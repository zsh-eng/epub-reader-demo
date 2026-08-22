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
  it("cancels a moving touch and opens the sheet for a settled long press", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    });

    render(
      createElement(
        BookCardActions,
        {
          bookTitle: "Book One",
          bookAuthor: "Author One",
          coverUrl: undefined,
          status: null,
          isUpdating: false,
          onSelectStatus: vi.fn(),
          onRemove: () => false,
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
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("dialog", { name: "Reading status" })).toBeNull();

    fireEvent.pointerDown(trigger, {
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(500));

    expect(screen.getByRole("dialog", { name: "Reading status" })).toBeTruthy();
  });
});

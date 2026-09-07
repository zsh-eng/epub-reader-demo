import { MobileHighlightBar } from "@/features/reader/shared/MobileHighlightBar";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);
it.each(["Highlight with green", "Delete highlight"])(
  "waits for click before %s and ignores pointer cancellation",
  (name) => {
    const onColorSelect = vi.fn();
    const onDelete = vi.fn();
    render(
      createElement(MobileHighlightBar, {
        onColorSelect,
        onDelete,
        onClose: vi.fn(),
        currentColor: "yellow",
        isNavVisible: false,
      }),
    );
    const button = screen.getByRole("button", { name });
    expect(fireEvent.pointerDown(button)).toBe(false);
    fireEvent.pointerCancel(button);
    expect(onColorSelect).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(
      name === "Delete highlight" ? onDelete : onColorSelect,
    ).toHaveBeenCalledOnce();
  },
);

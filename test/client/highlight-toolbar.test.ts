import { HighlightToolbar } from "@/components/HighlightToolbar";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@tanstack/react-hotkeys", () => ({
  useHotkey: vi.fn(),
}));

afterEach(cleanup);

describe("HighlightToolbar", () => {
  it("uses the desktop floating pill and selects a color on click", () => {
    const onColorSelect = vi.fn();
    const { container } = render(
      createElement(HighlightToolbar, {
        position: { x: 200, y: 200 },
        onColorSelect,
        onClose: vi.fn(),
        currentColor: "green",
        onDelete: vi.fn(),
      }),
    );

    const toolbar = container.querySelector(".highlight-toolbar");
    expect(toolbar?.classList.contains("rounded-full")).toBe(true);
    expect(toolbar?.classList.contains("bg-popover/95")).toBe(true);

    const yellow = screen.getByRole("button", {
      name: "Highlight with yellow",
    });
    fireEvent.pointerDown(yellow);
    expect(onColorSelect).not.toHaveBeenCalled();

    fireEvent.click(yellow);
    expect(onColorSelect).toHaveBeenCalledOnce();
    expect(onColorSelect).toHaveBeenCalledWith("yellow");
  });
});

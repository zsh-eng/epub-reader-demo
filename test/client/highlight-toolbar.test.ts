import { HighlightToolbar } from "@/features/reader/shared/HighlightToolbar";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@tanstack/react-hotkeys", () => ({
  useHotkey: vi.fn(),
}));

const originalClipboard = navigator.clipboard;

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
});

describe("HighlightToolbar", () => {
  it("uses the desktop floating pill with color and copy actions", async () => {
    const onColorSelect = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { container } = render(
      createElement(HighlightToolbar, {
        position: { x: 200, y: 200 },
        onColorSelect,
        onClose: vi.fn(),
        currentColor: "green",
        onDelete: vi.fn(),
        textToCopy: "A selected passage",
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

    fireEvent.click(
      screen.getByRole("button", { name: "Copy highlighted text" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("A selected passage"),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Copy highlighted text" })
          .querySelector(".lucide-check"),
      ).toBeTruthy(),
    );
  });
});

it.each(["denied", "unavailable"])(
  "shows a copy error when clipboard access is %s",
  async (condition) => {
    const { Toaster, toast } = await import("sonner");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value:
        condition === "denied"
          ? {
              writeText: vi
                .fn()
                .mockRejectedValue(new Error("Permission denied")),
            }
          : undefined,
    });
    render(createElement(Toaster));
    render(
      createElement(HighlightToolbar, {
        position: { x: 200, y: 200 },
        onColorSelect: vi.fn(),
        onClose: vi.fn(),
        textToCopy: "A selected passage",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy highlighted text" }),
    );
    await screen.findByText("Could not copy highlight");
    expect(
      screen
        .getByRole("button", { name: "Copy highlighted text" })
        .querySelector(".lucide-check"),
    ).toBeNull();
    toast.dismiss();
    consoleError.mockRestore();
  },
);

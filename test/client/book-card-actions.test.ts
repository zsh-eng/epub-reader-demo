import { BookCardActions } from "@/features/library/BookCardActions";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalInnerWidth = window.innerWidth;

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalInnerWidth,
  });
});

function renderBook(name: string, width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });

  render(
    createElement(
      BookCardActions,
      {
        status: null,
        isUpdating: false,
        onSelectStatus: vi.fn(),
        onRemove: () => false,
      },
      createElement("button", { type: "button" }, name),
    ),
  );

  return screen.getByRole("button", { name });
}

describe("BookCardActions", () => {
  it("does not expose a context-menu trigger on mobile", async () => {
    const bookButton = renderBook("Mobile Book", 500);

    await waitFor(() =>
      expect(
        bookButton.closest('[data-slot="context-menu-trigger"]'),
      ).toBeNull(),
    );

    expect(screen.queryByText("Want to Read")).toBeNull();
  });

  it("keeps the context-menu trigger on desktop", async () => {
    const bookButton = renderBook("Desktop Book", 1024);

    await waitFor(() =>
      expect(
        bookButton.closest('[data-slot="context-menu-trigger"]'),
      ).not.toBeNull(),
    );
  });
});

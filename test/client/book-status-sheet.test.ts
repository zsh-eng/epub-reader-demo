import { BookStatusSheet } from "@/components/BookStatusSheet";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("BookStatusSheet", () => {
  it("shows the selected status and stays open after another status is chosen", () => {
    const onOpenChange = vi.fn();
    const onSelectStatus = vi.fn();

    render(
      createElement(BookStatusSheet, {
        open: true,
        onOpenChange,
        bookTitle: "Book One",
        bookAuthor: "Author One",
        coverUrl: "blob:cover",
        status: "reading",
        isUpdating: false,
        onBack: vi.fn(),
        onSelectStatus,
        onRemove: () => false,
      }),
    );

    expect(screen.getAllByText("Reading status")).toHaveLength(1);
    const dialog = screen.getByRole("dialog", { name: "Reading status" });
    expect(dialog.querySelector("[data-base-ui-swipe-ignore]")).toBeNull();
    expect(dialog.querySelector(".select-none")).toBeTruthy();

    const selectedOption = screen.getByRole("button", { name: "Reading" });
    expect(selectedOption.getAttribute("aria-pressed")).toBe("true");
    expect(selectedOption.classList.contains("border-foreground")).toBe(true);

    expect(screen.queryByRole("button", { name: "Open Book One" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Finished" }));

    expect(onSelectStatus).toHaveBeenCalledWith("finished");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows reader navigation without making the current book interactive", () => {
    const onBack = vi.fn();

    render(
      createElement(BookStatusSheet, {
        open: true,
        onOpenChange: vi.fn(),
        bookTitle: "Current Book",
        bookAuthor: "Current Author",
        coverUrl: "blob:current-cover",
        status: "reading",
        isUpdating: false,
        onBack,
        onSelectStatus: vi.fn(),
        onRemove: () => false,
      }),
    );

    expect(
      screen.queryByRole("button", { name: "Open Current Book" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Back to reader tools" }),
    );
    expect(onBack).toHaveBeenCalledOnce();
  });
});

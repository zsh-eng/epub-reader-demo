import { BookStatusSheet } from "@/components/BookStatusSheet";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("BookStatusSheet", () => {
  it("shows the selected status and stays open after another status is chosen", () => {
    const onOpenChange = vi.fn();
    const onOpenBook = vi.fn();
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
        onOpenBook,
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

    fireEvent.click(screen.getByRole("button", { name: "Open Book One" }));
    expect(onOpenBook).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Finished" }));

    expect(onSelectStatus).toHaveBeenCalledWith("finished");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

import { LibraryBookStatusSheet } from "@/components/LibraryBookStatusSheet";
import type { Book } from "@/lib/db";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn((_status: string, callbacks: { onSuccess?: () => void }) =>
    callbacks.onSuccess?.(),
  ),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-reading-status", () => ({
  useSetReadingStatus: () => ({
    isPending: false,
    mutate: mocks.mutate,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const book: Book = {
  id: "book-1",
  fileHash: "epub-hash",
  title: "Book One",
  author: "Author One",
  fileSize: 100,
  dateAdded: 1,
  metadata: {},
  manifest: [],
  spine: [],
  toc: [],
  isDownloaded: 1,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LibraryBookStatusSheet", () => {
  it("keeps its optimistic selection through a query-driven prop refresh", () => {
    const onOpenChange = vi.fn();
    const props = {
      open: true,
      onOpenChange,
      book,
      coverUrl: undefined,
      initialStatus: "want-to-read" as const,
      onOpenBook: vi.fn(),
      onDelete: vi.fn(),
    };
    const { rerender } = render(createElement(LibraryBookStatusSheet, props));

    fireEvent.click(screen.getByRole("button", { name: "Reading" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      "reading",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    rerender(createElement(LibraryBookStatusSheet, props));

    expect(screen.getByRole("dialog", { name: "Reading status" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Reading" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

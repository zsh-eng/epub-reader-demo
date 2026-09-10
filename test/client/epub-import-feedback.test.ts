import {
  EpubImportProvider,
  useEpubImport,
} from "@/features/library/use-epub-import";
import { DuplicateBookError } from "@/lib/book-service";
import type { Book } from "@/lib/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/hooks/use-epub-processor", () => ({
  markEpubPreparationReady: vi.fn(),
}));
vi.mock("@/lib/book-service", () => ({
  addBookFromFile: mocks.add,
  DuplicateBookError: class extends Error {
    constructor(
      message: string,
      public existingBook: Book,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/features/library/DuplicateBookDialog", () => ({
  DuplicateBookDialog: ({ open }: { open: boolean }) =>
    open ? createElement("div", { role: "dialog" }, "Already imported") : null,
}));

function setup() {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const client = new QueryClient();
  return renderHook(useEpubImport, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(EpubImportProvider, null, children),
      ),
  });
}
const files = [new File(["epub"], "one.epub"), new File(["epub"], "two.epub")];
const duplicate = () =>
  new DuplicateBookError("Duplicate", { id: "existing" } as Book);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("reports duplicate-only batches without an import error", async () => {
  mocks.add.mockRejectedValue(duplicate());
  const { result } = setup();
  await act(() => result.current.importFiles(files));
  expect(mocks.toast).toHaveBeenCalledWith({
    title: "Already in library",
    description: "2 skipped (already in library)",
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(result.current.isProcessing).toBe(false);
});
it("keeps the single-duplicate dialog", async () => {
  mocks.add.mockRejectedValue(duplicate());
  const { result } = setup();
  await act(() => result.current.importFiles(files.slice(0, 1)));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(mocks.toast).not.toHaveBeenCalled();
});
it("reports real errors in a mixed duplicate and malformed batch", async () => {
  mocks.add
    .mockRejectedValueOnce(duplicate())
    .mockRejectedValueOnce(new Error("Malformed EPUB"));
  const { result } = setup();
  await act(() => result.current.importFiles(files));
  expect(mocks.toast).toHaveBeenCalledWith({
    title: "Import failed",
    description: "1 skipped (already in library) · 1 failed",
    variant: "destructive",
  });
});

it("offers the one newly imported book while preserving mixed batch outcomes", async () => {
  mocks.add
    .mockResolvedValueOnce({ id: "new-book" } as Book)
    .mockRejectedValueOnce(duplicate())
    .mockRejectedValueOnce(new Error("Malformed EPUB"));
  const { result } = setup();
  await act(() =>
    result.current.importFiles([
      ...files,
      new File(["bad"], "broken.epub"),
      new File(["ignored"], "notes.txt"),
    ]),
  );
  const notification = mocks.toast.mock.calls[0][0];
  expect(notification.description).toBe(
    "1 book added · 1 skipped (already in library) · 1 failed · 1 non-EPUB file ignored",
  );
  expect(notification.action.label).toBe("Open book");
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/");
  notification.action.onClick();
  expect(mocks.navigate).toHaveBeenLastCalledWith("/reader/new-book");
});

it("keeps multiple successful imports in the Library without selecting a book", async () => {
  mocks.add
    .mockResolvedValueOnce({ id: "one" } as Book)
    .mockResolvedValueOnce({ id: "two" } as Book);
  const { result } = setup();
  await act(() => result.current.importFiles(files));
  expect(mocks.toast).toHaveBeenCalledWith({
    title: "Import complete",
    description: "2 books added",
  });
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/");
});

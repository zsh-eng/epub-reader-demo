import { BookCard } from "@/features/library/BookCard";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useReadingStatus } from "@/hooks/use-reading-status";
import * as database from "@/lib/db";
import type { Book, ReadingStatus } from "@/lib/db";
import { syncV2Db } from "@/lib/sync-v2/db";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/features/library/BookCardActions", () => ({
  BookCardActions: ({
    status,
    isUpdating,
    onSelectStatus,
  }: {
    status: ReadingStatus;
    isUpdating: boolean;
    onSelectStatus: (status: ReadingStatus) => void;
  }) =>
    createElement(
      "button",
      {
        disabled: isUpdating,
        onClick: () => onSelectStatus("finished"),
      },
      status,
    ),
}));

const book: Book = {
  id: "status-book",
  title: "Book",
  author: "Author",
  cover: null,
  sourceFileId: "xxh64:1111111111111111" as Book["sourceFileId"],
  fileSize: 100,
  dateAdded: 1,
  metadata: {},
  manifest: [],
  spine: [],
  toc: [],
};
let client: QueryClient;

function Card() {
  useReadingStatus(book.id);
  const { data, isLoading } = useBooksWithStatuses();
  if (isLoading) return null;
  const status = data?.statuses.get(book.id) ?? null;
  return createElement(BookCard, { book, status, onDelete: vi.fn() });
}

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await syncV2Db.open();
  await syncV2Db.books.put(book);
  await database.setReadingStatus(book.id, "reading");
});
afterEach(async () => {
  cleanup();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  client.clear();
  await syncV2Db.delete();
});

async function mountCard() {
  render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(MemoryRouter, null, createElement(Card)),
    ),
  );
  await screen.findByRole("button", { name: "reading" });
}

it("shows pending status offline, then retains the saved status after refreshing", async () => {
  const write = database.setReadingStatus;
  const gate = Promise.withResolvers<void>();
  vi.spyOn(database, "setReadingStatus").mockImplementation(async (...args) => {
    await gate.promise;
    return write(...args);
  });
  await mountCard();
  onlineManager.setOnline(false);
  fireEvent.click(screen.getByRole("button", { name: "reading" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "finished" }).hasAttribute("disabled"),
    ).toBe(true),
  );
  expect(await database.getReadingStatus(book.id)).toBe("reading");
  await act(async () => gate.resolve());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "finished" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(await database.getReadingStatus(book.id)).toBe("finished");
});

it("falls back to the authoritative status when persistence fails", async () => {
  const gate = Promise.withResolvers<void>();
  vi.spyOn(database, "setReadingStatus").mockImplementation(async () => {
    await gate.promise;
    throw new Error("write failed");
  });
  await mountCard();
  fireEvent.click(screen.getByRole("button", { name: "reading" }));
  await screen.findByRole("button", { name: "finished" });
  await act(async () => gate.resolve());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "reading" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(await database.getReadingStatus(book.id)).toBe("reading");
});

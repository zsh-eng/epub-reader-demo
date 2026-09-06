import { BookCard } from "@/features/library/BookCard";
import type { Book } from "@/lib/db";
import type { FileId } from "@/lib/files";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalInnerWidth = window.innerWidth;

vi.mock("@/hooks/use-reading-status", () => ({
  useSetReadingStatus: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const book: Book = {
  id: "book-1",
  sourceFileId: "xxh64:1111111111111111" as FileId,
  title: "Book One",
  author: "Author One",
  fileSize: 100,
  dateAdded: 1,
  metadata: {},
  manifest: [],
  spine: [],
  toc: [],
  cover: {
    fileId: "xxh64:2222222222222222" as FileId,
    blurHash: null,
  },
};

interface ObserverRecord {
  callback: IntersectionObserverCallback;
  target: Element | null;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalInnerWidth,
  });
});

describe("BookCard cover loading", () => {
  it("keeps observing the card when the responsive trigger updates", async () => {
    const observerRecords: ObserverRecord[] = [];

    class IntersectionObserverMock {
      readonly root = null;
      readonly rootMargin = "400px 0px";
      readonly thresholds = [0];
      private readonly record: ObserverRecord;

      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, target: null };
        observerRecords.push(this.record);
      }

      disconnect = () => {
        this.record.target = null;
      };
      observe = (target: Element) => {
        this.record.target = target;
      };
      takeRecords = () => [];
      unobserve = (target: Element) => {
        if (this.record.target === target) this.record.target = null;
      };
    }

    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    });

    const requestCover = vi.fn();
    render(
      createElement(
        MemoryRouter,
        null,
        createElement(BookCard, {
          book,
          status: null,
          onDelete: vi.fn(),
          onCoverRequest: requestCover,
        }),
      ),
    );

    // Responsive rendering can replace the card and disconnect its observer.
    // The current card must still have exactly one active observer.
    const activeObservers = () =>
      observerRecords.filter((record) => record.target !== null);
    await waitFor(() => {
      expect(activeObservers()).toHaveLength(1);
      expect(activeObservers()[0]!.target?.isConnected).toBe(true);
    });

    const activeObserver = activeObservers()[0]!;
    activeObserver.callback(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(requestCover).not.toHaveBeenCalled();

    activeObserver.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    expect(requestCover).toHaveBeenCalledOnce();
    expect(requestCover).toHaveBeenCalledWith(book);
    expect(activeObservers()).toHaveLength(0);
  });
});

import { BookCard } from "@/components/BookCard";
import type { Book } from "@/lib/db";
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
  coverContentHash: "cover-hash",
};

interface ObserverRecord {
  callback: IntersectionObserverCallback;
  target?: Element;
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
  it("observes the replacement card after the responsive trigger remounts", async () => {
    const observerRecords: ObserverRecord[] = [];

    class IntersectionObserverMock {
      readonly root = null;
      readonly rootMargin = "400px 0px";
      readonly thresholds = [0];
      private readonly record: ObserverRecord;

      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback };
        observerRecords.push(this.record);
      }

      disconnect = vi.fn();
      observe = (target: Element) => {
        this.record.target = target;
      };
      takeRecords = () => [];
      unobserve = vi.fn();
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

    await waitFor(() => expect(observerRecords.length).toBeGreaterThan(1));

    const activeObserver = observerRecords.at(-1)!;
    activeObserver.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    expect(activeObserver.target?.isConnected).toBe(true);
    expect(requestCover).toHaveBeenCalledOnce();
    expect(requestCover).toHaveBeenCalledWith(book);
  });
});

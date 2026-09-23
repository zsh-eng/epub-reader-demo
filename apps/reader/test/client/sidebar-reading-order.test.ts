import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSidebarReadingOrder } from "@/hooks/use-sidebar-reading-order";
import type { Book } from "@/lib/db";
import { parseFileId } from "@/lib/files/file-id";

const book = (id: string): Book => ({
  id,
  title: id,
  author: "Author",
  sourceFileId: parseFileId("xxh64:1111111111111111"),
  cover: null,
  fileSize: 100,
  dateAdded: 100,
  metadata: {},
  manifest: [],
  spine: [],
  toc: [],
});
const a = book("a");
const b = book("b");
const c = book("c");
afterEach(cleanup);

describe("sidebar reading order", () => {
  it("keeps live books in place until close and reopen", () => {
    const { result, rerender } = renderHook(
      ({ books, open }) => useSidebarReadingOrder(books, open),
      { initialProps: { books: [a, b], open: false } },
    );
    rerender({ books: [a, b], open: true });
    const updatedB = { ...b, title: "Updated title" };
    rerender({ books: [updatedB, a], open: true });
    expect(result.current).toEqual([a, updatedB]);
    rerender({ books: [a, updatedB], open: true });
    rerender({ books: [updatedB, a], open: true });
    expect(result.current.map((book) => book.id)).toEqual(["a", "b"]);
    rerender({ books: [updatedB, a], open: false });
    expect(result.current).toEqual([a, updatedB]);
    rerender({ books: [updatedB, a], open: true });
    expect(result.current).toEqual([updatedB, a]);
  });

  it("accepts data that arrives after opening and appends new destinations", () => {
    const { result, rerender } = renderHook(
      ({ books }) => useSidebarReadingOrder(books, true),
      { initialProps: { books: [] as Book[] } },
    );
    rerender({ books: [a, b] });
    expect(result.current).toEqual([a, b]);
    rerender({ books: [c, b, a] });
    expect(result.current).toEqual([a, b, c]);
    rerender({ books: [c, b] });
    expect(result.current).toEqual([b, c]);
  });
});

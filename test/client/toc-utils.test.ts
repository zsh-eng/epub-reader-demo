import type { Book } from "@/lib/db";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import { describe, expect, it } from "vitest";

function createBook(overrides?: Partial<Book>): Book {
  return {
    id: "book-1",
    fileHash: "hash",
    title: "Book",
    author: "Author",
    fileSize: 1,
    dateAdded: Date.now(),
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
    isDownloaded: 1,
    ...overrides,
  };
}

describe("getChapterTitleFromSpine", () => {
  it("returns TOC title when TOC entry matches the spine manifest href", () => {
    const book = createBook({
      manifest: [{ id: "c1", href: "OEBPS/C01.xhtml", mediaType: "text/html" }],
      spine: [{ idref: "c1" }],
      toc: [{ label: "Prologue", href: "OEBPS/C01.xhtml" }],
    });

    expect(getChapterTitleFromSpine(book, 0)).toBe("Prologue");
  });

  it("falls back to filename when TOC entry is missing", () => {
    const book = createBook({
      manifest: [
        {
          id: "synopsis",
          href: "Text/sinopsis.xhtml",
          mediaType: "text/html",
        },
      ],
      spine: [{ idref: "synopsis" }],
      toc: [],
    });

    expect(getChapterTitleFromSpine(book, 0)).toBe("Sinopsis");
  });

  it("normalizes fallback title from encoded filename", () => {
    const book = createBook({
      manifest: [
        {
          id: "title",
          href: "Text/the-way_of%20kings.xhtml#anchor",
          mediaType: "text/html",
        },
      ],
      spine: [{ idref: "title" }],
      toc: [],
    });

    expect(getChapterTitleFromSpine(book, 0)).toBe("The Way Of Kings");
  });

  it("falls back to chapter number when manifest lookup fails", () => {
    const book = createBook({
      manifest: [],
      spine: [{ idref: "missing-id" }],
      toc: [],
    });

    expect(getChapterTitleFromSpine(book, 0)).toBe("Chapter 1");
  });
});

import { resolveReaderEpubPreparation } from "@/components/Reader/hooks/reader-epub-preparation";
import type { Book } from "@/lib/db";
import { describe, expect, it } from "vitest";

const book = {
  id: "book-1",
  fileHash: "epub-hash-1",
  title: "Synced Metadata Only",
  author: "Test Author",
  fileSize: 1234,
  dateAdded: 1,
  metadata: {},
  manifest: [],
  spine: [],
  toc: [],
  isDownloaded: 0,
} satisfies Book;

describe("resolveReaderEpubPreparation", () => {
  it("keeps chapter loading disabled while the EPUB is being prepared", () => {
    const result = resolveReaderEpubPreparation({
      bookId: book.id,
      book,
      isBookLoading: false,
      epubProcessor: {
        isReady: false,
        error: null,
      },
    });

    expect(result).toEqual({
      chapterContentBookId: undefined,
      chapterContentBook: null,
      isBookLoading: true,
      epubProcessError: null,
    });
  });

  it("enables chapter loading after the EPUB is ready", () => {
    const result = resolveReaderEpubPreparation({
      bookId: book.id,
      book,
      isBookLoading: false,
      epubProcessor: {
        isReady: true,
        error: null,
      },
    });

    expect(result).toEqual({
      chapterContentBookId: book.id,
      chapterContentBook: book,
      isBookLoading: false,
      epubProcessError: null,
    });
  });

  it("surfaces EPUB preparation errors instead of keeping the reader loading", () => {
    const error = new Error("File not found on server");
    const result = resolveReaderEpubPreparation({
      bookId: book.id,
      book,
      isBookLoading: false,
      epubProcessor: {
        isReady: false,
        error,
      },
    });

    expect(result).toEqual({
      chapterContentBookId: undefined,
      chapterContentBook: null,
      isBookLoading: false,
      epubProcessError: error,
    });
  });
});

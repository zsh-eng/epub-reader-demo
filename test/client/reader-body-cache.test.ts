import {
  loadReaderBodyCache,
  READER_BODY_CACHE_SCHEMA_VERSION,
} from "@/components/Reader/data/reader-body-cache";
import {
  addBookWithFiles,
  db,
  deleteBook,
  getBookChapterSourceCache,
  putBookChapterSourceCache,
  type Book,
  type BookFile,
} from "@/lib/db";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it } from "vitest";

const chapterEntry = {
  index: 0,
  spineItemId: "chapter-1",
  href: "OPS/chapter-1.xhtml",
  title: "Chapter 1",
};

function createBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    fileHash: "hash-1",
    title: "Cached Book",
    author: "Author",
    fileSize: 123,
    dateAdded: Date.now(),
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
    isDownloaded: 1,
    ...overrides,
  };
}

function createChapterFile(bookId: string, body: string): BookFile {
  return {
    id: `${bookId}:chapter-1`,
    bookId,
    path: chapterEntry.href,
    mediaType: "application/xhtml+xml",
    content: new NodeBlob(
      [
        `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`,
      ],
      { type: "application/xhtml+xml" },
    ) as unknown as Blob,
  };
}

describe("reader body cache", () => {
  beforeEach(async () => {
    await db.bookChapterSourceCache.clear();
    await db.bookFiles.clear();
    await db.books.clear();
  });

  it("builds normalized body HTML and canonical text from chapter files", async () => {
    await db.bookFiles.add(
      createChapterFile(
        "book-1",
        '<p>Hello <strong>world</strong>.</p><img src="../images/cover.png" />',
      ),
    );

    const result = await loadReaderBodyCache({
      bookId: "book-1",
      fileHash: "hash-1",
      chapterEntries: [chapterEntry],
    });

    const chapterContent = result.chapterContentsByPath.get(chapterEntry.href);
    expect(chapterContent?.bodyHtml).toContain("Hello");
    expect(chapterContent?.bodyHtml).toContain("data-epub-deferred-src");
    expect(chapterContent?.bodyHtml).not.toContain(" src=");
    expect(chapterContent?.canonicalText.fullText).toContain("Hello world.");

    const cacheRow = await getBookChapterSourceCache("book-1");
    expect(cacheRow).toMatchObject({
      bookId: "book-1",
      fileHash: "hash-1",
      cacheVersion: READER_BODY_CACHE_SCHEMA_VERSION,
    });
    expect(cacheRow?.chaptersByPath[chapterEntry.href]?.bodyHtml).toContain(
      "Hello",
    );
  });

  it("uses the persisted cache instead of rereading chapter blobs", async () => {
    await db.bookFiles.add(createChapterFile("book-1", "<p>Original</p>"));

    await loadReaderBodyCache({
      bookId: "book-1",
      fileHash: "hash-1",
      chapterEntries: [chapterEntry],
    });
    await db.bookFiles.put(createChapterFile("book-1", "<p>Changed</p>"));

    const result = await loadReaderBodyCache({
      bookId: "book-1",
      fileHash: "hash-1",
      chapterEntries: [chapterEntry],
    });

    expect(
      result.chapterContentsByPath.get(chapterEntry.href)?.canonicalText
        .fullText,
    ).toContain("Original");
  });

  it("rebuilds when the file hash changes", async () => {
    await db.bookFiles.add(createChapterFile("book-1", "<p>First file</p>"));

    await loadReaderBodyCache({
      bookId: "book-1",
      fileHash: "hash-1",
      chapterEntries: [chapterEntry],
    });
    await db.bookFiles.put(createChapterFile("book-1", "<p>Second file</p>"));

    const result = await loadReaderBodyCache({
      bookId: "book-1",
      fileHash: "hash-2",
      chapterEntries: [chapterEntry],
    });

    expect(
      result.chapterContentsByPath.get(chapterEntry.href)?.canonicalText
        .fullText,
    ).toContain("Second file");
    expect((await getBookChapterSourceCache("book-1"))?.fileHash).toBe(
      "hash-2",
    );
  });

  it("removes the body cache when a book is deleted", async () => {
    const book = createBook({ id: "book-delete", fileHash: "hash-delete" });
    await addBookWithFiles(book, []);
    await putBookChapterSourceCache(
      book.id,
      book.fileHash,
      {
        [chapterEntry.href]: {
          bodyHtml: "<p>Cached</p>",
          canonicalText: {
            fullText: "Cached",
            blockStarts: new Map([["block-1", 0]]),
          },
        },
      },
      READER_BODY_CACHE_SCHEMA_VERSION,
    );

    await deleteBook(book.id);

    expect(await getBookChapterSourceCache(book.id)).toBeUndefined();
  });
});

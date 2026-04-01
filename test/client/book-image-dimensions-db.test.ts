import {
  addBookWithFiles,
  buildBookImageDimensionRowsFromBookFiles,
  db,
  deriveImageDimensionsFromBookFiles,
  deleteBook,
  getBookImageDimensionsMap,
  upsertBookImageDimensions,
  type Book,
  type BookFile,
} from "@/lib/db";
import { beforeEach, describe, expect, it } from "vitest";

function createPngBlob(width: number, height: number): Blob {
  const bytes = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52,
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
  ]);

  return new Blob([bytes], { type: "image/png" });
}

describe("book image dimensions db helpers", () => {
  beforeEach(async () => {
    await db.bookImageDimensions.clear();
    await db.bookFiles.clear();
  });

  it("upserts and returns dimensions as a path map", async () => {
    await upsertBookImageDimensions([
      {
        bookId: "book-1",
        path: "OEBPS/Images/cover.jpg",
        width: 1200,
        height: 1800,
      },
    ]);

    const map = await getBookImageDimensionsMap("book-1");
    expect(map.get("OEBPS/Images/cover.jpg")).toEqual({
      width: 1200,
      height: 1800,
    });
  });

  it("keeps a single row for repeated upserts with the same id", async () => {
    const entry = {
      bookId: "book-1",
      path: "OEBPS/Images/cover.jpg",
      width: 1200,
      height: 1800,
    };

    await upsertBookImageDimensions([entry]);
    await upsertBookImageDimensions([entry]);

    expect(await db.bookImageDimensions.count()).toBe(1);
  });

  it("persists dimensions for reprocessed book files via derive + upsert flow", async () => {
    const imageFile: BookFile = {
      id: "book-reprocess-file-1",
      bookId: "book-reprocess",
      path: "OEBPS/Images/reprocessed.png",
      mediaType: "image/png",
      content: createPngBlob(900, 600),
    };

    const derived = await deriveImageDimensionsFromBookFiles([imageFile]);
    await upsertBookImageDimensions(derived);

    const map = await getBookImageDimensionsMap("book-reprocess");
    expect(map.get("OEBPS/Images/reprocessed.png")).toEqual({
      width: 900,
      height: 600,
    });
  });

  it("stores dimensions when adding a new book with image files", async () => {
    const book: Book = {
      id: "book-add",
      fileHash: "hash-add",
      title: "Add Book",
      author: "Author",
      fileSize: 123,
      dateAdded: Date.now(),
      metadata: {},
      manifest: [],
      spine: [],
      toc: [],
      isDownloaded: 1,
    };

    const imageFile: BookFile = {
      id: "book-add-file-1",
      bookId: "book-add",
      path: "OEBPS/Images/cover.png",
      mediaType: "image/png",
      content: createPngBlob(512, 768),
    };

    await addBookWithFiles(book, [imageFile]);

    const map = await getBookImageDimensionsMap("book-add");
    expect(map.get("OEBPS/Images/cover.png")).toEqual({
      width: 512,
      height: 768,
    });
  });

  it("removes cached dimensions when a book is deleted", async () => {
    const book: Book = {
      id: "book-delete",
      fileHash: "hash-delete",
      title: "Delete Book",
      author: "Author",
      fileSize: 123,
      dateAdded: Date.now(),
      metadata: {},
      manifest: [],
      spine: [],
      toc: [],
      isDownloaded: 1,
    };

    const imageFile: BookFile = {
      id: "book-delete-file-1",
      bookId: "book-delete",
      path: "OEBPS/Images/cover.png",
      mediaType: "image/png",
      content: createPngBlob(700, 1000),
    };

    await addBookWithFiles(book, [imageFile]);
    expect(await db.bookImageDimensions.count()).toBe(1);

    await deleteBook("book-delete");

    const map = await getBookImageDimensionsMap("book-delete");
    expect(map.size).toBe(0);
  });
});

describe("book image dimensions backfill behavior", () => {
  beforeEach(async () => {
    await db.bookImageDimensions.clear();
    await db.bookFiles.clear();
  });

  it("builds backfill rows from existing image book files and is idempotent", async () => {
    const imageFile: BookFile = {
      id: "file-1",
      bookId: "book-2",
      path: "OEBPS/Images/illustration.png",
      mediaType: "image/png",
      content: createPngBlob(320, 200),
    };
    const chapterFile: BookFile = {
      id: "file-2",
      bookId: "book-2",
      path: "OEBPS/Text/chapter1.xhtml",
      mediaType: "application/xhtml+xml",
      content: new Blob(["<html></html>"], { type: "application/xhtml+xml" }),
    };

    await db.bookFiles.bulkAdd([imageFile, chapterFile]);

    const files = await db.bookFiles.toArray();
    const backfillRows = await buildBookImageDimensionRowsFromBookFiles(
      files,
      123456,
    );

    expect(backfillRows).toHaveLength(1);
    expect(backfillRows[0]).toMatchObject({
      id: "book-2:OEBPS/Images/illustration.png",
      width: 320,
      height: 200,
      updatedAt: 123456,
    });

    await db.bookImageDimensions.bulkPut(backfillRows);
    await db.bookImageDimensions.bulkPut(backfillRows);

    expect(await db.bookImageDimensions.count()).toBe(1);
  });
});

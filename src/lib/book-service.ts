import type { Book } from "@/lib/db";
import {
  addBookWithFiles,
  deleteBook,
  getAllBooks,
  getBookBySourceFileId,
} from "@/lib/db";
import { parseEPUB } from "@/lib/epub-parser";
import { files } from "@/lib/files";

export class DuplicateBookError extends Error {
  existingBook: Book;

  constructor(message: string, existingBook: Book) {
    super(message);
    this.name = "DuplicateBookError";
    this.existingBook = existingBook;
  }
}

/**
 * Add a book from an EPUB file
 * Throws DuplicateBookError if the source file already exists in the library.
 */
export async function addBookFromFile(file: File): Promise<Book> {
  // Validate file type
  if (!file.name.toLowerCase().endsWith(".epub")) {
    throw new Error("Only EPUB files are supported");
  }

  try {
    const sourceFileId = await files.put(file, {
      mediaType: "application/epub+zip",
    });
    const existingBook = await getBookBySourceFileId(sourceFileId);
    if (existingBook) {
      throw new DuplicateBookError(
        "A book with this file already exists in your library",
        existingBook,
      );
    }

    const {
      book,
      files: bookFiles,
      coverBlob,
    } = await parseEPUB(file, {
      sourceFileId,
    });

    if (coverBlob) {
      const coverFileId = await files.put(coverBlob);
      book.cover = { fileId: coverFileId, blurHash: null };
    }

    await addBookWithFiles(book, bookFiles);
    return book;
  } catch (error) {
    // Re-throw DuplicateBookError as-is
    if (error instanceof DuplicateBookError) {
      throw error;
    }

    console.error("Error adding book:", error);
    throw new Error(
      `Failed to add book: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Get all books from the library
 */
export async function getLibraryBooks(): Promise<Book[]> {
  return await getAllBooks();
}

/**
 * Delete a book from the library
 */
export async function removeBook(bookId: string): Promise<void> {
  await deleteBook(bookId);
}

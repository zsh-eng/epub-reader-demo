import { prepareBook, prepareNewBook } from "@/lib/book-preparation";
import type { Book } from "@/lib/db";
import { deleteBook, getAllBooks, getBookBySourceFileId } from "@/lib/db";
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
      const prepared = await prepareBook(existingBook, file);
      throw new DuplicateBookError(
        "A book with this file already exists in your library",
        prepared.book,
      );
    }

    const parsedEpub = await parseEPUB(file, {
      sourceFileId,
      fileName: file.name,
    });

    const prepared = await prepareNewBook(parsedEpub);
    return prepared.book;
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

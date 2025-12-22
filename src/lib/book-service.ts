import type { Book } from "@/lib/db";
import {
  addBook,
  db,
  deleteBook,
  getAllBooks,
  getBookByFileHash,
  saveEpubBlob,
  updateBookLastOpened,
} from "@/lib/db";
import { parseEPUB } from "@/lib/epub-parser";
import { hashFile } from "@/lib/file-hash";

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
 * Throws DuplicateBookError if a book with the same file hash already exists
 */
export async function addBookFromFile(file: File): Promise<Book> {
  // Validate file type
  if (!file.name.toLowerCase().endsWith(".epub")) {
    throw new Error("Only EPUB files are supported");
  }

  try {
    const fileHash = await hashFile(file);
    const existingBook = await getBookByFileHash(fileHash);
    if (existingBook) {
      throw new DuplicateBookError(
        "A book with this file already exists in your library",
        existingBook,
      );
    }

    const { book, files } = await parseEPUB(file, { fileHash });
    await addBook(book);
    await db.bookFiles.bulkAdd(files);

    // Save the original EPUB blob for future uploads
    // This will be deleted after successful sync
    await saveEpubBlob(fileHash, file);
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

/**
 * Open a book (updates last opened timestamp)
 */
export async function openBook(bookId: string): Promise<void> {
  await updateBookLastOpened(bookId);
}

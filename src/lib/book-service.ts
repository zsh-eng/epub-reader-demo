import { parseEPUB } from "@/lib/epub-parser";
import {
  addBook,
  addBookFile,
  getAllBooks,
  deleteBook,
  updateBookLastOpened,
} from "@/lib/db";
import type { Book } from "@/lib/db";

/**
 * Add a book from an EPUB file
 */
export async function addBookFromFile(file: File): Promise<Book> {
  // Validate file type
  if (!file.name.toLowerCase().endsWith(".epub")) {
    throw new Error("Only EPUB files are supported");
  }

  try {
    // Parse the EPUB file
    const { book, files } = await parseEPUB(file);

    // Save book to database
    await addBook(book);

    // Save all book files to database
    for (const bookFile of files) {
      await addBookFile(bookFile);
    }

    return book;
  } catch (error) {
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

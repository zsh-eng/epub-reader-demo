import type { Book } from "@/lib/db";
import {
  addBook,
  db,
  deleteBook,
  getAllBooks,
  getBookByFileHash,
  updateBookLastOpened,
} from "@/lib/db";
import { parseEPUB } from "@/lib/epub-parser";
import { hashFile } from "@/lib/file-hash";
import { createFileId } from "@/lib/files/types";
import type { StoredFile } from "@/lib/files/types";

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

    const { book, files, coverBlob, epubBlob } = await parseEPUB(file, {
      fileHash,
    });

    // Store the epub file in the files table
    const epubFile: StoredFile = {
      id: createFileId("epub", fileHash),
      contentHash: fileHash,
      fileType: "epub",
      blob: epubBlob,
      mediaType: "application/epub+zip",
      size: file.size,
      storedAt: Date.now(),
    };

    // Store the cover file in the files table (if available)
    const filesToStore: StoredFile[] = [epubFile];
    if (coverBlob && book.coverContentHash) {
      const coverFile: StoredFile = {
        id: createFileId("cover", book.coverContentHash),
        contentHash: book.coverContentHash,
        fileType: "cover",
        blob: coverBlob,
        mediaType: coverBlob.type || "image/jpeg",
        size: coverBlob.size,
        storedAt: Date.now(),
      };
      filesToStore.push(coverFile);
    }

    // Add book and files to database
    await addBook(book);
    await db.bookFiles.bulkAdd(files);
    await db.files.bulkAdd(filesToStore);

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

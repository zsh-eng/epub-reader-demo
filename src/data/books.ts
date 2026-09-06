/** Book metadata and deletion of all rows owned by a book. */
import type { BookCoverRef } from "@/lib/book-file-references";
import type { FileId } from "@/lib/files/types";
import { db, isNotDeleted } from "./database";

export type { BookCoverRef };

export interface Book {
  id: string;
  sourceFileId: FileId;
  title: string;
  author: string;
  fileSize: number;
  dateAdded: number;
  metadata: Record<string, unknown>;
  manifest: ManifestItem[];
  spine: SpineItem[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toc: any[];
  cover: BookCoverRef | null;
}

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

export interface SpineItem {
  idref: string; // References ManifestItem.id
  linear?: boolean;
  properties?: string;
}

export interface TOCItem {
  label: string;
  href: string;
  children?: TOCItem[];
}

export async function addBook(book: Book): Promise<string> {
  return db.books.add({ ...book, isDeleted: false });
}

export async function getBook(id: string): Promise<Book | undefined> {
  const book = await db.books.get(id);
  return book && isNotDeleted(book) ? book : undefined;
}

export async function getAllBooks(): Promise<Book[]> {
  return db.books.filter(isNotDeleted).toArray();
}

export async function deleteBook(id: string): Promise<void> {
  const book = await db.books.get(id);
  if (!book || book.isDeleted) return;

  await db.transaction(
    "rw",
    [
      db.books,
      db.readingCheckpoints,
      db.readingSessions,
      db.highlights,
      db.readingState,
      db.notes,
      db.noteDrafts,
      db.bookFiles,
      db.bookMaterializations,
      db.bookTextCache,
      db.bookChapterSourceCache,
    ],
    async () => {
      await db.books.delete(id);
      await db.readingCheckpoints.where("bookId").equals(id).delete();
      await db.readingSessions.where("bookId").equals(id).delete();
      await db.highlights.where("bookId").equals(id).delete();
      await db.readingState.where("bookId").equals(id).delete();
      await db.noteDrafts.where("bookId").equals(id).delete();
      await db.notes.where("bookId").equals(id).delete();
      await db.bookFiles.where("bookId").equals(id).delete();
      await db.bookMaterializations.delete(id);
      await db.bookTextCache.delete(id);
      await db.bookChapterSourceCache.delete(id);
    },
  );
}

export async function getBookBySourceFileId(
  sourceFileId: FileId,
): Promise<Book | undefined> {
  const book = await db.books
    .where("sourceFileId")
    .equals(sourceFileId)
    .first();
  return book && isNotDeleted(book) ? book : undefined;
}

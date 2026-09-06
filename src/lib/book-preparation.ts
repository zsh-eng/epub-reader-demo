import { BookCoverDecodeError, createBookCover } from "@/lib/book-cover";
import {
  getBookMaterialization,
  replaceBookMaterialization,
  type Book,
  type BookFile,
} from "@/lib/db";
import { parseEPUB, type ParsedEPUB } from "@/lib/epub-parser";
import { files } from "@/lib/files";

export const BOOK_MATERIALIZATION_RECIPE_VERSION = 1;

export interface BookPreparationResult {
  book: Book;
  bookChanged: boolean;
  materialized: boolean;
}

const pendingPreparations = new Map<string, Promise<BookPreparationResult>>();

/**
 * Ensure one synchronized Book has all durable local artifacts required to
 * open. The same operation handles an established client and a new download.
 */
export async function prepareBook(
  book: Book,
  sourceBlob?: Blob,
): Promise<BookPreparationResult> {
  const key = `${book.id}:${book.sourceFileId}`;
  const pending = pendingPreparations.get(key);
  if (pending) return pending;

  const preparation = prepareBookOnce(book, sourceBlob).finally(() => {
    pendingPreparations.delete(key);
  });
  pendingPreparations.set(key, preparation);
  return preparation;
}

/** Persist a newly parsed Book through the same artifact commit path. */
export async function prepareNewBook(
  parsedEpub: ParsedEPUB,
): Promise<BookPreparationResult> {
  return commitMaterialization(
    parsedEpub.book,
    parsedEpub.files,
    parsedEpub.coverBlob,
    true,
  );
}

async function prepareBookOnce(
  book: Book,
  sourceBlob?: Blob,
): Promise<BookPreparationResult> {
  const marker = await getBookMaterialization(book.id);
  const coverIsComplete = book.cover === null || book.cover.blurHash !== null;
  if (
    marker?.sourceFileId === book.sourceFileId &&
    marker.recipeVersion === BOOK_MATERIALIZATION_RECIPE_VERSION &&
    coverIsComplete
  ) {
    return { book, bookChanged: false, materialized: false };
  }

  // A complete materialization above needs no original bytes. Otherwise avoid
  // starting a remote transfer when the browser already knows it is offline.
  if (
    !sourceBlob &&
    typeof navigator !== "undefined" &&
    !navigator.onLine &&
    !(await files.hasLocal(book.sourceFileId))
  ) {
    throw new Error(
      "Connect to the internet to download this book, then try again.",
    );
  }

  const epubBlob = sourceBlob ?? (await files.get(book.sourceFileId));
  const parsedEpub = await parseEPUB(epubBlob, {
    sourceFileId: book.sourceFileId,
    bookId: book.id,
  });

  return commitMaterialization(
    book,
    parsedEpub.files,
    parsedEpub.coverBlob,
    false,
  );
}

async function commitMaterialization(
  book: Book,
  bookFiles: BookFile[],
  coverBlob: Blob | undefined,
  isNewBook: boolean,
): Promise<BookPreparationResult> {
  const cover = await prepareCover(book, coverBlob);
  const bookChanged = isNewBook || !coversEqual(book.cover, cover);
  const preparedBook = bookChanged ? { ...book, cover } : book;

  await replaceBookMaterialization({
    book: preparedBook,
    bookFiles,
    recipeVersion: BOOK_MATERIALIZATION_RECIPE_VERSION,
    writeBook: bookChanged,
  });

  return {
    book: preparedBook,
    bookChanged,
    materialized: true,
  };
}

async function prepareCover(
  book: Book,
  sourceCover: Blob | undefined,
): Promise<Book["cover"]> {
  if (book.cover && book.cover.blurHash !== null) return book.cover;
  if (!sourceCover) return null;

  let createdCover: Awaited<ReturnType<typeof createBookCover>>;
  try {
    createdCover = await createBookCover(sourceCover);
  } catch (error) {
    if (!(error instanceof BookCoverDecodeError)) throw error;
    console.warn(`Ignoring invalid cover for book ${book.id}:`, error);
    return null;
  }
  const fileId = await files.put(createdCover.blob, {
    mediaType: "image/webp",
  });
  return { fileId, blurHash: createdCover.blurHash };
}

function coversEqual(left: Book["cover"], right: Book["cover"]): boolean {
  if (left === null || right === null) return left === right;
  return left.fileId === right.fileId && left.blurHash === right.blurHash;
}

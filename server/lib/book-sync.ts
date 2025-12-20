import { book } from "@server/db/schema";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

// Zod schemas for validation
export const syncBooksQuerySchema = z.object({
  since: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
});

export const syncBooksBodySchema = z.object({
  books: z.array(
    z.object({
      fileHash: z.string().min(1),
      title: z.string().min(1),
      author: z.string().min(1),
      fileSize: z.number().int().positive(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      localCreatedAt: z.number().optional(),
    }),
  ),
});

export const fileHashParamSchema = z.object({
  fileHash: z.string().min(1),
});

export type SyncBooksQuery = z.infer<typeof syncBooksQuerySchema>;
export type SyncBooksBody = z.infer<typeof syncBooksBodySchema>;

export type BookSyncResult = {
  fileHash: string;
  status: "created" | "updated" | "exists";
  serverId: string;
  epubUploadUrl: string | null;
  coverUploadUrl: string | null;
};

/**
 * Get books for a user updated after a given timestamp.
 * Includes soft-deleted books so clients can remove them.
 */
export async function getBooks(
  database: D1Database,
  userId: string,
  sinceTimestamp: number,
) {
  const db = drizzle(database);

  const books = await db
    .select()
    .from(book)
    .where(
      and(
        eq(book.userId, userId),
        gt(book.updatedAt, new Date(sinceTimestamp)),
      ),
    )
    .orderBy(book.updatedAt);

  const serverTimestamp = Date.now();

  return {
    books: books.map((b) => ({
      id: b.id,
      fileHash: b.fileHash,
      title: b.title,
      author: b.author,
      fileSize: b.fileSize,
      metadata: b.metadata,
      epubR2Key: b.epubR2Key,
      coverR2Key: b.coverR2Key,
      coverUrl: b.coverR2Key ? `/api/files/${userId}/${b.coverR2Key}` : null,
      epubUrl: b.epubR2Key ? `/api/files/${userId}/${b.epubR2Key}` : null,
      createdAt: b.createdAt?.getTime() ?? null,
      updatedAt: b.updatedAt?.getTime() ?? null,
      deletedAt: b.deletedAt?.getTime() ?? null,
    })),
    serverTimestamp,
  };
}

/**
 * Sync books from client to server using batched queries.
 * Uses a single SELECT to get existing books, then batches all INSERT/UPDATE operations.
 *
 * TODO: Combine the SELECT and the INSERT/UPDATE operations to avoid concurrency bugs?
 */
export async function syncBooks(
  database: D1Database,
  userId: string,
  booksData: SyncBooksBody["books"],
): Promise<{ results: BookSyncResult[] }> {
  const db = drizzle(database);

  if (booksData.length === 0) {
    return { results: [] };
  }

  // 1. Batch SELECT: Get all existing books for the given fileHashes in a single query
  const fileHashes = booksData.map((b) => b.fileHash);
  const existingBooks = await db
    .select()
    .from(book)
    .where(and(eq(book.userId, userId), inArray(book.fileHash, fileHashes)));

  // 2. Build a map for O(1) lookup
  const existingMap = new Map(existingBooks.map((b) => [b.fileHash, b]));

  // 3. Process each book and build batch operations
  const results: BookSyncResult[] = [];
  const batchOps: BatchItem<"sqlite">[] = [];

  for (const bookData of booksData) {
    const existing = existingMap.get(bookData.fileHash);

    if (existing) {
      if (existing.deletedAt) {
        // Restore: UPDATE to clear deletedAt and update metadata
        batchOps.push(
          db
            .update(book)
            .set({
              title: bookData.title,
              author: bookData.author,
              fileSize: bookData.fileSize,
              metadata: bookData.metadata,
              deletedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(book.id, existing.id)),
        );
        results.push({
          fileHash: bookData.fileHash,
          status: "updated",
          serverId: existing.id,
          // TODO: Generate presigned upload URLs when R2 is integrated
          epubUploadUrl: existing.epubR2Key ? null : null,
          coverUploadUrl: existing.coverR2Key ? null : null,
        });
      } else {
        // Book exists and is not deleted - no operation needed
        results.push({
          fileHash: bookData.fileHash,
          status: "exists",
          serverId: existing.id,
          epubUploadUrl: existing.epubR2Key ? null : null,
          coverUploadUrl: existing.coverR2Key ? null : null,
        });
      }
    } else {
      // Create new book with INSERT ON CONFLICT DO NOTHING for extra safety
      const newId = crypto.randomUUID();
      batchOps.push(
        db
          .insert(book)
          .values({
            id: newId,
            userId: userId,
            fileHash: bookData.fileHash,
            title: bookData.title,
            author: bookData.author,
            fileSize: bookData.fileSize,
            metadata: bookData.metadata,
          })
          .onConflictDoNothing({
            target: [book.userId, book.fileHash],
          }),
      );
      results.push({
        fileHash: bookData.fileHash,
        status: "created",
        serverId: newId,
        // TODO: Generate presigned upload URLs when R2 is integrated
        epubUploadUrl: null,
        coverUploadUrl: null,
      });
    }
  }

  // 4. Execute batch - all operations in a single transaction
  if (batchOps.length > 0) {
    await db.batch(batchOps as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  return { results };
}

/**
 * Upload EPUB and cover files to R2 storage.
 * Updates the book record with the R2 keys.
 */
export async function uploadBookFiles(
  database: D1Database,
  r2Storage: R2Bucket,
  userId: string,
  fileHash: string,
  epubFile: File | null,
  coverFile: File | null,
): Promise<
  | {
      success: true;
      fileHash: string;
      epubR2Key: string | null;
      coverR2Key: string | null;
    }
  | { error: string; status: number }
> {
  const db = drizzle(database);

  // Find the book
  const existingBook = await db
    .select()
    .from(book)
    .where(and(eq(book.userId, userId), eq(book.fileHash, fileHash)))
    .get();

  if (!existingBook) {
    return { error: "Book not found", status: 404 };
  }

  let epubR2Key: string | null = null;
  let coverR2Key: string | null = null;

  // Upload EPUB file to R2 if provided
  if (epubFile) {
    epubR2Key = `epubs/${userId}/${fileHash}.epub`;
    const epubArrayBuffer = await epubFile.arrayBuffer();
    await r2Storage.put(epubR2Key, epubArrayBuffer, {
      httpMetadata: {
        contentType: "application/epub+zip",
      },
    });
  }

  // Upload cover file to R2 if provided
  if (coverFile) {
    // Determine file extension from the file name or type
    const ext = coverFile.name.split(".").pop()?.toLowerCase() || "jpg";
    coverR2Key = `covers/${userId}/${fileHash}.${ext}`;
    const coverArrayBuffer = await coverFile.arrayBuffer();
    await r2Storage.put(coverR2Key, coverArrayBuffer, {
      httpMetadata: {
        contentType: coverFile.type || "image/jpeg",
      },
    });
  }

  // Update the book record with R2 keys
  const updateData: {
    epubR2Key?: string;
    coverR2Key?: string;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };

  if (epubR2Key) {
    updateData.epubR2Key = epubR2Key;
  }
  if (coverR2Key) {
    updateData.coverR2Key = coverR2Key;
  }

  await db.update(book).set(updateData).where(eq(book.id, existingBook.id));

  return {
    success: true,
    fileHash,
    epubR2Key,
    coverR2Key,
  };
}

/**
 * Soft delete a book.
 */
export async function deleteBook(
  database: D1Database,
  userId: string,
  fileHash: string,
): Promise<
  | { success: true; fileHash: string; deletedAt: number }
  | { error: string; status: number }
> {
  const db = drizzle(database);

  // Find the book (only non-deleted)
  const existingBook = await db
    .select()
    .from(book)
    .where(
      and(
        eq(book.userId, userId),
        eq(book.fileHash, fileHash),
        isNull(book.deletedAt),
      ),
    )
    .get();

  if (!existingBook) {
    return { error: "Book not found", status: 404 };
  }

  const now = new Date();

  // Soft delete the book
  await db
    .update(book)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(book.id, existingBook.id));

  return {
    success: true,
    fileHash,
    deletedAt: now.getTime(),
  };
}

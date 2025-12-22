/**
 * File Lookup Service
 *
 * Resolves content hashes to R2 storage keys.
 * This service maps the content-addressed file IDs used by the client
 * to the actual R2 object keys.
 */

import { book } from "@server/db/schema";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

/**
 * Supported file types
 */
export type FileType = "epub" | "cover";

/**
 * Validation schema for file type
 */
export const fileTypeSchema = z.enum(["epub", "cover"]);

/**
 * Result of a file lookup
 */
export interface FileLookupResult {
  r2Key: string;
  contentType: string;
}

/**
 * Look up the R2 key for a file based on its content hash and type.
 *
 * For EPUBs: Uses the book's fileHash to find epubR2Key
 * For Covers: Uses the book's fileHash to find coverR2Key
 *
 * @param database - D1 database instance
 * @param userId - User ID from authentication
 * @param fileType - Type of file ('epub' or 'cover')
 * @param contentHash - The content hash (book's fileHash)
 * @returns The R2 key and content type, or null if not found
 */
export async function lookupFileR2Key(
  database: D1Database,
  userId: string,
  fileType: FileType,
  contentHash: string,
): Promise<FileLookupResult | null> {
  const db = drizzle(database);

  // Find the book by fileHash for this user
  const bookRecord = await db
    .select({
      epubR2Key: book.epubR2Key,
      coverR2Key: book.coverR2Key,
    })
    .from(book)
    .where(and(eq(book.userId, userId), eq(book.fileHash, contentHash)))
    .get();

  if (!bookRecord) {
    return null;
  }

  if (fileType === "epub") {
    if (!bookRecord.epubR2Key) {
      return null;
    }
    return {
      r2Key: bookRecord.epubR2Key,
      contentType: "application/epub+zip",
    };
  }

  if (fileType === "cover") {
    if (!bookRecord.coverR2Key) {
      return null;
    }
    // Determine content type from R2 key extension
    const contentType = getContentTypeFromKey(bookRecord.coverR2Key);
    return {
      r2Key: bookRecord.coverR2Key,
      contentType,
    };
  }

  return null;
}

/**
 * Determine content type from R2 key/file extension
 */
function getContentTypeFromKey(key: string): string {
  const lowerKey = key.toLowerCase();

  if (lowerKey.endsWith(".epub")) {
    return "application/epub+zip";
  }
  if (lowerKey.endsWith(".jpg") || lowerKey.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerKey.endsWith(".png")) {
    return "image/png";
  }
  if (lowerKey.endsWith(".webp")) {
    return "image/webp";
  }
  if (lowerKey.endsWith(".gif")) {
    return "image/gif";
  }

  return "application/octet-stream";
}

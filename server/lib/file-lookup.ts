/**
 * File Lookup Service
 *
 * Resolves content hashes to R2 storage keys using the generic file storage table.
 * This service maps the content-addressed file IDs used by the client
 * to the actual R2 object keys.
 */

import { fileStorage } from "@server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

/**
 * Validation schema for file type
 */
export const fileTypeSchema = z.string().min(1);

/**
 * Result of a file lookup
 */
export interface FileLookupResult {
  r2Key: string;
  mimeType: string;
}

/**
 * Look up the R2 key for a file based on its content hash and type.
 *
 * @param database - D1 database instance
 * @param userId - User ID from authentication
 * @param fileType - Type of file (e.g., 'epub', 'cover', 'pdf')
 * @param contentHash - The content hash (xxhash64)
 * @returns The R2 key and MIME type, or null if not found
 */
export async function lookupFileR2Key(
  database: D1Database,
  userId: string,
  fileType: string,
  contentHash: string,
): Promise<FileLookupResult | null> {
  const db = drizzle(database);

  // Find the file by contentHash, fileType, and userId
  const fileRecord = await db
    .select({
      r2Key: fileStorage.r2Key,
      mimeType: fileStorage.mimeType,
    })
    .from(fileStorage)
    .where(
      and(
        eq(fileStorage.userId, userId),
        eq(fileStorage.contentHash, contentHash),
        eq(fileStorage.fileType, fileType),
        isNull(fileStorage.deletedAt),
      ),
    )
    .get();

  if (!fileRecord) {
    return null;
  }

  return {
    r2Key: fileRecord.r2Key,
    mimeType: fileRecord.mimeType,
  };
}

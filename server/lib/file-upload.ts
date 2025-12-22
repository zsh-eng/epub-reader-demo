/**
 * File Upload Service
 *
 * Handles file uploads to R2 storage with content hashing and database tracking.
 */

import { fileStorage } from "@server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import xxhash from "xxhash-wasm";

/**
 * Result of a file upload operation
 */
export interface FileUploadResult {
  contentHash: string;
  r2Key: string;
  fileSize: number;
  mimeType: string;
  fileName: string;
  alreadyExists: boolean;
}

let hasherInstance: Awaited<ReturnType<typeof xxhash>> | null = null;

/**
 * Initialize the xxhash WASM instance
 * This is cached so subsequent calls are instant
 */
async function getHasher() {
  if (!hasherInstance) {
    hasherInstance = await xxhash();
  }
  return hasherInstance;
}

/**
 * Compute xxhash64 for file content
 */
async function computeContentHash(content: ArrayBuffer): Promise<string> {
  const hasher = await getHasher();
  const uint8Array = new Uint8Array(content);
  const hash = hasher.h64Raw(uint8Array);
  return hash.toString(16).padStart(16, "0");
}

/**
 * Upload a file to R2 and track it in the database.
 * Uses content-addressable storage with deduplication.
 *
 * @param database - D1 database instance
 * @param r2Bucket - R2 bucket instance
 * @param userId - User ID from authentication
 * @param file - The uploaded file
 * @param fileType - Type of file (e.g., 'epub', 'cover', 'pdf')
 * @returns Upload result with content hash and storage details
 */
export async function uploadFile(
  database: D1Database,
  r2Bucket: R2Bucket,
  userId: string,
  file: File,
  fileType: string,
): Promise<FileUploadResult> {
  const db = drizzle(database);

  // Read file content
  const arrayBuffer = await file.arrayBuffer();
  const contentHash = await computeContentHash(arrayBuffer);

  // Check if this user already has this file
  const existingFile = await db
    .select()
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

  if (existingFile) {
    // File already exists for this user, return existing metadata
    return {
      contentHash,
      r2Key: existingFile.r2Key,
      fileSize: existingFile.fileSize,
      mimeType: existingFile.mimeType,
      fileName: existingFile.fileName || file.name,
      alreadyExists: true,
    };
  }

  // Generate R2 key based on content hash and file type
  const fileExtension = file.name.split(".").pop() || "bin";
  const r2Key = `uploads/${userId}/${fileType}/${contentHash}.${fileExtension}`;

  // Upload to R2 (put is idempotent for same content)
  await r2Bucket.put(r2Key, arrayBuffer, {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
    },
  });

  // Store metadata in database
  const fileId = crypto.randomUUID();
  await db.insert(fileStorage).values({
    id: fileId,
    userId,
    contentHash,
    fileType,
    r2Key,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    metadata: {},
  });

  return {
    contentHash,
    r2Key,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    fileName: file.name,
    alreadyExists: false,
  };
}

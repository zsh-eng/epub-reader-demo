/**
 * Server operations for opaque, user-owned files.
 *
 * The service validates content-derived IDs and owns the D1/R2 consistency
 * boundary. It does not know why application code uses a file.
 */

import { fileStorage } from "@server/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import xxhash from "xxhash-wasm";
import { z } from "zod";

const FILE_ID_PREFIX = "xxh64:";
const DEFAULT_MEDIA_TYPE = "application/octet-stream";

export const fileIdSchema = z.string().regex(/^xxh64:[0-9a-f]{16}$/);

export type FileId = z.infer<typeof fileIdSchema>;

export interface StoredRemoteFile {
  id: FileId;
  r2Key: string;
  fileSize: number;
  mediaType: string;
  createdAt: Date;
}

export interface PutRemoteFileResult extends StoredRemoteFile {
  alreadyExists: boolean;
}

let hasherInstance: Awaited<ReturnType<typeof xxhash>> | null = null;

async function getHasher() {
  if (!hasherInstance) {
    hasherInstance = await xxhash();
  }

  return hasherInstance;
}

export async function computeFileId(content: ArrayBuffer): Promise<FileId> {
  const hasher = await getHasher();
  const hash = hasher.h64Raw(new Uint8Array(content));
  return `${FILE_ID_PREFIX}${hash.toString(16).padStart(16, "0")}`;
}

export function createR2Key(userId: string, fileId: FileId): string {
  return `files/${userId}/${fileId}`;
}

/**
 * Put bytes before publishing their catalog row. The deterministic R2 key makes
 * retries safe and lets a repeated PUT repair a missing object.
 */
export async function putRemoteFile(
  database: D1Database,
  r2Bucket: R2Bucket,
  userId: string,
  requestedFileId: FileId,
  content: ArrayBuffer,
  mediaType: string,
): Promise<PutRemoteFileResult | null> {
  const computedFileId = await computeFileId(content);
  if (computedFileId !== requestedFileId) {
    return null;
  }

  const db = drizzle(database);
  const existingFile = await db
    .select()
    .from(fileStorage)
    .where(
      and(eq(fileStorage.userId, userId), eq(fileStorage.id, requestedFileId)),
    )
    .get();

  const r2Key = createR2Key(userId, requestedFileId);
  const resolvedMediaType = mediaType || DEFAULT_MEDIA_TYPE;

  await r2Bucket.put(r2Key, content, {
    httpMetadata: { contentType: resolvedMediaType },
  });

  await db
    .insert(fileStorage)
    .values({
      id: requestedFileId,
      userId,
      r2Key,
      fileSize: content.byteLength,
      mediaType: resolvedMediaType,
    })
    .onConflictDoUpdate({
      target: [fileStorage.userId, fileStorage.id],
      set: {
        r2Key,
        fileSize: content.byteLength,
        mediaType: resolvedMediaType,
        deletedAt: null,
      },
    });

  const storedFile = await getRemoteFile(database, userId, requestedFileId);
  if (!storedFile) {
    throw new Error("File catalog row was not available after upload");
  }

  return {
    ...storedFile,
    alreadyExists: existingFile?.deletedAt === null,
  };
}

export async function getRemoteFile(
  database: D1Database,
  userId: string,
  fileId: FileId,
): Promise<StoredRemoteFile | null> {
  const db = drizzle(database);
  const storedFile = await db
    .select({
      id: fileStorage.id,
      r2Key: fileStorage.r2Key,
      fileSize: fileStorage.fileSize,
      mediaType: fileStorage.mediaType,
      createdAt: fileStorage.createdAt,
    })
    .from(fileStorage)
    .where(
      and(
        eq(fileStorage.userId, userId),
        eq(fileStorage.id, fileId),
        isNull(fileStorage.deletedAt),
      ),
    )
    .get();

  return storedFile ? { ...storedFile, id: fileId } : null;
}

export async function listRemoteFiles(
  database: D1Database,
  userId: string,
): Promise<StoredRemoteFile[]> {
  const db = drizzle(database);
  const files = await db
    .select({
      id: fileStorage.id,
      r2Key: fileStorage.r2Key,
      fileSize: fileStorage.fileSize,
      mediaType: fileStorage.mediaType,
      createdAt: fileStorage.createdAt,
    })
    .from(fileStorage)
    .where(and(eq(fileStorage.userId, userId), isNull(fileStorage.deletedAt)))
    .orderBy(desc(fileStorage.createdAt), desc(fileStorage.id))
    .all();

  return files.map((file) => ({ ...file, id: file.id as FileId }));
}

/**
 * Delete the R2 object before hiding its catalog row. A failed catalog update
 * can then be retried because the active row still contains the R2 key.
 */
export async function deleteRemoteFile(
  database: D1Database,
  r2Bucket: R2Bucket,
  userId: string,
  fileId: FileId,
): Promise<boolean> {
  const storedFile = await getRemoteFile(database, userId, fileId);
  if (!storedFile) {
    return false;
  }

  await r2Bucket.delete(storedFile.r2Key);

  const db = drizzle(database);
  await db
    .update(fileStorage)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(fileStorage.userId, userId),
        eq(fileStorage.id, fileId),
        isNull(fileStorage.deletedAt),
      ),
    );

  return true;
}

import * as schema from "@server/db/schema";
import { and, eq, gt, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

/**
 * Resolve a client device ID (from X-Device-ID header) to the database device ID.
 * Returns null if the device is not found.
 * TODO: not needed - we can just update the middleware to include the uuid
 */
export async function resolveDeviceId(
  database: D1Database,
  userId: string,
  clientDeviceId: string,
): Promise<string | null> {
  const db = drizzle(database, { schema });

  const device = await db
    .select({ id: schema.userDevice.id })
    .from(schema.userDevice)
    .where(
      and(
        eq(schema.userDevice.userId, userId),
        eq(schema.userDevice.clientId, clientDeviceId),
      ),
    )
    .get();

  return device?.id ?? null;
}

// Zod schemas for validation
export const syncProgressQuerySchema = z.object({
  since: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
  fileHash: z.string().optional(),
});

export const progressLogEntrySchema = z.object({
  id: z.uuid(),
  fileHash: z.string().min(1),
  spineIndex: z.number().int().min(0),
  scrollProgress: z.number().min(0).max(1),
  clientSeq: z.number().int().min(0),
  clientTimestamp: z.number().int().positive(),
});

export const syncProgressBodySchema = z.object({
  entries: z.array(progressLogEntrySchema),
});

export type SyncProgressQuery = z.infer<typeof syncProgressQuerySchema>;
export type SyncProgressBody = z.infer<typeof syncProgressBodySchema>;
export type ProgressLogEntry = z.infer<typeof progressLogEntrySchema>;

export type ProgressLogResult = {
  id: string;
  serverSeq: number;
  status: "created" | "duplicate";
};

export type ServerProgressEntry = {
  id: string;
  fileHash: string;
  spineIndex: number;
  scrollProgress: number;
  clientSeq: number;
  clientTimestamp: number;
  serverSeq: number;
  serverTimestamp: number;
  deviceId: string;
};

/**
 * Get progress log entries for a user updated after a given server sequence.
 * Optionally filtered by fileHash for per-book sync.
 */
export async function getProgressLogs(
  database: D1Database,
  userId: string,
  sinceServerSeq: number,
  fileHash?: string,
): Promise<{ entries: ServerProgressEntry[]; serverTimestamp: number }> {
  const db = drizzle(database, { schema });

  // Build query conditions
  const conditions = [
    eq(schema.readingProgressLog.userId, userId),
    gt(schema.readingProgressLog.serverSeq, sinceServerSeq),
  ];

  if (fileHash) {
    conditions.push(eq(schema.readingProgressLog.fileHash, fileHash));
  }

  const entries = await db
    .select({
      id: schema.readingProgressLog.id,
      fileHash: schema.readingProgressLog.fileHash,
      spineIndex: schema.readingProgressLog.spineIndex,
      scrollProgress: schema.readingProgressLog.scrollProgress,
      clientSeq: schema.readingProgressLog.clientSeq,
      clientTimestamp: schema.readingProgressLog.clientTimestamp,
      serverSeq: schema.readingProgressLog.serverSeq,
      serverTimestamp: schema.readingProgressLog.serverTimestamp,
      deviceId: schema.readingProgressLog.deviceId,
    })
    .from(schema.readingProgressLog)
    .where(and(...conditions))
    .orderBy(schema.readingProgressLog.serverSeq)
    .limit(1000); // Paginate to avoid huge responses

  const serverTimestamp = Date.now();

  return {
    entries: entries.map((e) => ({
      ...e,
      clientTimestamp:
        e.clientTimestamp instanceof Date
          ? e.clientTimestamp.getTime()
          : (e.clientTimestamp as number),
      serverTimestamp:
        e.serverTimestamp instanceof Date
          ? e.serverTimestamp.getTime()
          : (e.serverTimestamp as number),
    })),
    serverTimestamp,
  };
}

/**
 * Get the current reading position for a book (latest entry by serverSeq).
 */
export async function getCurrentProgress(
  database: D1Database,
  userId: string,
  fileHash: string,
): Promise<ServerProgressEntry | null> {
  const db = drizzle(database, { schema });

  const entry = await db
    .select({
      id: schema.readingProgressLog.id,
      fileHash: schema.readingProgressLog.fileHash,
      spineIndex: schema.readingProgressLog.spineIndex,
      scrollProgress: schema.readingProgressLog.scrollProgress,
      clientSeq: schema.readingProgressLog.clientSeq,
      clientTimestamp: schema.readingProgressLog.clientTimestamp,
      serverSeq: schema.readingProgressLog.serverSeq,
      serverTimestamp: schema.readingProgressLog.serverTimestamp,
      deviceId: schema.readingProgressLog.deviceId,
    })
    .from(schema.readingProgressLog)
    .where(
      and(
        eq(schema.readingProgressLog.userId, userId),
        eq(schema.readingProgressLog.fileHash, fileHash),
      ),
    )
    .orderBy(schema.readingProgressLog.serverSeq)
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!entry) return null;

  return {
    ...entry,
    clientTimestamp:
      entry.clientTimestamp instanceof Date
        ? entry.clientTimestamp.getTime()
        : (entry.clientTimestamp as number),
    serverTimestamp:
      entry.serverTimestamp instanceof Date
        ? entry.serverTimestamp.getTime()
        : (entry.serverTimestamp as number),
  };
}

/**
 * Sync progress log entries from client to server.
 * Uses INSERT ... ON CONFLICT DO NOTHING for idempotency.
 *
 * The server assigns serverSeq (auto-increment) and serverTimestamp on insert.
 * TODO: we need to batch the inserts instead of doing them one by one
 *
 * @param clientDeviceId - The client's device ID from X-Device-ID header (not the DB id)
 */
export async function syncProgressLogs(
  database: D1Database,
  userId: string,
  clientDeviceId: string,
  entries: ProgressLogEntry[],
): Promise<
  { results: ProgressLogResult[] } | { error: string; status: number }
> {
  const db = drizzle(database, { schema });

  if (entries.length === 0) {
    return { results: [] };
  }

  // Resolve the client device ID to the database device ID
  const deviceId = await resolveDeviceId(database, userId, clientDeviceId);
  if (!deviceId) {
    return { error: "Device not found", status: 404 };
  }

  // Check which entries already exist (by id)
  const entryIds = entries.map((e) => e.id);
  const existingEntries = await db
    .select({ id: schema.readingProgressLog.id })
    .from(schema.readingProgressLog)
    .where(
      and(
        eq(schema.readingProgressLog.userId, userId),
        inArray(schema.readingProgressLog.id, entryIds),
      ),
    );

  const existingIds = new Set(existingEntries.map((e) => e.id));

  // Filter to only new entries
  const newEntries = entries.filter((e) => !existingIds.has(e.id));

  const results: ProgressLogResult[] = [];
  const serverTimestamp = new Date();

  // Process entries that already exist
  for (const entry of entries) {
    if (existingIds.has(entry.id)) {
      results.push({
        id: entry.id,
        serverSeq: 0, // We don't know the serverSeq for existing entries
        status: "duplicate",
      });
    }
  }

  // Insert new entries one by one to get their serverSeq
  // Note: D1 doesn't support RETURNING, so we need to query after insert
  for (const entry of newEntries) {
    await db.insert(schema.readingProgressLog).values({
      id: entry.id,
      userId,
      fileHash: entry.fileHash,
      deviceId,
      spineIndex: entry.spineIndex,
      scrollProgress: entry.scrollProgress,
      clientSeq: entry.clientSeq,
      clientTimestamp: new Date(entry.clientTimestamp),
      serverTimestamp,
    });

    // Query to get the serverSeq
    const inserted = await db
      .select({ serverSeq: schema.readingProgressLog.serverSeq })
      .from(schema.readingProgressLog)
      .where(eq(schema.readingProgressLog.id, entry.id))
      .get();

    results.push({
      id: entry.id,
      serverSeq: inserted?.serverSeq ?? 0,
      status: "created",
    });
  }

  return { results };
}

/**
 * Get the current reading position for multiple books at once.
 * Returns a map of fileHash -> latest progress entry.
 */
export async function getCurrentProgressBatch(
  database: D1Database,
  userId: string,
  fileHashes: string[],
): Promise<Map<string, ServerProgressEntry>> {
  if (fileHashes.length === 0) {
    return new Map();
  }

  const db = drizzle(database, { schema });

  // Get all entries for these books, ordered by serverSeq desc
  // Then we'll group by fileHash and take the first (latest) for each
  const entries = await db
    .select({
      id: schema.readingProgressLog.id,
      fileHash: schema.readingProgressLog.fileHash,
      spineIndex: schema.readingProgressLog.spineIndex,
      scrollProgress: schema.readingProgressLog.scrollProgress,
      clientSeq: schema.readingProgressLog.clientSeq,
      clientTimestamp: schema.readingProgressLog.clientTimestamp,
      serverSeq: schema.readingProgressLog.serverSeq,
      serverTimestamp: schema.readingProgressLog.serverTimestamp,
      deviceId: schema.readingProgressLog.deviceId,
    })
    .from(schema.readingProgressLog)
    .where(
      and(
        eq(schema.readingProgressLog.userId, userId),
        inArray(schema.readingProgressLog.fileHash, fileHashes),
      ),
    )
    .orderBy(schema.readingProgressLog.serverSeq);

  // Group by fileHash, keeping only the latest (last due to ordering)
  const resultMap = new Map<string, ServerProgressEntry>();

  for (const entry of entries) {
    resultMap.set(entry.fileHash, {
      ...entry,
      clientTimestamp:
        entry.clientTimestamp instanceof Date
          ? entry.clientTimestamp.getTime()
          : (entry.clientTimestamp as number),
      serverTimestamp:
        entry.serverTimestamp instanceof Date
          ? entry.serverTimestamp.getTime()
          : (entry.serverTimestamp as number),
    });
  }

  return resultMap;
}

import { syncData } from "@server/db/schema";
import { and, eq, gt, sql, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

const DEFAULT_SYNC_LIMIT = 5000;

// Zod schemas for validation
export const syncPullQuerySchema = z.object({
  since: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
  entityId: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : DEFAULT_SYNC_LIMIT)),
});

export const syncItemSchema = z.object({
  id: z.string().min(1),
  entityId: z.string().optional(),
  _hlc: z.string().min(1),
  _deviceId: z.string().min(1),
  _isDeleted: z.boolean().default(false),
  data: z.record(z.string(), z.unknown()),
});

export const syncPushBodySchema = z.object({
  items: z.array(syncItemSchema),
});

export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;
export type SyncItem = z.infer<typeof syncItemSchema>;
export type SyncPushBody = z.infer<typeof syncPushBodySchema>;

export type ServerSyncItem = {
  id: string;
  entityId: string | null;
  _hlc: string;
  _deviceId: string;
  _isDeleted: boolean;
  _serverTimestamp: number;
  data: Record<string, unknown>;
};

export type PullResult = {
  items: ServerSyncItem[];
  serverTimestamp: number;
  hasMore: boolean;
};

export type PushResult = {
  results: Array<{
    id: string;
    serverTimestamp: number;
    accepted: boolean;
  }>;
};

/**
 * Pull sync data for a specific table.
 * Returns items updated after the given serverTimestamp.
 * Optionally filtered by entityId for entity-scoped sync.
 * Filters out data from the requesting device to avoid sending back its own changes.
 */
export async function pullSyncData(
  database: D1Database,
  userId: string,
  deviceId: string,
  tableName: string,
  since: number,
  entityId?: string,
  limit: number = DEFAULT_SYNC_LIMIT,
): Promise<PullResult> {
  const db = drizzle(database);

  // Build query conditions
  const conditions = [
    eq(syncData.tableName, tableName),
    eq(syncData.userId, userId),
    gt(syncData.serverTimestamp, new Date(since)),
    ne(syncData.deviceId, deviceId), // Filter out client's own device
  ];

  if (entityId) {
    conditions.push(eq(syncData.entityId, entityId));
  }

  // Fetch limit + 1 to determine if there are more items
  const items = await db
    .select({
      id: syncData.id,
      entityId: syncData.entityId,
      hlc: syncData.hlc,
      deviceId: syncData.deviceId,
      isDeleted: syncData.isDeleted,
      serverTimestamp: syncData.serverTimestamp,
      data: syncData.data,
    })
    .from(syncData)
    .where(and(...conditions))
    .orderBy(syncData.serverTimestamp)
    .limit(limit + 1);

  const hasMore = items.length > limit;
  const results = items.slice(0, limit);

  const serverTimestamp =
    results.length > 0
      ? results[results.length - 1].serverTimestamp.getTime()
      : since;

  return {
    items: results.map((item) => ({
      id: item.id,
      entityId: item.entityId,
      _hlc: item.hlc,
      _deviceId: item.deviceId,
      _isDeleted: item.isDeleted,
      _serverTimestamp: item.serverTimestamp.getTime(),
      data: item.data as Record<string, unknown>,
    })),
    serverTimestamp,
    hasMore,
  };
}

/**
 * Push sync data for a specific table using batched operations.
 * Implements last-write-wins (LWW) based on HLC comparison.
 *
 * The server stores all writes and uses onConflictDoUpdate with a WHERE clause
 * to only accept writes with a greater HLC timestamp.
 *
 * @param deviceId - Device ID from request header, used to validate client-provided deviceId
 */
export async function pushSyncData(
  database: D1Database,
  userId: string,
  deviceId: string,
  tableName: string,
  items: SyncItem[],
): Promise<PushResult> {
  const db = drizzle(database);

  if (items.length === 0) {
    return { results: [] };
  }

  const now = new Date();
  const results: PushResult["results"] = [];
  const batchOps: BatchItem<"sqlite">[] = [];

  for (const item of items) {
    const serverTimestamp = now;

    // Validate that the client-provided deviceId matches the header deviceId
    // This prevents clients from spoofing other devices
    if (item._deviceId !== deviceId) {
      throw new Error(
        `Device ID mismatch: item has ${item._deviceId}, but request header has ${deviceId}`,
      );
    }

    // Use INSERT ... ON CONFLICT DO UPDATE with WHERE clause for LWW
    // The WHERE clause ensures we only update if the incoming HLC is greater
    batchOps.push(
      db
        .insert(syncData)
        .values({
          id: item.id,
          tableName,
          userId,
          entityId: item.entityId ?? null,
          hlc: item._hlc,
          deviceId: item._deviceId,
          isDeleted: item._isDeleted,
          serverTimestamp,
          data: item.data,
        })
        .onConflictDoUpdate({
          target: [syncData.tableName, syncData.userId, syncData.id],
          set: {
            hlc: item._hlc,
            deviceId: item._deviceId,
            isDeleted: item._isDeleted,
            serverTimestamp,
            data: item.data,
          },
          // Last-write-wins: only update if incoming HLC is greater
          // SQLite string comparison works for our HLC format (timestamp-counter-deviceId)
          setWhere: sql`${item._hlc} > ${syncData.hlc}`,
        }),
    );

    // All items are accepted (the database handles LWW filtering)
    results.push({
      id: item.id,
      serverTimestamp: serverTimestamp.getTime(),
      accepted: true,
    });
  }

  // Execute all operations in a single batch
  if (batchOps.length > 0) {
    await db.batch(batchOps as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  return { results };
}

/**
 * Get the current server timestamp.
 * Useful for clients to initialize their sync cursor.
 */
export function getCurrentServerTimestamp(): number {
  return Date.now();
}

/**
 * Delete all sync data for a specific table and user.
 * Useful for testing or when a user wants to reset their sync data.
 */
export async function deleteSyncData(
  database: D1Database,
  userId: string,
  tableName: string,
): Promise<void> {
  const db = drizzle(database);

  await db
    .delete(syncData)
    .where(and(eq(syncData.tableName, tableName), eq(syncData.userId, userId)));
}

/**
 * Delete sync data for a specific entity.
 * Useful when an entity (e.g., a book) is permanently deleted.
 */
export async function deleteSyncDataForEntity(
  database: D1Database,
  userId: string,
  tableName: string,
  entityId: string,
): Promise<void> {
  const db = drizzle(database);

  await db
    .delete(syncData)
    .where(
      and(
        eq(syncData.tableName, tableName),
        eq(syncData.userId, userId),
        eq(syncData.entityId, entityId),
      ),
    );
}

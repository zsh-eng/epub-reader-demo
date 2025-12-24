/**
 * Dexie DBCore Middleware for Sync Metadata
 *
 * This middleware automatically injects sync metadata fields into all write operations
 * on synced tables. It distinguishes between local writes and remote writes based on
 * an explicit remote write marker.
 *
 * Key behaviors:
 * - Local writes (no REMOTE_WRITE marker): Add _hlc, _deviceId, set _serverTimestamp=UNSYNCED_TIMESTAMP, _isDeleted=0
 * - Remote writes (has REMOTE_WRITE marker): Pass through unchanged (preserve server metadata)
 * - Deletes: Blocked - must use put with _isDeleted=true instead
 *
 * Note: This middleware does NOT automatically filter deleted records from queries.
 * Use the provided helper functions (isNotDeleted, whereNotDeleted) to filter in application code.
 */

import type { DBCore, DBCoreTable } from "dexie";
import type { HLCService } from "./hlc";
import type { SyncMetadata } from "./schema";
import { UNSYNCED_TIMESTAMP } from "./schema";

/**
 * Symbol used to mark values as remote writes.
 * This prevents the middleware from treating them as local modifications.
 */
const REMOTE_WRITE = Symbol("remoteWrite");

/**
 * Interface for values marked as remote writes
 */
export interface RemoteWriteMarker {
  [REMOTE_WRITE]: true;
}

/**
 * Options for creating the sync middleware
 */
export interface SyncMiddlewareOptions {
  /** HLC service instance */
  hlc: HLCService;

  /** Set of table names that should have sync metadata injected */
  syncedTables: Set<string>;

  /** Optional callback for local mutations (useful for triggering sync push) */
  onLocalMutation?: (table: string) => void;
}

/**
 * Helper to mark a value as a remote write.
 * This tells the middleware to preserve the sync metadata without modification.
 *
 * @example
 * // When applying remote changes from the server:
 * await db.notes.bulkPut(remoteItems.map(item => markAsRemoteWrite(item)));
 */
export function markAsRemoteWrite<T extends Record<string, unknown>>(
  value: T,
): T & RemoteWriteMarker {
  return { ...value, [REMOTE_WRITE]: true };
}

/**
 * Check if a value is marked as a remote write
 */
function isRemoteWrite(value: unknown): boolean {
  return !!(value && typeof value === "object" && REMOTE_WRITE in value);
}

/**
 * Create the sync middleware for Dexie
 */
export function createSyncMiddleware(options: SyncMiddlewareOptions) {
  const { hlc, syncedTables, onLocalMutation } = options;

  return {
    stack: "dbcore" as const,
    name: "SyncMiddleware",
    create: (core: DBCore): DBCore => {
      return {
        ...core,
        table(tableName: string): DBCoreTable {
          const table = core.table(tableName);
          const isSynced = syncedTables.has(tableName);

          if (!isSynced) {
            // Not a synced table - pass through unchanged
            return table;
          }

          return {
            ...table,

            // Intercept mutate operations (add, put, delete)
            async mutate(req) {
              // Block direct delete operations
              if (req.type === "delete" || req.type === "deleteRange") {
                throw new Error(
                  `Direct delete operations are not allowed on synced table "${tableName}". ` +
                    `Use put() with _isDeleted=1 instead.`,
                );
              }

              // Process values for add/put operations
              if (req.type === "add" || req.type === "put") {
                const deviceId = hlc.getDeviceId();
                const hlcTimestamps = hlc.nextBatch(req.values?.length ?? 0);
                const localWrites: number[] = []; // Track which values are local writes

                req.values = req.values?.map((value, idx) => {
                  if (isRemoteWrite(value)) {
                    // Remote write - strip marker and pass through unchanged
                    const { [REMOTE_WRITE]: _, ...cleanValue } = value as any;
                    return cleanValue;
                  }

                  // Local write - always regenerate sync metadata
                  // This handles both new records and modifications of existing records
                  localWrites.push(idx);
                  const enriched = {
                    ...value,
                    _hlc: hlcTimestamps[idx],
                    _deviceId: deviceId,
                    _serverTimestamp: UNSYNCED_TIMESTAMP,
                    _isDeleted: (value as any)._isDeleted ?? 0, // Preserve _isDeleted if set
                  };
                  return enriched;
                });

                // Emit mutation event for local writes (batched per operation)
                if (onLocalMutation && localWrites.length > 0) {
                  return table.mutate(req).then((result) => {
                    // Trigger sync for this table after successful mutation
                    onLocalMutation(tableName);
                    return result;
                  });
                }
              }

              return table.mutate(req);
            },
          };
        },
      };
    },
  };
}

/**
 * Helper to create a value for deletion (tombstone)
 * Use this when you want to delete a record in a synced table
 *
 * @example
 * const highlight = await db.highlights.get(id);
 * await db.highlights.put(createTombstone(highlight));
 */
export function createTombstone<T extends Record<string, unknown>>(
  record: T,
): T & Pick<SyncMetadata, "_isDeleted"> {
  return {
    ...record,
    _isDeleted: 1,
  };
}

/**
 * Helper to check if a record is deleted (tombstone)
 *
 * @example
 * const highlights = await db.highlights.toArray();
 * const activeHighlights = highlights.filter(isNotDeleted);
 */
export function isNotDeleted<T extends Partial<SyncMetadata>>(
  record: T,
): boolean {
  return record._isDeleted !== 1;
}

/**
 * Helper to filter deleted records using Dexie's filter API
 *
 * @example
 * const activeHighlights = await db.highlights.filter(isNotDeleted).toArray();
 */
export { isNotDeleted as whereNotDeleted };

/**
 * Dexie DBCore Middleware for Sync Metadata
 *
 * This middleware automatically injects sync metadata fields into all write operations
 * on synced tables. It distinguishes between local writes and remote writes based on
 * the presence of _serverTimestamp.
 *
 * Key behaviors:
 * - Local writes (no _serverTimestamp): Add _hlc, _deviceId, set _serverTimestamp=null, _isDeleted=0
 * - Remote writes (has _serverTimestamp): Pass through unchanged (preserve server metadata)
 * - Deletes: Blocked - must use put with _isDeleted=true instead
 *
 * Note: This middleware does NOT automatically filter deleted records from queries.
 * Use the provided helper functions (isNotDeleted, whereNotDeleted) to filter in application code.
 */

import type { DBCore, DBCoreTable } from "dexie";
import type { HLCService } from "./hlc";
import type { SyncMetadata } from "./schema";

/**
 * Options for creating the sync middleware
 */
export interface SyncMiddlewareOptions {
  /** HLC service instance */
  hlc: HLCService;

  /** Set of table names that should have sync metadata injected */
  syncedTables: Set<string>;

  /** Optional callback for mutation events (useful for triggering sync) */
  onMutation?: (event: MutationEvent) => void;
}

/**
 * Event emitted when a mutation occurs on a synced table
 */
export interface MutationEvent {
  /** Table name */
  table: string;

  /** Type of mutation */
  type: "create" | "update" | "delete";

  /** Primary key of the mutated record */
  key: unknown;

  /** The mutated value (undefined for deletes) */
  value?: unknown;
}

/**
 * Check if a value has sync metadata (indicating it's from remote sync)
 */
function hasSyncMetadata(value: unknown): value is SyncMetadata {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return "_serverTimestamp" in obj && obj._serverTimestamp !== undefined;
}

/**
 * Create the sync middleware for Dexie
 */
export function createSyncMiddleware(options: SyncMiddlewareOptions) {
  const { hlc, syncedTables, onMutation } = options;

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
            mutate(req) {
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
                  if (hasSyncMetadata(value)) {
                    // Remote write - pass through unchanged
                    return value;
                  }
                  // Local write - add sync metadata
                  localWrites.push(idx);
                  const enriched = {
                    ...value,
                    _hlc: hlcTimestamps[idx],
                    _deviceId: deviceId,
                    _serverTimestamp: null,
                    _isDeleted: 0,
                  };
                  return enriched;
                });

                // TODO: the mutation events might need to be batched to work correctly
                // Emit mutation events only for local writes
                if (onMutation && localWrites.length > 0) {
                  return table.mutate(req).then((result) => {
                    // Keys are available in the result after mutation
                    if (result.results) {
                      result.results.forEach((key, resultIdx) => {
                        // Check if this index corresponds to a local write
                        if (localWrites.includes(resultIdx)) {
                          const value = req.values?.[resultIdx];
                          const eventType =
                            req.type === "add" ? "create" : "update";

                          onMutation({
                            table: tableName,
                            type: eventType,
                            key,
                            value,
                          });
                        }
                      });
                    }
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

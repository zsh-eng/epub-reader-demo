/**
 * Sync Engine
 *
 * Orchestrates the synchronization process between local storage and the remote server.
 * Handles push (local → server) and pull (server → local) operations with conflict resolution.
 */

import type { HLCService } from "@/lib/sync/hlc/hlc";
import type { RemoteAdapter } from "@/lib/sync/remote-adapter";
import type { StorageAdapter } from "@/lib/sync/storage-adapter";

/**
 * Options for sync operations
 */
export interface SyncOptions {
  /**
   * Entity ID for scoped sync (e.g., bookId for reading progress)
   */
  entityId?: string;

  /**
   * Maximum number of items to pull in one batch
   */
  pullLimit?: number;

  /**
   * Maximum number of items to push in one batch
   */
  pushLimit?: number;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /**
   * Number of items pushed to the server
   */
  pushed: number;

  /**
   * Number of items pulled from the server
   */
  pulled: number;

  /**
   * Number of conflicts resolved
   */
  conflicts: number;

  /**
   * Whether there are more items to pull from the server
   */
  hasMore: boolean;

  /**
   * Any errors that occurred during sync
   */
  errors: string[];
}

/**
 * Result of a push operation
 */
export interface PushResult {
  /**
   * Number of items pushed
   */
  pushed: number;

  /**
   * Any errors that occurred
   */
  errors: string[];
}

/**
 * Result of a pull operation
 */
export interface PullResult {
  /**
   * Number of items pulled
   */
  pulled: number;

  /**
   * Number of conflicts resolved
   */
  conflicts: number;

  /**
   * Whether there are more items to pull
   */
  hasMore: boolean;

  /**
   * Any errors that occurred
   */
  errors: string[];
}

/**
 * Sync Engine
 *
 * Manages bidirectional sync between local storage and remote server.
 */
export class SyncEngine {
  private storage: StorageAdapter;
  private remote: RemoteAdapter;
  private hlc: HLCService;

  constructor(storage: StorageAdapter, remote: RemoteAdapter, hlc: HLCService) {
    this.storage = storage;
    this.remote = remote;
    this.hlc = hlc;
  }

  /**
   * Push local changes to the server.
   *
   * Gets all pending changes (where _serverTimestamp is null),
   * sends them to the server, and updates the local _serverTimestamp
   * on successful acceptance.
   *
   * @param table - Table name to sync
   * @param options - Sync options
   * @returns Push result
   */
  async push(table: string, options: SyncOptions = {}): Promise<PushResult> {
    const errors: string[] = [];
    let pushed = 0;

    try {
      // TODO: Change device ID to be obtained from the storage adapter
      const deviceId = this.hlc.getDeviceId();
      let pendingItems = await this.storage.getPendingChanges(table, deviceId);

      if (options.entityId) {
        console.log("Entity ID does not apply for push");
      }

      // Apply push limit if specified
      if (options.pushLimit && pendingItems.length > options.pushLimit) {
        pendingItems = pendingItems.slice(0, options.pushLimit);
      }

      if (pendingItems.length === 0) {
        return { pushed: 0, errors: [] };
      }

      const pushResult = await this.remote.push(table, pendingItems);
      const acceptedResults = pushResult.results.filter((r) => r.accepted);

      if (acceptedResults.length > 0) {
        // Get all accepted items in bulk
        const acceptedIds = acceptedResults.map((r) => r.id);
        const localItems = await Promise.all(
          acceptedIds.map((id) => this.storage.getLocalItem(table, id)),
        );

        // Update _serverTimestamp for all accepted items
        const itemsToUpdate = localItems
          .map((localItem, index) => {
            if (!localItem) return null;

            // Update the _serverTimestamp to mark as synced
            localItem._serverTimestamp = acceptedResults[index].serverTimestamp;
            return localItem;
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        // Apply all updates in one batch
        if (itemsToUpdate.length > 0) {
          await this.storage.applyRemoteChanges(table, itemsToUpdate, (a, b) =>
            this.hlc.compare(a, b),
          );
          pushed = itemsToUpdate.length;
        }
      }

      // Track any rejected items
      const rejectedItems = pushResult.results.filter((r) => !r.accepted);
      if (rejectedItems.length > 0) {
        errors.push(
          `${rejectedItems.length} items were rejected by the server`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error during push";
      errors.push(message);
    }

    return { pushed, errors };
  }

  /**
   * Pull remote changes from the server.
   *
   * Gets changes from the server since the last sync cursor,
   * resolves conflicts using HLC comparison (Last-Write-Wins),
   * and applies changes to local storage.
   *
   * @param table - Table name to sync
   * @param options - Sync options
   * @returns Pull result
   */
  async pull(table: string, options: SyncOptions = {}): Promise<PullResult> {
    const errors: string[] = [];
    let pulled = 0;
    let conflicts = 0;
    let hasMore = false;

    try {
      const since = await this.storage.getSyncCursor(table, options.entityId);
      const pullResult = await this.remote.pull(
        table,
        since,
        options.entityId,
        options.pullLimit,
      );

      hasMore = pullResult.hasMore;
      if (pullResult.items.length === 0) {
        return { pulled: 0, conflicts: 0, hasMore, errors: [] };
      }

      // Get all local items in bulk for conflict detection and HLC updates
      const localItemIds = pullResult.items.map((item) => item.id);
      const localItems = await Promise.all(
        localItemIds.map((id) => this.storage.getLocalItem(table, id)),
      );

      // Count conflicts and update HLC clock
      let maxHlc = "";
      pullResult.items.forEach((remoteItem, index) => {
        const localItem = localItems[index];

        if (localItem) {
          const comparison = this.hlc.compare(remoteItem._hlc, localItem._hlc);
          if (comparison !== 0) {
            conflicts++;
          }
        }

        // Track the maximum HLC to update clock once
        if (!maxHlc || this.hlc.compare(remoteItem._hlc, maxHlc) > 0) {
          maxHlc = remoteItem._hlc;
        }
      });

      // Update HLC clock once with the maximum timestamp
      if (maxHlc) {
        this.hlc.receive(maxHlc);
      }

      // Apply all remote changes (conflict resolution is handled by storage adapter)
      await this.storage.applyRemoteChanges(table, pullResult.items, (a, b) =>
        this.hlc.compare(a, b),
      );

      pulled = pullResult.items.length;
      await this.storage.setSyncCursor(
        table,
        pullResult.serverTimestamp,
        options.entityId,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error during pull";
      errors.push(message);
    }

    return { pulled, conflicts, hasMore, errors };
  }

  /**
   * Perform a full bidirectional sync (push then pull).
   *
   * First pushes local changes to the server, then pulls remote changes.
   * This ensures that local changes are saved before potentially being
   * overwritten by remote changes during conflict resolution.
   *
   * @param table - Table name to sync
   * @param options - Sync options
   * @returns Sync result
   */
  async sync(table: string, options: SyncOptions = {}): Promise<SyncResult> {
    const errors: string[] = [];

    const pullResult = await this.pull(table, options);
    errors.push(...pullResult.errors);
    const pushResult = await this.push(table, options);
    errors.push(...pushResult.errors);

    return {
      pushed: pushResult.pushed,
      pulled: pullResult.pulled,
      conflicts: pullResult.conflicts,
      hasMore: pullResult.hasMore,
      errors,
    };
  }

  /**
   * Sync multiple tables in sequence.
   *
   * @param tables - Array of table names to sync
   * @param options - Sync options (applied to all tables)
   * @returns Map of table name to sync result
   */
  async syncAll(
    tables: string[],
    options: SyncOptions = {},
  ): Promise<Map<string, SyncResult>> {
    const results = new Map<string, SyncResult>();

    for (const table of tables) {
      const result = await this.sync(table, options);
      results.set(table, result);
    }

    return results;
  }

  /**
   * Initialize sync for a table by setting the cursor to the current server time.
   * This is useful when setting up sync for the first time to avoid pulling all historical data.
   *
   * @param table - Table name
   * @param entityId - Optional entity ID for scoped sync
   */
  async initializeSyncCursor(table: string, entityId?: string): Promise<void> {
    const serverTimestamp = await this.remote.getCurrentTimestamp();
    await this.storage.setSyncCursor(table, serverTimestamp, entityId);
  }

  /**
   * Reset sync cursor for a table to start syncing from the beginning.
   *
   * @param table - Table name
   * @param entityId - Optional entity ID for scoped sync
   */
  async resetSyncCursor(table: string, entityId?: string): Promise<void> {
    await this.storage.setSyncCursor(table, 0, entityId);
  }

  /**
   * Get the current sync cursor for a table.
   *
   * @param table - Table name
   * @param entityId - Optional entity ID for scoped sync
   * @returns Current sync cursor timestamp
   */
  async getSyncCursor(table: string, entityId?: string): Promise<number> {
    return this.storage.getSyncCursor(table, entityId);
  }
}

/**
 * Create a sync engine instance.
 *
 * @param storage - Storage adapter
 * @param remote - Remote adapter
 * @param hlc - HLC service
 * @returns SyncEngine instance
 */
export function createSyncEngine(
  storage: StorageAdapter,
  remote: RemoteAdapter,
  hlc: HLCService,
): SyncEngine {
  return new SyncEngine(storage, remote, hlc);
}

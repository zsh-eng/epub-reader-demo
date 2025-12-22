/**
 * Storage Adapter for Sync Engine
 *
 * Provides an abstraction over local storage (Dexie/IndexedDB) for sync operations.
 * This adapter is used internally by the sync engine and is not meant for general application use.
 */

import type { SyncMetadata } from "@/lib/sync/hlc/schema";
import type { Table } from "dexie";

/**
 * Item structure for sync operations
 */
export interface SyncItem {
  id: string;
  entityId?: string;
  _hlc: string;
  _deviceId: string;
  _isDeleted: boolean;
  _serverTimestamp: number | null;
  data: Record<string, unknown>;
}

/**
 * Result of applying remote changes
 */
export interface ApplyRemoteResult {
  /**
   * IDs of items where remote won (newer or new insert)
   */
  applied: string[];

  /**
   * IDs of items where local was kept (local was newer)
   */
  skipped: string[];
}

/**
 * Storage adapter interface for sync operations
 */
export interface StorageAdapter {
  /**
   * Get items that need to be synced to the server.
   * Returns items where _serverTimestamp is null.
   *
   * @param table - Table name
   * @param deviceId - Current device ID
   * @returns Array of items pending sync
   */
  getPendingChanges(table: string, deviceId: string): Promise<SyncItem[]>;

  /**
   * Apply remote changes from the server to local storage.
   * Handles conflict resolution using HLC comparison.
   *
   * @param table - Table name
   * @param items - Remote items to apply
   * @param hlcCompare - Function to compare HLC timestamps
   * @returns Result containing applied/skipped IDs and max HLC
   */
  applyRemoteChanges(
    table: string,
    items: SyncItem[],
    hlcCompare: (a: string, b: string) => number,
  ): Promise<ApplyRemoteResult>;

  /**
   * Get the sync cursor (last synced server timestamp) for a table.
   *
   * @param table - Table name
   * @param entityId - Optional entity ID for scoped sync
   * @returns Last synced server timestamp, or 0 if never synced
   */
  getSyncCursor(table: string, entityId?: string): Promise<number>;

  /**
   * Set the sync cursor for a table.
   *
   * @param table - Table name
   * @param serverTimestamp - Server timestamp to save
   * @param entityId - Optional entity ID for scoped sync
   */
  setSyncCursor(
    table: string,
    serverTimestamp: number,
    entityId?: string,
  ): Promise<void>;
}

/**
 * Convert a database record to a SyncItem
 */
function recordToSyncItem(
  record: Record<string, unknown> & { id: string } & SyncMetadata,
  entityKey?: string,
): SyncItem {
  // Extract sync metadata
  const { id, _hlc, _deviceId, _isDeleted, _serverTimestamp, ...data } = record;

  // Extract entityId if entityKey is specified
  const entityId = entityKey
    ? (data[entityKey] as string | undefined)
    : undefined;

  // Remove entityKey from data if it exists (to avoid duplication)
  if (entityKey && entityId) {
    delete data[entityKey];
  }

  return {
    id,
    entityId,
    _hlc,
    _deviceId,
    _isDeleted: _isDeleted === 1,
    _serverTimestamp,
    data,
  };
}

/**
 * Convert a SyncItem to a database record
 */
function syncItemToRecord(
  item: SyncItem,
  entityKey?: string,
): Record<string, unknown> & { id: string } & SyncMetadata {
  const record: Record<string, unknown> = {
    id: item.id,
    _hlc: item._hlc,
    _deviceId: item._deviceId,
    _isDeleted: item._isDeleted ? 1 : 0,
    _serverTimestamp: item._serverTimestamp,
    ...item.data,
  };

  // Add entityId to data if entityKey is specified
  if (entityKey && item.entityId) {
    record[entityKey] = item.entityId;
  }

  return record as Record<string, unknown> & { id: string } & SyncMetadata;
}

/**
 * Dexie implementation of StorageAdapter
 */
export class DexieStorageAdapter implements StorageAdapter {
  private tables: Map<string, Table>;
  private entityKeys: Map<string, string | undefined>;

  constructor(
    tables: Map<string, Table>,
    entityKeys: Map<string, string | undefined>,
  ) {
    this.tables = tables;
    this.entityKeys = entityKeys;
  }

  async getPendingChanges(
    table: string,
    deviceId?: string,
  ): Promise<SyncItem[]> {
    const dexieTable = this.tables.get(table);
    if (!dexieTable) {
      throw new Error(`Table ${table} not found in storage adapter`);
    }

    const entityKey = this.entityKeys.get(table);

    // Get all records where _serverTimestamp is null (local changes not yet synced)
    // Note: This intentionally includes deleted items (_isDeleted=1) because
    // we need to sync deletions to the server. Application queries should
    // filter deleted items using isNotDeleted() helper.
    // Note: Dexie doesn't support .equals(null) for indexed queries, so we fetch all
    // records and filter in memory. For large datasets, consider adding a separate
    // index or using a sentinel value instead of null.
    const allRecords = await dexieTable.toArray();
    const records = allRecords.filter(
      (record: Record<string, unknown> & SyncMetadata) =>
        record._serverTimestamp === null &&
        (!deviceId || record._deviceId === deviceId),
    );

    return records.map((record) =>
      recordToSyncItem(
        record as Record<string, unknown> & { id: string } & SyncMetadata,
        entityKey,
      ),
    );
  }

  async applyRemoteChanges(
    table: string,
    items: SyncItem[],
    hlcCompare: (a: string, b: string) => number,
  ): Promise<ApplyRemoteResult> {
    const dexieTable = this.tables.get(table);
    if (!dexieTable) {
      throw new Error(`Table ${table} not found in storage adapter`);
    }

    const entityKey = this.entityKeys.get(table);
    const applied: string[] = [];
    const skipped: string[] = [];

    // Use a transaction and bulk operations for efficiency
    await dexieTable.db.transaction("rw", dexieTable, async () => {
      const ids = items.map((item) => item.id);
      const existingRecords = await dexieTable.bulkGet(ids);
      const itemsToUpdate: Array<
        Record<string, unknown> & { id: string } & SyncMetadata
      > = [];

      items.forEach((remoteItem, index) => {
        const localRecord = existingRecords[index];
        if (!localRecord) {
          // New item - insert it
          itemsToUpdate.push(syncItemToRecord(remoteItem, entityKey));
          applied.push(remoteItem.id);
          return;
        }

        const localItem = recordToSyncItem(
          localRecord as Record<string, unknown> & {
            id: string;
          } & SyncMetadata,
          entityKey,
        );

        const comparison = hlcCompare(remoteItem._hlc, localItem._hlc);
        if (comparison > 0) {
          // Remote is newer - add to update batch
          itemsToUpdate.push(syncItemToRecord(remoteItem, entityKey));
          applied.push(remoteItem.id);
        } else if (comparison < 0) {
          // Local is newer - keep local changes
          // Skip this item, the next push will send our version
          skipped.push(remoteItem.id);
        } else {
          // HLCs are equal - this shouldn't happen in normal operation
          // but if it does, prefer the remote version (server wins ties)
          itemsToUpdate.push(syncItemToRecord(remoteItem, entityKey));
          applied.push(remoteItem.id);
        }
      });

      // Batch write only the items that passed the check
      if (itemsToUpdate.length > 0) {
        await dexieTable.bulkPut(itemsToUpdate);
      }
    });

    return { applied, skipped };
  }

  async getSyncCursor(table: string, entityId?: string): Promise<number> {
    // Sync cursors are stored in a special table or in-memory
    // For now, we'll use localStorage for simplicity
    const key = entityId
      ? `sync-cursor:${table}:${entityId}`
      : `sync-cursor:${table}`;

    const stored = localStorage.getItem(key);
    return stored ? parseInt(stored, 10) : 0;
  }

  async setSyncCursor(
    table: string,
    serverTimestamp: number,
    entityId?: string,
  ): Promise<void> {
    const key = entityId
      ? `sync-cursor:${table}:${entityId}`
      : `sync-cursor:${table}`;

    localStorage.setItem(key, serverTimestamp.toString());
  }
}

/**
 * Create a Dexie storage adapter from a database instance
 *
 * @param db - Dexie database instance
 * @param tableConfigs - Map of table names to their entityKey (if any)
 * @returns DexieStorageAdapter instance
 */
export function createDexieStorageAdapter(
  db: { [key: string]: Table },
  tableConfigs: Record<string, { entityKey?: string }>,
): DexieStorageAdapter {
  const tables = new Map<string, Table>();
  const entityKeys = new Map<string, string | undefined>();

  for (const [tableName, config] of Object.entries(tableConfigs)) {
    const table = db[tableName];
    if (!table) {
      throw new Error(`Table ${tableName} not found in database`);
    }
    tables.set(tableName, table);
    entityKeys.set(tableName, config.entityKey);
  }

  return new DexieStorageAdapter(tables, entityKeys);
}

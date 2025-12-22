/**
 * Mock Adapters for Sync Engine Testing
 *
 * Provides in-memory implementations of StorageAdapter and RemoteAdapter
 * for testing the sync engine without requiring a real database or server.
 */

import type {
  PullResult,
  PushResult,
  RemoteAdapter,
} from "@/lib/sync/remote-adapter";
import type { StorageAdapter, SyncItem } from "@/lib/sync/storage-adapter";

/**
 * Mock storage adapter with in-memory storage
 */
export class MockStorageAdapter implements StorageAdapter {
  private data: Map<string, Map<string, SyncItem>> = new Map();
  private cursors: Map<string, number> = new Map();

  /**
   * Get all items in a table (for testing/inspection)
   */
  getAllItems(table: string): SyncItem[] {
    const tableData = this.data.get(table);
    if (!tableData) return [];
    return Array.from(tableData.values());
  }

  /**
   * Set items directly (for test setup)
   */
  setItems(table: string, items: SyncItem[]): void {
    const tableData = this.data.get(table) || new Map();
    for (const item of items) {
      tableData.set(item.id, { ...item });
    }
    this.data.set(table, tableData);
  }

  /**
   * Clear all data (for test cleanup)
   */
  clear(): void {
    this.data.clear();
    this.cursors.clear();
  }

  async getPendingChanges(table: string): Promise<SyncItem[]> {
    const tableData = this.data.get(table);
    if (!tableData) return [];

    const pending: SyncItem[] = [];
    for (const item of Array.from(tableData.values())) {
      if (item._serverTimestamp === null) {
        pending.push({ ...item });
      }
    }

    return pending;
  }

  async applyRemoteChanges(
    table: string,
    items: SyncItem[],
    hlcCompare: (a: string, b: string) => number,
  ): Promise<void> {
    const tableData = this.data.get(table) || new Map();

    for (const remoteItem of items) {
      const localItem = tableData.get(remoteItem.id);

      if (!localItem) {
        // No local version - just insert
        tableData.set(remoteItem.id, { ...remoteItem });
        continue;
      }

      // Compare HLCs for conflict resolution (Last-Write-Wins)
      const comparison = hlcCompare(remoteItem._hlc, localItem._hlc);

      if (comparison > 0) {
        // Remote is newer - apply remote changes
        tableData.set(remoteItem.id, { ...remoteItem });
      } else if (comparison < 0) {
        // Local is newer - keep local changes
        continue;
      } else {
        // HLCs are equal - prefer remote (server wins ties)
        tableData.set(remoteItem.id, { ...remoteItem });
      }
    }

    this.data.set(table, tableData);
  }

  async getLocalItem(table: string, id: string): Promise<SyncItem | null> {
    const tableData = this.data.get(table);
    if (!tableData) return null;

    const item = tableData.get(id);
    return item ? { ...item } : null;
  }

  async getSyncCursor(table: string, entityId?: string): Promise<number> {
    const key = entityId ? `${table}:${entityId}` : table;
    return this.cursors.get(key) || 0;
  }

  async setSyncCursor(
    table: string,
    serverTimestamp: number,
    entityId?: string,
  ): Promise<void> {
    const key = entityId ? `${table}:${entityId}` : table;
    this.cursors.set(key, serverTimestamp);
  }
}

/**
 * Mock remote adapter with in-memory server storage
 */
export class MockRemoteAdapter implements RemoteAdapter {
  private serverData: Map<string, Map<string, SyncItem>> = new Map();
  private serverTime: number = Date.now();

  /**
   * Get all items in a table on the "server" (for testing/inspection)
   */
  getServerItems(table: string): SyncItem[] {
    const tableData = this.serverData.get(table);
    if (!tableData) return [];
    return Array.from(tableData.values());
  }

  /**
   * Set items directly on the "server" (for test setup)
   */
  setServerItems(table: string, items: SyncItem[]): void {
    const tableData = this.serverData.get(table) || new Map();
    for (const item of items) {
      tableData.set(item.id, { ...item });
    }
    this.serverData.set(table, tableData);
  }

  /**
   * Clear all server data (for test cleanup)
   */
  clear(): void {
    this.serverData.clear();
  }

  /**
   * Set the server time (for testing)
   */
  setServerTime(time: number): void {
    this.serverTime = time;
  }

  /**
   * Advance server time (for testing)
   */
  advanceServerTime(ms: number): void {
    this.serverTime += ms;
  }

  async pull(
    table: string,
    since: number,
    entityId?: string,
    limit?: number,
  ): Promise<PullResult> {
    const tableData = this.serverData.get(table);
    if (!tableData) {
      return {
        items: [],
        serverTimestamp: this.serverTime,
        hasMore: false,
      };
    }

    // Filter items by timestamp and entityId
    const items: SyncItem[] = [];
    for (const item of Array.from(tableData.values())) {
      if (item._serverTimestamp !== null && item._serverTimestamp > since) {
        if (!entityId || item.entityId === entityId) {
          items.push({ ...item });
        }
      }
    }

    // Sort by server timestamp
    items.sort((a, b) => {
      const aTime = a._serverTimestamp || 0;
      const bTime = b._serverTimestamp || 0;
      return aTime - bTime;
    });

    // Apply limit and determine hasMore
    const effectiveLimit = limit || items.length;
    const hasMore = items.length > effectiveLimit;
    const resultItems = items.slice(0, effectiveLimit);

    // Calculate the server timestamp to return (the max timestamp of returned items)
    const serverTimestamp =
      resultItems.length > 0
        ? Math.max(...resultItems.map((item) => item._serverTimestamp || 0))
        : since;

    return {
      items: resultItems,
      serverTimestamp,
      hasMore,
    };
  }

  async push(table: string, items: SyncItem[]): Promise<PushResult> {
    const tableData = this.serverData.get(table) || new Map();
    const results: PushResult["results"] = [];

    for (const item of items) {
      const existingItem = tableData.get(item.id);

      // Simulate Last-Write-Wins based on HLC comparison
      let accepted = true;
      if (existingItem) {
        // Simple string comparison works for our HLC format
        if (item._hlc <= existingItem._hlc) {
          // Incoming HLC is not greater - reject
          accepted = false;
        }
      }

      if (accepted) {
        // Accept the item and assign server timestamp
        const serverTimestamp = this.serverTime;
        const serverItem: SyncItem = {
          ...item,
          _serverTimestamp: serverTimestamp,
        };
        tableData.set(item.id, serverItem);

        results.push({
          id: item.id,
          serverTimestamp,
          accepted: true,
        });
      } else {
        // Rejected - return existing server timestamp
        results.push({
          id: item.id,
          serverTimestamp: existingItem!._serverTimestamp || this.serverTime,
          accepted: false,
        });
      }
    }

    this.serverData.set(table, tableData);

    return { results };
  }

  async getCurrentTimestamp(): Promise<number> {
    return this.serverTime;
  }
}

/**
 * Create a mock storage adapter
 */
export function createMockStorageAdapter(): MockStorageAdapter {
  return new MockStorageAdapter();
}

/**
 * Create a mock remote adapter
 */
export function createMockRemoteAdapter(): MockRemoteAdapter {
  return new MockRemoteAdapter();
}

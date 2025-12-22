/**
 * Sync Service
 *
 * Manages the lifecycle of synchronization between local storage and remote server.
 * Handles:
 * - Online/offline monitoring
 * - Periodic sync scheduling
 * - TanStack Query invalidation
 * - Multi-table coordination
 */

import { addSyncLogs, db, type SyncLog } from "@/lib/db";
import { createHLCService } from "@/lib/sync/hlc/hlc";
import { createHonoRemoteAdapter } from "@/lib/sync/remote-adapter";
import { createDexieStorageAdapter } from "@/lib/sync/storage-adapter";
import {
  createSyncEngine,
  type SyncEngine,
  type SyncResult,
} from "@/lib/sync/sync-engine";
import type { QueryClient } from "@tanstack/react-query";
import type { Table } from "dexie";
import { SYNC_TABLES, type SyncTableName } from "@/lib/sync-tables";

const SYNC_INTERVAL_MS = 30_000; // 30 seconds

class SyncService {
  private queryClient: QueryClient | null = null;
  private syncEngine: SyncEngine;
  private isSyncing = false;
  private syncInterval: number | null = null;
  private isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  constructor() {
    // Initialize sync engine
    const hlc = createHLCService();

    const tableConfigs = Object.fromEntries(
      Object.entries(SYNC_TABLES).map(([name, def]) => [
        name,
        { entityKey: "entityKey" in def ? def.entityKey : undefined },
      ]),
    );

    const storage = createDexieStorageAdapter(
      db as unknown as { [key: string]: Table },
      tableConfigs,
    );
    const remote = createHonoRemoteAdapter();
    this.syncEngine = createSyncEngine(storage, remote, hlc);

    // Setup online/offline listeners
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  setQueryClient(client: QueryClient): void {
    this.queryClient = client;
  }

  startPeriodicSync(syncIntervalMs = SYNC_INTERVAL_MS): void {
    if (this.syncInterval !== null) {
      return; // Already started
    }

    if (typeof window === "undefined") {
      return; // Don't start in SSR
    }

    this.syncInterval = window.setInterval(() => {
      if (this.isOnline && !this.isSyncing) {
        this.syncAll().catch((error) => {
          console.error("Periodic sync failed:", error);
        });
      }
    }, syncIntervalMs);

    // Trigger initial sync
    if (this.isOnline) {
      this.syncAll().catch((error) => {
        console.error("Initial sync failed:", error);
      });
    }
  }

  stopPeriodicSync(): void {
    if (this.syncInterval !== null) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  private handleOnline = (): void => {
    this.isOnline = true;
    console.log("Device is online, triggering sync");
    this.syncAll().catch((error) => {
      console.error("Online sync failed:", error);
    });
  };

  private handleOffline = (): void => {
    this.isOnline = false;
    console.log("Device is offline, sync paused");
  };

  get syncing(): boolean {
    return this.isSyncing;
  }

  get online(): boolean {
    return this.isOnline;
  }

  // ============================================================================
  // Sync Operations
  // ============================================================================

  async syncAll(): Promise<Map<SyncTableName, SyncResult>> {
    if (this.isSyncing) {
      console.log("Sync already in progress, skipping");
      return new Map();
    }

    if (!this.isOnline) {
      console.log("Device offline, skipping sync");
      return new Map();
    }

    this.isSyncing = true;
    const startTime = Date.now();

    try {
      const tables = Object.keys(SYNC_TABLES) as SyncTableName[];
      const results = (await this.syncEngine.syncAll(tables)) as Map<
        SyncTableName,
        SyncResult
      >;

      // Log results
      for (const [table, result] of results) {
        await this.logSync("sync", table, result);
      }

      // Invalidate queries if anything changed
      const hasChanges = Array.from(results.values()).some(
        (r) => r.pushed > 0 || r.pulled > 0,
      );

      if (hasChanges && this.queryClient) {
        await this.invalidateQueries();
      }

      const duration = Date.now() - startTime;
      console.log(
        `Sync completed in ${duration}ms`,
        Object.fromEntries(results),
      );

      return results;
    } catch (error) {
      console.error("Sync failed:", error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  async syncTable(
    table: SyncTableName,
    entityId?: string,
  ): Promise<SyncResult> {
    if (!this.isOnline) {
      throw new Error("Cannot sync while offline");
    }

    const result = await this.syncEngine.sync(table, { entityId });
    await this.logSync("sync", table, result);

    if (this.queryClient && (result.pushed > 0 || result.pulled > 0)) {
      await this.invalidateQueries();
    }

    return result;
  }

  async pushTable(table: SyncTableName): Promise<void> {
    if (!this.isOnline) {
      throw new Error("Cannot push while offline");
    }

    const result = await this.syncEngine.push(table);
    await this.logSync("push", table, result);

    if (this.queryClient && result.pushed > 0) {
      await this.invalidateQueries();
    }
  }

  async pullTable(table: SyncTableName, entityId?: string): Promise<void> {
    if (!this.isOnline) {
      throw new Error("Cannot pull while offline");
    }

    const result = await this.syncEngine.pull(table, { entityId });
    await this.logSync("pull", table, result);

    if (this.queryClient && result.pulled > 0) {
      await this.invalidateQueries();
    }
  }

  // ============================================================================
  // Query Invalidation
  // ============================================================================

  private async invalidateQueries(): Promise<void> {
    if (!this.queryClient) return;

    // Invalidate all book-related queries
    await Promise.all([
      this.queryClient.invalidateQueries({ queryKey: ["books"] }),
      this.queryClient.invalidateQueries({ queryKey: ["book"] }),
      this.queryClient.invalidateQueries({ queryKey: ["readingProgress"] }),
      this.queryClient.invalidateQueries({ queryKey: ["highlights"] }),
      this.queryClient.invalidateQueries({ queryKey: ["readingSettings"] }),
    ]);
  }

  // ============================================================================
  // Initialization & Reset
  // ============================================================================

  // TODO: this method should be removed entirely, we should always pull all the historical data
  async initializeSyncCursor(
    table: SyncTableName,
    entityId?: string,
  ): Promise<void> {
    await this.syncEngine.initializeSyncCursor(table, entityId);
  }

  async resetSyncCursor(
    table: SyncTableName,
    entityId?: string,
  ): Promise<void> {
    await this.syncEngine.resetSyncCursor(table, entityId);
  }

  async getSyncCursor(
    table: SyncTableName,
    entityId?: string,
  ): Promise<number> {
    return this.syncEngine.getSyncCursor(table, entityId);
  }

  // ============================================================================
  // Logging
  // ============================================================================

  private async logSync(
    type: "push" | "pull" | "sync",
    table: string,
    result:
      | SyncResult
      | { pushed: number }
      | { pulled: number; conflicts: number },
  ): Promise<void> {
    const log: Omit<SyncLog, "id"> = {
      timestamp: Date.now(),
      type,
      table,
    };

    if ("pushed" in result) log.pushed = result.pushed;
    if ("pulled" in result) log.pulled = result.pulled;
    if ("conflicts" in result) log.conflicts = result.conflicts;
    if ("errors" in result && result.errors.length > 0) {
      log.errors = result.errors;
    }

    // TODO: change to logging all at once
    await addSyncLogs([log]);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  destroy(): void {
    this.stopPeriodicSync();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
  }
}

// Singleton instance
export const syncService = new SyncService();

// Export class for advanced use cases
export { SyncService };

/**
 * Remote Adapter for Sync Engine
 *
 * Provides an abstraction over the remote server API for sync operations.
 * This adapter is used internally by the sync engine to communicate with the server.
 */

import { honoClient } from "@/lib/api";
import type { SyncItem } from "@/lib/sync/storage-adapter";

/**
 * Result of pulling changes from the server
 */
export interface PullResult {
  items: SyncItem[];
  serverTimestamp: number;
  hasMore: boolean;
}

/**
 * Result of pushing changes to the server
 */
export interface PushResult {
  results: Array<{
    id: string;
    serverTimestamp: number;
    accepted: boolean;
  }>;
}

/**
 * Remote adapter interface for sync operations
 */
export interface RemoteAdapter {
  /**
   * Pull changes from the server since a given timestamp.
   *
   * @param table - Table name
   * @param since - Server timestamp to pull changes since (0 for all)
   * @param entityId - Optional entity ID for scoped sync
   * @param limit - Maximum number of items to pull
   * @returns Pull result with items and metadata
   */
  pull(
    table: string,
    since: number,
    entityId?: string,
    limit?: number,
  ): Promise<PullResult>;

  /**
   * Push local changes to the server.
   *
   * @param table - Table name
   * @param items - Items to push
   * @returns Push result with acceptance status
   */
  push(table: string, items: SyncItem[]): Promise<PushResult>;

  /**
   * Get the current server timestamp.
   * Useful for initializing sync cursors.
   *
   * @returns Current server timestamp
   */
  getCurrentTimestamp(): Promise<number>;
}

/**
 * Hono client implementation of RemoteAdapter
 */
export class HonoRemoteAdapter implements RemoteAdapter {
  constructor() {}

  async pull(
    table: string,
    since: number,
    entityId?: string,
    limit?: number,
  ): Promise<PullResult> {
    const query: Record<string, string> = {
      since: since.toString(),
    };

    if (entityId) {
      query.entityId = entityId;
    }

    if (limit !== undefined) {
      query.limit = limit.toString();
    }

    const response = await honoClient.api.sync[":table"].$get({
      param: { table },
      query,
    });

    if (!response.ok) {
      throw new Error(`Failed to pull from server: ${response.status}`);
    }

    const data = await response.json();
    const items = data.items.map((item) => ({
      id: item.id,
      entityId: item.entityId ?? undefined,
      _hlc: item._hlc,
      _deviceId: item._deviceId,
      _isDeleted: item._isDeleted,
      _serverTimestamp: item._serverTimestamp,
      data: item.data,
    })) satisfies SyncItem[];

    return {
      items,
      serverTimestamp: data.serverTimestamp,
      hasMore: data.hasMore,
    };
  }

  async push(table: string, items: SyncItem[]): Promise<PushResult> {
    // Convert SyncItem to server format
    const serverItems = items.map((item) => ({
      id: item.id,
      entityId: item.entityId,
      _hlc: item._hlc,
      _deviceId: item._deviceId,
      _isDeleted: item._isDeleted,
      data: item.data,
    }));

    const response = await honoClient.api.sync[":table"].$post({
      param: { table },
      json: { items: serverItems },
    });

    if (!response.ok) {
      throw new Error(`Failed to push to server: ${response.status}`);
    }

    const data = await response.json();

    return {
      results: data.results.map((result) => ({
        id: result.id,
        serverTimestamp: result.serverTimestamp,
        accepted: result.accepted,
      })),
    };
  }

  async getCurrentTimestamp(): Promise<number> {
    const response = await honoClient.api["sync-timestamp"].$get();
    if (!response.ok) {
      throw new Error(`Failed to get server timestamp: ${response.status}`);
    }
    const data = await response.json();
    return data.serverTimestamp;
  }
}

/**
 * Create a Hono remote adapter
 *
 * @param client - Hono client instance
 * @returns HonoRemoteAdapter instance
 */
export function createHonoRemoteAdapter(): HonoRemoteAdapter {
  return new HonoRemoteAdapter();
}

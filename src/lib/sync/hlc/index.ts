/**
 * HLC-based Sync Engine
 *
 * This module provides a complete sync solution based on Hybrid Logical Clocks (HLC).
 *
 * ## Core Components
 *
 * - **HLC Service**: Generates and manages hybrid logical clock timestamps
 * - **Schema Generator**: Creates Dexie table schemas with sync metadata
 * - **Middleware**: Dexie DBCore middleware that automatically injects sync metadata
 *
 * ## Usage
 *
 * ```ts
 * import { createHLCService, generateDexieStores, createSyncMiddleware } from './sync/hlc';
 *
 * // 1. Create HLC service
 * const hlc = createHLCService();
 *
 * // 2. Define tables
 * const tables = {
 *   highlights: {
 *     primaryKey: 'id',
 *     indices: ['bookId'],
 *   },
 * };
 *
 * // 3. Generate Dexie schemas
 * const stores = generateDexieStores(tables);
 *
 * // 4. Create database with middleware
 * const db = new Dexie('MyDB');
 * db.version(1).stores(stores);
 * db.use(createSyncMiddleware({
 *   hlc,
 *   syncedTables: new Set(Object.keys(tables)),
 * }));
 * ```
 */

// HLC Service
export {
  createHLCService,
  isValidHLC,
  getHLCTimestamp,
  type HLCService,
  type HLCState,
} from "./hlc";

// Schema Generator
export {
  generateDexieStores,
  validateSyncTableDef,
  validateSyncTableDefs,
  createSyncConfig,
  SYNC_INDICES,
  UNSYNCED_TIMESTAMP,
  type SyncTableDef,
  type SyncMetadata,
  type WithSyncMetadata,
  type SyncConfig,
} from "./schema";

// Middleware
export {
  createSyncMiddleware,
  createTombstone,
  isNotDeleted,
  whereNotDeleted,
  markAsRemoteWrite,
  type SyncMiddlewareOptions,
  type MutationEvent,
  type RemoteWriteMarker,
} from "./middleware";

/**
 * Sync Module Exports
 *
 * Central export point for all sync-related services and types.
 */

export { SyncService, syncService } from "../sync-service";

// TODO: Migrate these services to new sync architecture
// export {
//   BookDownloadService,
//   bookDownloadService,
// } from "./book-download-service";
// export { BookUploadService, bookUploadService } from "./book-upload-service";

// export type {
//   BookSyncResult,
//   DownloadBookOptions,
//   DownloadCoverOptions,
//   DownloadResult,
//   PushBooksResponse,
//   ServerBook,
//   SyncBooksResponse,
//   UploadBookOptions,
//   UploadResult,
// } from "./types";

// export { SyncError, SyncErrorType } from "./types";

// export {
//   detectMediaTypeFromBlob,
//   getMediaTypeFromPath,
//   handleFetchError,
//   isRetryableError,
//   pLimit,
//   retryWithBackoff,
// } from "./utils";

// Sync Engine exports
export { createSyncEngine, SyncEngine } from "./sync-engine";
export type {
  SyncOptions,
  PullResult as SyncPullResult,
  PushResult as SyncPushResult,
  SyncResult,
} from "./sync-engine";

export { createHonoRemoteAdapter, HonoRemoteAdapter } from "./remote-adapter";
export type {
  RemoteAdapter,
  PullResult as RemotePullResult,
  PushResult as RemotePushResult,
} from "./remote-adapter";

export {
  createDexieStorageAdapter,
  DexieStorageAdapter,
} from "./storage-adapter";
export type { StorageAdapter, SyncItem } from "./storage-adapter";

// HLC exports
export { createHLCService, getHLCTimestamp, isValidHLC } from "./hlc/hlc";
export type { HLCService, HLCState } from "./hlc/hlc";

export {
  createSyncConfig,
  generateDexieStores,
  SYNC_INDICES,
  validateSyncTableDef,
  validateSyncTableDefs,
} from "./hlc/schema";
export type {
  SyncConfig,
  SyncMetadata,
  SyncTableDef,
  WithSyncMetadata,
} from "./hlc/schema";

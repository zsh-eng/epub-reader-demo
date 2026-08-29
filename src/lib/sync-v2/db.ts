/**
 * Fresh client database for sync v2.
 *
 * This database starts at version 1 and contains no legacy sync metadata.
 */

import type {
  Book,
  BookChapterSourceCache,
  BookFile,
  BookTextCache,
  ReadingCheckpoint,
  ReadingSession,
  ReadingSettings,
} from "@/lib/db";
import type { StoredFile, TransferTask } from "@/lib/files/types";
import { getOrCreateDeviceId } from "@/lib/device";
import {
  getOrCreateSyncClientState,
  nextSyncHlcBatch,
} from "@/lib/sync-v2/client-state";
import { installSync } from "@/lib/sync-v2/middleware";
import type { SyncPushChange } from "@/lib/sync-v2/protocol";
import type { Highlight } from "@/types/highlight";
import type { Note } from "@/types/note";
import type { ReadingState } from "@/types/reading-state";
import Dexie, { type Table } from "dexie";

export const SYNC_V2_DATABASE_NAME = "epub-reader-db-v2";
const LEGACY_DATABASE_NAME = "epub-reader-db";
export const SYNC_V2_SYNCED_TABLES = [
  "books",
  "readingCheckpoints",
  "readingSessions",
  "highlights",
  "readingSettings",
  "readingState",
  "notes",
] as const;

export interface SyncV2DeletionState {
  isDeleted: boolean;
}

export type SyncV2DomainRow<Row> = Row & SyncV2DeletionState;
export type SyncV2Book = SyncV2DomainRow<Book>;
export type SyncV2ReadingCheckpoint = SyncV2DomainRow<ReadingCheckpoint>;
export type SyncV2ReadingSession = SyncV2DomainRow<ReadingSession>;
export type SyncV2Highlight = SyncV2DomainRow<Highlight>;
export type SyncV2ReadingSettings = SyncV2DomainRow<ReadingSettings>;
export type SyncV2ReadingState = SyncV2DomainRow<ReadingState>;
export type SyncV2Note = SyncV2DomainRow<Note>;

/**
 * Domain indexes only. Sync ordering and delivery state live in the outbox.
 */
export const SYNC_V2_STORES = {
  books: "id, dateAdded, &fileHash",
  readingCheckpoints:
    "id, bookId, deviceId, lastRead, [bookId+deviceId], [bookId+lastRead]",
  readingSessions:
    "id, bookId, deviceId, readerInstanceId, startedAt, lastActiveAt, endedAt, [bookId+startedAt], [deviceId+lastActiveAt]",
  highlights:
    "id, bookId, spineItemId, createdAt, [bookId+spineItemId], [bookId+createdAt]",
  readingSettings: "id",
  readingState: "id, bookId, timestamp, [bookId+timestamp]",
  notes:
    "id, annotationId, bookId, createdAt, [annotationId+createdAt], [bookId+spineItemId]",
  bookFiles: "id, bookId, path, [bookId+path]",
  files: "id, contentHash, fileType, [fileType+contentHash]",
  transferQueue:
    "id, status, priority, createdAt, [status+priority], [contentHash+fileType+direction]",
  bookTextCache: "bookId",
  bookChapterSourceCache: "bookId, updatedAt",
  _sync_outbox: "key",
} as const;

const SYNC_V2_VERSION_1_STORES = {
  ...SYNC_V2_STORES,
  readingProgress: "id, bookId, lastRead, [bookId+lastRead]",
} as const;

/** Schema-only connection used by the sync engine for direct remote writes. */
export class EPUBReaderSyncV2DB extends Dexie {
  books!: Table<SyncV2Book, string>;
  readingCheckpoints!: Table<SyncV2ReadingCheckpoint, string>;
  readingSessions!: Table<SyncV2ReadingSession, string>;
  highlights!: Table<SyncV2Highlight, string>;
  readingSettings!: Table<SyncV2ReadingSettings, string>;
  readingState!: Table<SyncV2ReadingState, string>;
  notes!: Table<SyncV2Note, string>;

  bookFiles!: Table<BookFile, string>;
  files!: Table<StoredFile, string>;
  transferQueue!: Table<TransferTask, string>;
  bookTextCache!: Table<BookTextCache, string>;
  bookChapterSourceCache!: Table<BookChapterSourceCache, string>;

  _sync_outbox!: Table<SyncPushChange, string>;

  constructor(databaseName = SYNC_V2_DATABASE_NAME) {
    super(databaseName);
    this.version(1).stores(SYNC_V2_VERSION_1_STORES);
    this.version(2).stores({ readingProgress: null });
  }
}

/** Remove the pre-v2 database after the completed production cutover. */
export async function deleteLegacyClientDatabase(): Promise<void> {
  await Dexie.delete(LEGACY_DATABASE_NAME);
}

/** Create the application-facing connection that captures local mutations. */
export function createSyncV2ApplicationDb(
  databaseName = SYNC_V2_DATABASE_NAME,
): EPUBReaderSyncV2DB {
  const db = new EPUBReaderSyncV2DB(databaseName);
  installSync(db, SYNC_V2_SYNCED_TABLES, (count) => {
    getOrCreateSyncClientState(getOrCreateDeviceId());
    return nextSyncHlcBatch(count);
  });
  return db;
}

export const syncV2Db = createSyncV2ApplicationDb();

/** The sync engine uses this raw connection to avoid producing new changes. */
export const syncV2SyncDb = new EPUBReaderSyncV2DB();

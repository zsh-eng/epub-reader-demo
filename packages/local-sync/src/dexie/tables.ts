import type { Dexie, Table } from "dexie";
import type { SyncPushChange } from "../protocol.js";

export const SYNC_OUTBOX_TABLE = "_sync_outbox";

/** Synced rows use a string `id` and a boolean `isDeleted` field. */
export interface SyncTableDefinition {
  schemaVersion: number;
  encode?: (row: Record<string, unknown>) => string;
  decode?: (value: string) => Record<string, unknown>;
}
export type SyncTableMap = Readonly<Record<string, SyncTableDefinition>>;

/** A raw connection must not install mutation interception. */
export type SyncDexieDatabase = Dexie & {
  _sync_outbox: Table<SyncPushChange, string>;
};

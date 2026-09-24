import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";
export * from "./auth-schema";

export const fileStorage = sqliteTable(
  "file_storage",
  {
    id: text("id").notNull(), // xxh64:<16 lowercase hexadecimal characters>
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    fileSize: integer("file_size").notNull(),
    mediaType: text("media_type").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index("file_storage_user_active_created_idx").on(
      t.userId,
      t.deletedAt,
      t.createdAt,
    ),
  ],
);

export const fileStorageRelations = relations(fileStorage, ({ one }) => ({
  user: one(user, {
    fields: [fileStorage.userId],
    references: [user.id],
  }),
}));

/**
 * Sync v2 stores one compacted LWW winner for each opaque user key.
 * Application schemas and value decoding remain client responsibilities.
 */
export const syncRecord = sqliteTable(
  "sync_records",
  {
    serverSeq: integer("server_seq").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    hlcWallTimeMs: integer("hlc_wall_time_ms").notNull(),
    hlcCounter: integer("hlc_counter").notNull(),
    deviceId: text("device_id").notNull(),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull(),
  },
  (t) => [
    unique("sync_records_user_key_unique").on(t.userId, t.key),
    index("sync_records_user_seq_idx").on(t.userId, t.serverSeq),
  ],
);

export const syncRecordRelations = relations(syncRecord, ({ one }) => ({
  user: one(user, {
    fields: [syncRecord.userId],
    references: [user.id],
  }),
}));

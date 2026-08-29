import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

// Re-export auth tables from auto-generated schema
export * from "./auth-schema";

// Add your custom tables below this line

/**
 * Tracks devices that have accessed the app.
 * A device is identified by a client-generated UUID stored in localStorage.
 * This is separate from sessions - devices persist across logins/logouts.
 */
export const userDevice = sqliteTable(
  "user_devices",
  {
    id: text("id").primaryKey(), // UUID generated server-side
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(), // The device ID from localStorage
    deviceName: text("device_name"), // Friendly name like "Chrome on macOS"
    browser: text("browser"),
    os: text("os"),
    deviceType: text("device_type"), // mobile, tablet, or desktop
    lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [unique("user_client_unique").on(t.userId, t.clientId)],
);

export const userDeviceRelations = relations(userDevice, ({ one }) => ({
  user: one(user, {
    fields: [userDevice.userId],
    references: [user.id],
  }),
}));

/**
 * Generic file storage table for managing uploaded files.
 * Stores metadata and R2 references for any type of file.
 */
export const fileStorage = sqliteTable(
  "file_storage",
  {
    id: text("id").primaryKey(), // UUID generated server-side
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Content hash - the canonical identifier for the file content
    contentHash: text("content_hash").notNull(), // xxhash64 hex

    // File type identifier (e.g., 'epub', 'cover', 'pdf', etc.)
    fileType: text("file_type").notNull(),

    // R2 storage key
    r2Key: text("r2_key").notNull(),

    // File metadata
    fileName: text("file_name"),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),

    // Additional metadata (JSON blob for flexibility)
    metadata: text("metadata", { mode: "json" }).$type<{
      [key: string]: unknown;
    }>(),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }), // soft delete
  },
  (t) => [
    // Prevent duplicate files per user and type
    unique("user_content_hash_type_unique").on(
      t.userId,
      t.contentHash,
      t.fileType,
    ),
    // Index for efficient queries
    index("idx_files_user_updated").on(t.userId, t.updatedAt),
    index("idx_files_user_content_hash").on(t.userId, t.contentHash),
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

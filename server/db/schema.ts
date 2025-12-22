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
 * Generic sync data table for HLC-based sync.
 * Stores all synced entities with their HLC timestamps for last-write-wins resolution.
 */
export const syncData = sqliteTable(
  "sync_data",
  {
    id: text("id").notNull(),
    tableName: text("table_name").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    entityId: text("entity_id"), // For entity-scoped sync (e.g., bookId for highlights)
    hlc: text("hlc").notNull(), // Hybrid Logical Clock timestamp
    deviceId: text("device_id").notNull(), // Client device ID
    isDeleted: integer("is_deleted", { mode: "boolean" })
      .default(false)
      .notNull(),
    serverTimestamp: integer("server_timestamp", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)
      .notNull(),
    data: text("data", { mode: "json" }).notNull(), // JSON blob of the entity data
  },
  (t) => [
    primaryKey({ columns: [t.tableName, t.userId, t.id] }),
    // Index for pulling changes
    index("idx_sync_pull").on(t.tableName, t.userId, t.serverTimestamp),
    // Index for entity-scoped pulls
    index("idx_sync_entity").on(
      t.tableName,
      t.userId,
      t.entityId,
      t.serverTimestamp,
    ),
  ],
);

export const syncDataRelations = relations(syncData, ({ one }) => ({
  user: one(user, {
    fields: [syncData.userId],
    references: [user.id],
  }),
}));

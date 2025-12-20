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
 * Stores book metadata for syncing across devices.
 * The fileHash (xxhash64) is the canonical sync identifier - same EPUB file
 * on different devices will have the same hash and auto-merge.
 */
export const book = sqliteTable(
  "books",
  {
    id: text("id").primaryKey(), // UUID generated server-side
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileHash: text("file_hash").notNull(), // xxhash64 hex - the sync key

    // Book metadata
    title: text("title").notNull(),
    author: text("author").notNull(),
    fileSize: integer("file_size").notNull(),

    // R2 references (null until uploaded)
    epubR2Key: text("epub_r2_key"),
    coverR2Key: text("cover_r2_key"),

    // Additional metadata (JSON blob for flexibility)
    // Contains: publisher, language, isbn, description, etc.
    metadata: text("metadata", { mode: "json" }).$type<{
      publisher?: string;
      language?: string;
      isbn?: string;
      description?: string;
      publishedDate?: string;
      [key: string]: unknown;
    }>(),

    // Timestamps for sync
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }), // soft delete
  },
  (t) => [
    // Prevent duplicates per user - this is the merge key
    unique("user_file_hash_unique").on(t.userId, t.fileHash),
    // Index for efficient sync queries
    index("idx_books_user_updated").on(t.userId, t.updatedAt),
  ],
);

export const bookRelations = relations(book, ({ one }) => ({
  user: one(user, {
    fields: [book.userId],
    references: [user.id],
  }),
}));

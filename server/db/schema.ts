import { relations, sql } from "drizzle-orm";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
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

// Re-export auth tables from auto-generated schema
export * from "./auth-schema";

// Add your custom tables below this line
// Example:
// export const books = sqliteTable("books", {
//   id: text("id").primaryKey(),
//   title: text("title").notNull(),
//   userId: text("user_id")
//     .notNull()
//     .references(() => user.id, { onDelete: "cascade" }),
//   createdAt: integer("created_at", { mode: "timestamp_ms" })
//     .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
//     .notNull(),
// });

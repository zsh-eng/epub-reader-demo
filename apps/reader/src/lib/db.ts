/**
 * Application data entry point. Domain types and persistence functions live in
 * src/data; the Dexie schema and sync connections remain in lib/sync-v2/db.ts.
 */
export { db } from "@/data/database";
export * from "@/data/books";
export * from "@/data/book-content";
export * from "@/data/reading-checkpoints";
export * from "@/data/reading-sessions";
export * from "@/data/reading-settings";
export * from "@/data/highlights";
export * from "@/data/notes";
export * from "@/data/reading-state";

export * from "@/data/note-drafts";

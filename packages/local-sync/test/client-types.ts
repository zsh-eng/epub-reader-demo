import type { HybridLogicalClock } from "../src/client/index.js";
import type { SqlDriver } from "../src/adapters/sqlite/index.js";
import { createSqliteSyncClient } from "../src/adapters/sqlite/index.js";
import {
  defineSyncSchema,
  integer,
  syncedTable,
  table,
  text,
} from "../src/schema/index.js";

const schema = defineSyncSchema({
  books: syncedTable({
    id: text().primaryKey(),
    title: text().notNull(),
    pageCount: integer(),
  }),
  localFiles: table({
    id: integer().primaryKey(),
    path: text().notNull(),
  }),
});

declare const driver: SqlDriver;
declare const clock: HybridLogicalClock;
const client = createSqliteSyncClient({ schema, driver, clock });

void client.put("books", {
  id: "book-1",
  title: "Example",
  pageCount: null,
});
void client.putMany("books", [
  { id: "book-1", title: "First", pageCount: 100 },
  { id: "book-2", title: "Second", pageCount: null },
]);
void client.delete("books", "book-1");

// @ts-expect-error Local-only tables are excluded from the sync client API.
void client.put("localFiles", { id: 1, path: "/book.epub" });
void client.put("books", {
  id: "book-1",
  title: "Example",
  // @ts-expect-error Integer columns do not accept strings.
  pageCount: "100",
});

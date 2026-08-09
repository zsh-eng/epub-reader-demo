import {
  integer,
  jsonText,
  real,
  syncedTable,
  table,
  text,
} from "../src/schema/index.js";

table({
  id: integer().primaryKey(),
  value: real(),
  metadata: jsonText(),
});

syncedTable(
  // @ts-expect-error Synced tables must use a text primary key.
  {
    id: integer().primaryKey(),
  },
);

syncedTable(
  {
    id: text().primaryKey(),
    optionalBookId: text(),
  },
  {
    // @ts-expect-error Scope IDs must use a non-null text column.
    scopeId: "optionalBookId",
  },
);

// @ts-expect-error Real columns are not supported as primary keys.
real().primaryKey();
// @ts-expect-error JSON-text columns are not supported as primary keys.
jsonText().primaryKey();

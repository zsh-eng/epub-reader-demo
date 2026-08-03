# @zsh-eng/local-sync

Storage-agnostic building blocks for local-first applications.

This package is being built incrementally inside the EPUB reader monorepo. The
first slice contains only the schema definition language: enough to describe
local query tables, inspect plain metadata, and infer row types.

```ts
import {
  defineSyncSchema,
  table,
  text,
  type InferTableRow,
} from "@zsh-eng/local-sync/schema";

const schema = defineSyncSchema({
  books: table({
    id: text().primaryKey(),
    title: text().notNull(),
    author: text().notNull().index(),
  }),
});

type Book = InferTableRow<(typeof schema.tables)["books"]>;
```

The package does not yet generate database tables, intercept writes, resolve
conflicts, communicate with a server, or manage blobs. Those capabilities will
be added as separate, reviewable changes.

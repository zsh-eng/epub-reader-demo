# @zsh-eng/local-sync

Storage-agnostic building blocks for local-first applications.

This package is being built incrementally inside the EPUB reader monorepo. It
currently contains the schema definition language and the storage-neutral data
contracts that future client, server, and adapter modules will share.

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

The core package distinguishes local records from server-sequenced records:

```ts
import type { SequencedSyncRecord, SyncRecord } from "@zsh-eng/local-sync/core";

const localChange: SyncRecord<Book> = {
  tableName: "books",
  recordId: "book-1",
  operation: "put",
  payload: { id: "book-1", title: "Example", author: "A. Reader" },
  hlc: "1722732000000:0",
  deviceId: "device-1",
  schemaVersion: 1,
};

declare const remoteChange: SequencedSyncRecord<Book>;
remoteChange.serverSeq;
```

The HLC contains only `<wallTimeMs>:<logicalCounter>`. `deviceId` is stored once
as a separate field and is used as the final deterministic tie-breaker when both
HLC components match. Implementations must compare the parsed numeric tuple,
not the encoded strings directly.

Deletes use `operation: "delete"` and carry no payload. Blob bytes also stay
outside sync records; payloads can refer to them with `BlobRef` from the `/blob`
entrypoint.

These interfaces describe semantic records, not a required JSON encoding. An
HTTP transport may infer the user and app from request context, group records by
table, and compress batches without changing the core model.

The package does not yet generate database tables, intercept writes, resolve
conflicts, communicate with a server, or manage blobs. Those capabilities will
be added as separate, reviewable changes.

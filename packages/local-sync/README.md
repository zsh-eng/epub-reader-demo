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
  hlc: { wallTimeMs: 1_722_732_000_000, counter: 0 },
  deviceId: "device-1",
  schemaVersion: 1,
};

declare const remoteChange: SequencedSyncRecord<Book>;
remoteChange.serverSeq;
```

The HLC is a structured `{ wallTimeMs, counter }` value. `deviceId` is stored
once as a separate field and is used as the final deterministic tie-breaker when
both HLC components match. Local and server SQLite tables can map the two HLC
numbers directly to integer columns.

Deletes use `operation: "delete"` and retain the complete domain payload. Both
client and server keep the materialized row so a future write can restore it;
normal local queries hide it using the accompanying tombstone metadata. Blob
bytes still stay outside sync records, and payloads can refer to them with
`BlobRef` from the `/blob` entrypoint.

These interfaces describe semantic records, not a required JSON encoding. An
HTTP transport may infer the user and app from request context, group records by
table, and compress batches without changing the core model.

Storage adapters use a deliberately small asynchronous SQLite boundary:

```ts
import type { SqlDriver } from "@zsh-eng/local-sync/adapters/sqlite";

async function findBook(driver: SqlDriver, id: string) {
  const rows = await driver.all<Book>(
    "select id, title, author from books where id = ?",
    [id],
  );
  return rows[0];
}

await driver.transaction(async (transaction) => {
  await transaction.run("update books set title = ? where id = ?", [
    "Updated",
    "book-1",
  ]);
});
```

Tests can use `FakeSqlDriver` from `/adapters/sqlite/testing` to queue results
and inspect issued statements without depending on a SQLite runtime. The fake
does not parse SQL or emulate database behavior. A separate Bun-only conformance
test exercises this interface against real in-memory SQLite, including
multi-row LWW UPSERT and atomic domain/sidecar transactions; its driver remains
test support rather than a package export.

Web apps can open the published sqlite-wasm adapter:

```ts
import { createSqliteWasmDriver } from "@zsh-eng/local-sync/adapters/sqlite-wasm";

const db = await createSqliteWasmDriver({
  filename: "/ebook-reader.sqlite3",
});
```

The adapter runs SQLite in a dedicated module worker and uses durable OPFS
storage by default. It does not silently fall back to memory when OPFS is
unavailable. Hosts must send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`; call `db.close()` when the app no
longer needs the worker.

The package does not yet generate database tables, intercept writes, resolve
conflicts, communicate with a server, or manage blobs. Those capabilities will
be added as separate, reviewable changes.

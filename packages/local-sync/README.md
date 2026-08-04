# @zsh-eng/local-sync

Storage-agnostic building blocks for local-first applications.

This package is being built incrementally inside the EPUB reader monorepo. It
currently contains the schema definition language and the storage-neutral data
contracts that future client, server, and adapter modules will share. It can
also initialize the corresponding local SQLite tables and sync sidecars.

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

The client assigns the structured HLC `{ wallTimeMs, counter }` before syncing.
Its logical counter preserves local ordering when physical time does not advance
or moves backwards. `deviceId` is stored once as a separate field and is the
final deterministic tie-breaker. The server separately assigns `serverSeq` only
after accepting a version into its catch-up stream.

Deletes use `operation: "delete"` and retain the complete domain payload. Both
client and server keep the materialized row so a future write can restore it;
normal local queries hide it using the accompanying tombstone metadata. Blob
bytes still stay outside sync records, and payloads can refer to them with
`BlobRef` from the `/blob` entrypoint.

These interfaces describe semantic records, not a required JSON encoding. An
HTTP transport may infer the user and app from request context, group records by
table, and compress batches without changing the core model.

The framework-neutral server coordinator operates on a generic latest-state bag
of rows:

```ts
import { SyncServer } from "@zsh-eng/local-sync/server";
import { InMemoryServerSyncStorage } from "@zsh-eng/local-sync/server/testing";

const server = new SyncServer<Book>(new InMemoryServerSyncStorage<Book>());

const pushed = await server.push({
  appName: "ebook-reader",
  userId: "user-1",
  deviceId: "device-1",
  records: [localChange],
});

const page = await server.pull({
  appName: "ebook-reader",
  userId: "user-1",
  cursor: 0,
});
```

The in-memory implementation is test support. A production adapter implements
`ServerSyncStorage`: it atomically applies LWW per logical row, assigns a new
global `serverSeq` only to accepted writes, and scans rows in sequence order.
Every push outcome returns the current winner, including when an older candidate
is rejected. Pulls support whole-app, table, and table-plus-scope cursors and do
not exclude records written by the requesting device.

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

Initialize app tables and the shared `sync_meta` and `sync_cursors` sidecars
from the same schema:

```ts
import {
  generateSqliteSchema,
  initializeSqliteSchema,
} from "@zsh-eng/local-sync/adapters/sqlite";

const statements = generateSqliteSchema(schema);
await initializeSqliteSchema(db, schema);
```

`generateSqliteSchema()` returns frozen, inspectable SQL statements. Declared
table and column names are quoted and preserved exactly; there is no implicit
camelCase-to-snake_case conversion. `initializeSqliteSchema()` executes those
statements in one transaction and can be called repeatedly for initialization.
It uses `CREATE ... IF NOT EXISTS`, so it does not migrate an existing table
when a schema definition changes. Applications may use this on each database
open while prototyping. Before a production schema evolves, the generated
initial statements should be frozen as migration 1 and startup should move to
ordered, checked-in migrations tracked by a local migration table. The migration
history and database-side checksums are the initial source of truth; a separate
schema lockfile is only needed later if migration generation becomes automatic.

The package does not yet intercept local writes, implement a production server
storage adapter or HTTP transport, perform client sync orchestration, or manage
blob transfers. Those capabilities will be added as separate, reviewable
changes.

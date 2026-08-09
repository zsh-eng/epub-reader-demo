# Local Sync Benchmarks

This file records repeatable performance baselines for the local sync package.
Results are directional rather than universal: storage engines, browser builds,
device power state, payload width, and dataset shape can materially change them.

## SQLite `putMany()` Baseline

Measured on 2026-08-09 against the PR10a implementation. No benchmark harness
or instrumentation is included in the package; the temporary scripts were
removed after collecting the results.

### Environment

- MacBook Pro `MacBookPro18,3` (`MKGP3ZP/A`)
- Apple M1 Pro, 8 CPU cores (6 performance and 2 efficiency)
- 16 GB memory
- macOS 26.5.1, build `25F80`
- Bun 1.3.5
- `@sqlite.org/sqlite-wasm` `3.53.0-build1`, SQLite runtime 3.53.0
- Playwright 1.59.1
- Bundled Chromium 147.0.7727.15
- Bundled Firefox 148.0.2

Power state, thermals, and unrelated background load were not controlled. Bun
used an in-memory database and should be read as a lower-bound SQL reference.
The browser runs used sqlite-wasm in a dedicated worker with a fresh OPFS-backed
database.

### Method

The schema contained one synced table with a text primary key and one required
text value: `benchmark_books(id, title)`. Each sample inserted fresh unique rows
through `SqliteSyncClient.putMany()` at batch sizes 1, 10, 100, and 500.

Timing began immediately before awaiting `putMany()` and ended when it resolved.
It therefore included:

- schema-based row validation
- one durable `tickMany()` HLC reservation
- one domain-plus-`sync_meta` transaction
- one metadata UPSERT with `RETURNING` and one domain UPSERT per row
- SQLite commit and, in browsers, worker-message and OPFS overhead

It excluded schema initialization, JavaScript row construction, network
transport, server processing, response decoding, and pending-record reads. A
25-row warm-up ran before measurement. Bun results are medians of seven samples;
browser results are medians of five samples.

### Results

| Rows | Bun SQLite memory | Chromium OPFS | Firefox OPFS |
| ---: | ----------------: | ------------: | -----------: |
|    1 |           0.07 ms |       26.9 ms |      82.6 ms |
|   10 |           0.33 ms |       24.7 ms |      82.4 ms |
|  100 |           2.93 ms |       47.7 ms |     145.6 ms |
|  500 |          13.52 ms |      122.5 ms |     307.9 ms |

The Chromium 500-row samples ranged from 116.6 to 202.7 ms. Firefox ranged from
301.3 to 349.6 ms. Browser results show a meaningful fixed transaction cost,
but the current per-row statements remain comfortably sub-second at the
package's 500-record batch limit on this machine. This baseline does not justify
adding multi-row SQL or a cross-driver batch abstraction yet.

## Future Fresh-Sync Comparison

The flashcard workload should become the larger, representative benchmark. Use
an anonymized real corpus when available and keep a deterministic synthetic
generator for regression testing. Synthetic tiers should include at least
10,000, 50,000, and 100,000 small records with realistic field widths, scopes,
JSON text, updates, and tombstones.

Compare these storage implementations using equivalent sync semantics:

- sqlite-wasm with OPFS
- IndexedDB, initially using the existing Dexie-based application path
- Expo SQLite on representative iOS and Android hardware

An IndexedDB comparison must atomically maintain both domain data and equivalent
sync metadata. Comparing SQLite's complete sync write with a raw IndexedDB
`bulkPut()` would not answer the product question.

Measure local application separately from the end-to-end fresh sync:

1. Database open and schema initialization.
2. Wire decode and payload validation.
3. Local apply time by batch size, including HLC and metadata writes.
4. Total fresh-sync time from request start until all rows are queryable.
5. First representative query after bootstrap.
6. Database size, sync-metadata overhead, and peak memory.
7. Incremental update and tombstone-heavy runs after the initial load.

Run cold and warm trials, use at least five measured samples, and report median,
p95, and range. Keep network time visible but separate so storage regressions do
not disappear inside transport variance.

Before optimizing, establish targets on the actual flashcard corpus and slower
target devices. Optimization becomes worthwhile when local application is a
material fraction of fresh-sync wall time or a 500-row batch regularly exceeds
the brief-connectivity budget. Candidate experiments are chunked multi-row
UPSERTs, JSON-expanded input, and storage-specific bulk APIs; each should be
measured against this simple transactional implementation.

# Restore transport benchmark

Run from the Spaced repository:

```sh
bun scripts/sync-benchmark/server.ts path/to/converted/backend.sqlite
```

Open `http://127.0.0.1:5277/` and click **Run comparison**. The server reads the
largest account in the supplied migrated snapshot. It binds only to loopback,
rejects other Host/Origin values, and does not contact production. It serves
private record contents locally; stop the server after use. Results are saved to
`cutover.local/sync-benchmark-results.json` (ignored by Git). Create that directory
before running if it does not exist.
Summarize the results with `bun scripts/sync-benchmark/summarize.ts`.

Each run uses a new disposable IndexedDB and a separate localStorage state key.
The benchmark deletes only its own database and state key after each run.

## Comparison

- **current**: installed `SyncClient.pull()`, 500 records per HTTP request, actual
  `DexieSyncStorage` and Spaced decoders. Includes both existing envelope checks.
- **stream-500**: one compressed NDJSON response; each frame contains the same
  500-record envelope. Read ahead while one database transaction runs, but keep
  each write at 500 records.
- **stream-adaptive**: same stream; drain up to eight queued frames per write.
  Frames that arrive during a write become the next batch. Never reapply an
  already committed prefix.

The application queue is limited to eight frames and 4 MiB of serialized JSON.
There can also be one active write batch, a frame being decoded, and browser
network buffers. `peakQueueJsonBytes` is **not** a JavaScript heap measurement.
The reader stops consuming when the queue is full. Each completed write advances
its cursor; receipt of a frame alone does not advance the durable cursor.

Run each mode three times at 0 and 100 ms of injected response delay. Rotate mode
order between repetitions. The delay is a controlled per-request delay, not a
measurement of the user's connection. There is no bandwidth throttle.

The timed section includes download/decompression, validation, domain decoding,
HLC updates, database writes, and cursor checkpoints. It excludes database setup,
authentication, pushes, final MemoryDB rebuild, and correctness verification.
After timing, compare every stored row with the snapshot's decoded record, verify
record count and final cursor, and verify that the outbox is empty.

## Limits

The fixture preloads and precompresses data. It isolates browser and transport
costs; it does not measure D1 queries, Worker serialization, live streaming
compression, proxy buffering, or Cloudflare limits. All modes use the same data
and validators. Do not report these measurements as production end-to-end times.

This is an experimental benchmark, not a production streaming client/server.
Before package adoption, add cancellation/failure propagation, resume and
account-change tests, transaction failure tests, stream truncation tests, slow
consumer tests, and pending-local-write conflict tests. Measure real Worker
streams and mobile browsers. Production server reads must also be bounded; do
not copy the fixture's full-dataset preload into the Worker.

## Larger batch comparison

Click **Run batch-size comparison** to run 500-, 5,000-, and 20,000-record
batches, three times each in rotated order. The earlier comparison button keeps
its original matrix. Results are saved separately to
`cutover.local/sync-benchmark-batches.json`. Summarize them with:

```sh
bun scripts/sync-benchmark/summarize.ts cutover.local/sync-benchmark-batches.json
```

- `stream-fixed-N`: one response, no injected delay. Wait for N records before
  each write (except the final partial batch). Use the same producer/writer at
  every size to isolate write batch size. The queue allows at least N records
  and has a 32 MiB JSON limit; if the byte limit is reached, flush early.
- `paged-N`: 100 ms of delay per request. Each response contains up to N records,
  and all its records go into one database transaction. The fixture groups
  existing 500-record envelopes in an outer array, retaining both validation
  passes. This is an experimental larger-page transport, not the installed
  library's current protocol (which limits pages to 500 records).

This separates larger writes in a stream from larger network responses. The
second comparison changes both request and write sizes; it does not isolate
network-page size alone. `maxPrepareMs` records the longest synchronous domain
prepare call. `maxWriteMs` records the longest awaited write; it is not a measure
of continuous UI blocking. The dataset and verification procedure are unchanged.

If a page is interrupted, restart with
`bun scripts/sync-benchmark/server.ts --cleanup-only`, open the same loopback URL,
and click **Clean interrupted benchmark databases**. This removes only databases
whose names start with `SpacedSyncBenchmark-` in that origin. No snapshot is read
in this mode. Stop other benchmark tabs before cleanup.

## Installed-package integration check

Click **Check installed package** to use the installed SyncClient, Spaced's real
HTTP transport, and the package's Hono/D1 SQL adapter against the read-only
snapshot. Authentication is a loopback-only fixture for the largest account.
The real streaming encoder and negotiated gzip run during the check; the other
benchmark routes retain their precompressed fixtures. Every stored row is still
verified. Results go to `cutover.local/sync-package-check.json`. The prototype
queue counters are not instrumented in package mode.

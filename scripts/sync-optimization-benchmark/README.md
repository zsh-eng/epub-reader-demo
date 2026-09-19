# Combined sync optimization benchmark

Run from the Spaced root:

```sh
bun test ./scripts/sync-optimization-benchmark/outbox.test.ts
bun scripts/sync-optimization-benchmark/server.ts
```

Open `http://127.0.0.1:5291/` in Chrome and click **Run optimization matrix**.
The source is the read-only converted snapshot at
`cutover.local/converted/backend.sqlite`. The server binds only to loopback and
rejects other Host/Origin values. It never contacts production.

## Common path

Every case uses the installed Hono endpoint, its local SQLite adapter, 500-record
and byte-bounded pages, 32-page response windows, live gzip and Spaced's actual
HTTP stream decoder. The application domain schema is transformed in the bundle
only: Zod 4.6.5, discriminated union, one strict compiled parse. The isolated Zod
dependency is in `legacy-sync-benchmark.local/benchmark/zod/node_modules`.
Application source, package manifests and installed application packages do not
change. Schema compilation is outside timing.

A benchmark pull coordinator buffers remote pages while Dexie commits the
current batch. It validates sequence order, fixed head, final cursor and clean
stream completion. It uses the real DexieSyncStorage, HLC updates and state
store. Each cursor checkpoint follows its successful apply transaction.
Bootstrap completes only after the final clean stream and all writes finish.
This coordinator is experimental; it is not the installed SyncClient's fixed
500-record apply loop. It adds serialized-JSON queue-size accounting, so the
old saved baseline is a reference rather than an exact one-variable comparison.

Timed work includes live local server reads/compression, transfer, protocol and
domain validation, HLC, pending-edit checks, IndexedDB commits and cursor writes.
It excludes DB setup, auth, pushes, schema compilation, final MemoryDB rebuild
and correctness verification. No latency or bandwidth limit is injected.

## Six configurations

1. Fixed target 500 records per write.
2. Fixed target 5,000 records per write.
3. Fixed target 20,000 records per write.
4. Adaptive: immediately drain available pages, up to eight pages and 4 MiB of
   queued serialized JSON. Do not wait to fill a target batch.
5. Fixed 500 plus the empty-outbox optimization.
6. Adaptive plus the empty-outbox optimization.

Fixed-size queues allow enough pages for the target and at most 32 MiB. Server
pages can contain fewer than 500 records because of the server byte limit, so
actual write sizes can be below the target. Measured maxima are in the results.
Queue peaks exclude the active write, one producer-held page, browser network
buffers and object overhead. They are not heap measurements. `maxPrepareMs`
measures synchronous domain preparation; `maxWriteMs` includes async waiting and
can overlap incoming-page parsing. Phase durations are not additive CPU costs.

The outbox experiment intercepts the table's `bulkGet` within the library's
existing read-write transaction. If `count()` is zero, it returns absent entries
without individual gets; otherwise it calls the unchanged bulk lookup and
version logic. No empty result is cached between transactions. Tests cover
empty restore, pending newer local data, a newly nonempty outbox and rollback.
This is a candidate library change, not a deployed implementation.

## Repetitions and checks

Three rounds rotate configuration order. The run stops after a verified sample
if one-minute host load exceeds 20. **Stop after current run** keeps that run's
verification; **Abort active run** cancels immediately. Samples include host load
and all slower samples are retained. A partial matrix must be reported as such.

Every restore starts with a new disposable DB and unique state key. After timing,
all 97,266 saved rows are compared with an independent plain fixture decoded by
the same validated domain schema. Record count, final cursor, bootstrap and empty
outbox are checked. The DB and state are removed in `finally`.

Results: `cutover.local/optimizations/results.json`. Old-engine and baseline
numbers are read from previous reports; those engines are not rerun.

After interruption, use **Cleanup**, or restart the server with `--cleanup-only`
and use the same button. It only removes `SpacedOptimizationBenchmark-*` databases
on this origin. Stop the server and close benchmark tabs after use.

For an adaptive-empty-outbox trace only, open `/?trace`. Add `&native` to time
native IndexedDB put submission (this adds per-record timer overhead). Each mode
runs three verified restores and writes `trace-results.json`, preserving the
matrix results. `SYNC_BENCH_PORT` overrides the default port. See
`docs/SYNC_RESTORE_TRACE.md` for the measured split and overlap limits.

## Candidate matrix (indexes, row format, page processing, scheduling)

Open `/?candidates` for six cases, three rotated rounds (18 restores):

- `baseline`: adaptive eight-page queue, empty-outbox shortcut, compiled Zod 4.
- `no-secondary-indexes`: retain primary keys; omit type/timestamp indexes.
- `json-rows`: retain all indexes; store `{id,type,timestamp,value}` with the full
  row encoded as JSON in `value`. Encoding is included in restore time. This
  tests less object traversal during cloning, not a smaller byte payload.
- `single-page-processing`: retain parser validation and all sequence/head checks;
  omit the second envelope parse and take exact frame bytes from the parser.
- `yield-every-4-pages`: `setTimeout(0)` after each four enqueued pages.
- `queue-2-pages`: cap queued pages at two instead of eight; same 4 MiB byte cap.

Each candidate changes only its named feature. Byte metadata is attached through
an out-of-band WeakMap in every case by a benchmark-only bundle transform of the
installed stream parser. Frame size, UTF-8, end-marker and schema checks remain.
Neither installed files nor package source is modified.

The extra `loadAndHydrateMs` measures reading both saved tables and restoring
JSON rows through the compiled domain decoder. It is outside restore timing,
but before correctness comparison. It is a warm read, not a full app startup or
MemoryDB rebuild. All hydrated rows are compared with the independently fetched
fixture; date restoration also has a unit test. JSON rows need an application
storage codec before adoption. Index removal needs a query audit and a schema
upgrade. These are measurements, not shipped application changes.

Candidate results are saved separately as
`cutover.local/optimizations/candidate-results.json`.

Open `/?combined` for three rotated repeats of index removal plus single-pass
page processing, with and without the four-page yield, plus a fresh baseline. These nine follow-up runs
write `combination-results.json`. They do not overwrite the individual matrix.
Use `summarize-candidates.py [result-path]` for medians and ranges. Keep the run
range and sample count when reporting results; host load alone does not account
for all browser scheduling noise.

# Adaptive restore trace — 19 September 2026

The remaining time is mainly inside row writes and waits for IndexedDB callbacks.
Final transaction commit is a small cost. An awaited database call is **not** a
measurement of database CPU or disk time: the stream producer also runs while it
is pending.

## Method

Same adaptive empty-outbox candidate, compiled Zod 4 domain decoder, 97,266
records, seven streaming requests, 27 apply transactions, fresh disposable
IndexedDB. Local read-only SQLite and actual Hono/gzip streaming. **No injected
100 ms delay**, no image transfer, no final application in-memory reconstruction.
All six restores passed full saved-row, cursor, bootstrap and empty-outbox checks.
Verification is outside restore timing. No production runtime changed.

Three lightweight traces took **15.227 / 15.697 / 16.157 seconds**, compared with
the earlier 18.817-second median. These are fresh measurements, not a rescaling
of the earlier result. Host and browser variation remain; this does not establish
a further speed improvement.

## Split of the median lightweight run

These elapsed phases partition the 15.697-second restore. They are not CPU samples.

| Phase | Seconds |
| --- | ---: |
| Domain JSON decode, validation and prepared rows | 2.034 |
| Start apply transactions | 0.243 |
| Await empty-outbox count | 3.735 |
| Bulk row writes, through request completion | 8.983 |
| Finish transaction commit after callback | 0.179 |
| Other apply work, including grouping and promise scheduling | 0.319 |
| Consumer wait for available pages | 0.147 |
| HLC observation, cursor save and remaining loop work | 0.058 |
| **Total** | **15.697** |

Page-envelope validation, sequence checks and JSON/UTF-8 buffer-size accounting
ran for **2.155 seconds**. This overlaps the table above: **1.872 seconds** occurs
inside the outbox-count wait and **0.272 seconds** inside bulk-write waits. Do not
add those times to the total. Stream parsing before each yielded page is outside
this producer-work span. SQL, gzip, transport and browser scheduling are not
separately attributed by this trace. The 0.147 seconds is exposed consumer queue
wait, not total network time.

The long count wait is consistent with page processing delaying database callback
handling. It does not prove that counting an empty table itself takes 3.735 seconds.

## Native write probe

A second set adds a timer around each native `IDBObjectStore.put` call. It took
**19.541 / 17.596 / 16.131 seconds**. Each run submitted exactly 97,266 puts; the
synchronous native calls totalled **6.260 / 6.306 / 5.401 seconds**. These times
are already inside bulk-write elapsed time. Native calls include structured
cloning and request submission; this probe cannot separate those costs or native
index maintenance and disk I/O. Per-record timing can perturb the result, so use
the lightweight series for the main split. This is not a calibrated A/B speed test.

## Next experiments

1. Avoid repeated envelope validation where the transport already validated it.
   Replace benchmark JSON reserialization for queue-byte accounting with a byte
   count carried from the parser. Retain frame validation and bounded buffering.
2. Test a bounded producer yield between decoded page groups. Measure whether
   IndexedDB callbacks resume sooner; do not assume every yield improves speed.
3. Profile native write submission and the stored row/index shape. Consider a
   worker to reduce UI blocking; it will not necessarily reduce total restore time.

Keep the outbox check inside every apply transaction. Never cache emptiness across
transactions or advance the cursor before commit to improve a benchmark.

## Reproduce and review

Run `SYNC_BENCH_PORT=5292 bun scripts/sync-optimization-benchmark/server.ts`.
Open `http://127.0.0.1:5292/?trace` and press Run. Add `&native` for the second
probe. Results go to `cutover.local/optimizations/trace-results.json`; the original
matrix file is preserved. Use `python3 scripts/sync-optimization-benchmark/summarize-trace.py`
to summarize spans. The retained raw results are `SYNC_RESTORE_TRACE_RESULTS.json`.
The first-pass collector included a verification count; the summarizer excludes
spans after the final cursor checkpoint. The current collector snapshots spans
before verification.

Review the library README note first, this report second, then `trace.ts`,
`browser.ts`, `server.ts`, `summarize-trace.py`, and the added trace regression test.

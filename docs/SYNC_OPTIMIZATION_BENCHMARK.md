# Combined sync optimizations — 19 September 2026

This experiment measures pipelining plus the improved Zod 4 decoder, several
client write sizes, adaptive batching and an empty-outbox shortcut. It uses the
same 97,266-record account. Old-engine and baseline measurements are reused;
neither baseline was rerun.

## Saved comparison points

| Earlier measurement                                             |     Time | Scope                                                   |
| --------------------------------------------------------------- | -------: | ------------------------------------------------------- |
| Pre-library engine, median of three                             | 12.059 s | Precompressed single response; includes MemoryDB update |
| Existing library stream before decoder changes, median of three | 35.155 s | Live local SQL/gzip; excludes final MemoryDB rebuild    |
| Earlier paginated library, no injected delay                    | 15.128 s | Precompressed fixture, 195 requests                     |
| Earlier paginated library, +100 ms per request                  | 33.859 s | Precompressed fixture, 195 requests                     |

Sources: [historical comparison](../legacy-sync-benchmark.local/benchmark/REPORT.md)
and [initial transport experiment](./SYNC_STREAMING_BENCHMARK.md). The older
single 13.595-second installed-stream check was not reproduced by the subsequent
three-run baseline; it is retained in the earlier report, not substituted here.
These references were measured in earlier sessions under different host load.
Comparisons with them are descriptive, not controlled paired speedups.

## New matrix

Every new case uses Zod 4.6.5, a discriminated union and one strict compiled
domain parse. It also uses the installed HTTP transport and stream decoder,
Hono endpoint, live local SQLite queries/gzip, server page limits and response
windows. A benchmark coordinator changes only the client buffer/write policy.
The coordinator adds queue byte accounting and is not yet production library
code. All cases keep the real DexieSyncStorage conflict/version logic.

The timed section ends after every database commit and the final cursor/bootstrap
checkpoint. Auth, schema compilation, setup, full-row verification and final
MemoryDB rebuild are excluded. No network delay or bandwidth throttle is added.
The actual deployed Cloudflare D1 service is not measured.

All **18 restores passed** full-row verification. Each row below is the median
of three rotated runs. All six configurations made seven HTTP requests; only
client write grouping and outbox reads changed.

| New configuration                     | Median restore |           Range | Write transactions | Per-record outbox reads |
| ------------------------------------- | -------------: | --------------: | -----------------: | ----------------------: |
| Streaming + compiled Zod 4, fixed 500 |       28.683 s | 25.903–29.137 s |                202 |                  97,266 |
| Same, fixed 5,000                     |       25.887 s | 20.879–26.432 s |                 21 |                  97,266 |
| Same, fixed 20,000                    |       22.992 s | 21.599–27.022 s |                  6 |                  97,266 |
| Same, adaptive                        |       20.889 s | 20.750–21.057 s |                 27 |                  97,266 |
| Fixed 500 + empty-outbox shortcut     |       19.340 s | 18.998–20.722 s |                202 |                       0 |
| Adaptive + empty-outbox shortcut      |   **18.817 s** | 16.075–18.939 s |                 27 |                       0 |

Raw samples: [SYNC_OPTIMIZATION_BENCHMARK_RESULTS.json](./SYNC_OPTIMIZATION_BENCHMARK_RESULTS.json).
The separate initial sample is retained in
[SYNC_OPTIMIZATION_CONTENDED_RESULTS.json](./SYNC_OPTIMIZATION_CONTENDED_RESULTS.json).
After the restart, observed one-minute load at sample completion ranged from
7.24 to 13.32. All slower completed samples remain in the medians and ranges.

### Interpretation

- Pipelining and the improved compiled decoder with 500-record writes measured
  28.7 seconds, compared with the saved 35.2-second stream baseline.
- Adaptive writes were faster and more consistent than fixed 5,000- or
  20,000-record targets in this matrix. They commit available pages instead of
  waiting to fill a large target, while bounding the queue.
- The outbox shortcut removed 97,266 individual lookups. It performed 202 count
  requests with fixed 500, or 27 with adaptive writes. Fixed 500 improved from
  28.7 to 19.3 seconds; adaptive improved from 20.9 to 18.8 seconds.
- The best median is still above the old engine's saved 12.1 seconds. The old
  fixture excluded SQL/serialization/compression and included the memory update;
  this test includes local SQL/compression and excludes final memory rebuild.
  Do not assign the entire remaining difference to the library or compare these
  as equal-work production measurements.

### Responsiveness and buffer cost

| Configuration        | Longest synchronous prepare call across three runs | Peak queued JSON |
| -------------------- | -------------------------------------------------: | ---------------: |
| Fixed 500            |                                             567 ms |          0.41 MB |
| Fixed 5,000          |                                             581 ms |          4.11 MB |
| Fixed 20,000         |                                             590 ms |         15.71 MB |
| Adaptive             |                                             246 ms |          3.29 MB |
| Fixed 500 + shortcut |                                             197 ms |          0.41 MB |
| Adaptive + shortcut  |                                             967 ms |          3.29 MB |

These are observed maxima, including runtime scheduling/GC effects, not typical
latencies or pure validation CPU time. The adaptive-shortcut outlier occurred in
its second run. We did not collect a UI frame-time trace or isolate its cause.

The highest-throughput candidate is adaptive plus the shortcut. However, its
median advantage over fixed 500 plus the shortcut is only **0.52 seconds**. The
fixed-500 shortcut is a conservative first implementation: much smaller queued
data, simpler batching, and a lower observed worst preparation pause. Adopt
adaptive batching only after checking UI responsiveness with an actual app
restore. Do not increase the server page limit to achieve these client batches.

## Correctness and limitations

After each timed restore, compare every saved row against the snapshot, and
check record count, final cursor, bootstrap state and empty outbox. Four focused
tests verify that the outbox check shares the apply transaction, preserves a
newer pending local edit, rechecks a newly nonempty outbox and rolls back a
failed write. These tests establish the benchmark shortcut's basic behavior;
they are not a substitute for library integration tests before adoption.

The outbox shortcut adds one count request per write transaction. Only when that
count is zero does it omit individual key lookups. If pending edits exist, the
unchanged bulk lookup and version comparison still run. The empty state is not
cached between transactions. New writes from other connections serialize with
the same IndexedDB write transaction.

Fixed batch targets are 500, 5,000 and 20,000 records. Server byte limits can
produce smaller pages, so a fixed number of grouped pages can contain fewer than
the target. Adaptive mode immediately drains available pages, up to eight pages
and a 4 MiB queue. It does not wait for a full batch. Queue peaks count serialized
JSON, excluding active writes, one producer-held page and browser buffers. They
are not heap measurements. Awaited write time can overlap incoming-page work.

The first attempt overlapped unrelated Swift builds. Load exceeded 115, browser
control detached and only one sample completed: fixed 500 at 33.361 seconds.
That sample is kept separately as contended evidence and is not mixed into the
restarted matrix. The user then confirmed the builds had finished. Process
inspection found no Swift compiler in the top CPU users; the matrix restarted
once one-minute load fell below 20.

## Review order

1. This report and the aggregate raw results.
2. [Methodology](../scripts/sync-optimization-benchmark/README.md).
3. [Producer/consumer and verification](../scripts/sync-optimization-benchmark/browser.ts).
4. [Outbox shortcut](../scripts/sync-optimization-benchmark/outbox.ts) and its
   [correctness tests](../scripts/sync-optimization-benchmark/outbox.test.ts).
5. [Read-only server and decoder transformation](../scripts/sync-optimization-benchmark/server.ts).

No application source, installed application dependency, production data or
production route is changed by this experiment.

Validation: four outbox tests passed (11 assertions), strict TypeScript checking
passed, all 18 browser restores passed full verification, and diff whitespace
checks passed. The benchmark server is stopped; disposable databases were
removed and the completed benchmark tab was closed.

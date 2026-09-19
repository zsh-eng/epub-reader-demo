# Client optimization candidates — 19 September 2026

## Method and scope

27 complete, verified restores: six individual cases repeated three times, then
three combined cases repeated three times. Each set rotates case order. The
combined set includes its own fresh baseline. Each run starts with a disposable
IndexedDB, restores all 97,266 records, and verifies every hydrated row, record
count, final cursor, bootstrap state and empty outbox. All runs use seven HTTP
requests. Verification and table reload are outside restore timing.

The baseline already has streaming, an adaptive eight-page/4 MiB queue, the
transaction-local empty-outbox shortcut, and a single compiled Zod 4 domain parse.
The server reads the same local SQLite snapshot and streams actual gzip output.
There is **no injected 100 ms delay**, bandwidth cap, image transfer, authentication
flow or final app MemoryDB rebuild. These are local browser measurements, not
production latency predictions. No application or library runtime was changed.

## Individual changes

| Case | n | Restore median (s) | Range (s) | Change | Read + hydrate (s) | Writes |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| baseline | 3 | 21.384 | 17.062–22.007 | +0.0% | 1.659 | [27] |
| no-secondary-indexes | 3 | 14.199 | 13.468–23.385 | -33.6% | 1.279 | [27] |
| json-rows | 3 | 22.263 | 17.912–28.104 | +4.1% | 1.835 | [27] |
| single-page-processing | 3 | 18.378 | 13.874–21.056 | -14.1% | 1.704 | [27] |
| yield-every-4-pages | 3 | 19.250 | 15.360–22.058 | -10.0% | 1.765 | [27] |
| queue-2-pages | 3 | 21.637 | 17.157–24.247 | +1.2% | 1.440 | [102, 103] |

- Index removal keeps the primary key and removes only type/timestamp indexes.
- JSON rows retain all indexes and store the full row as a JSON string beside
  index fields. This tests fewer objects to clone, not fewer payload bytes.
  JSON encoding is inside restore timing; decoding is in the read/hydrate column.
- Single-pass processing removes the second envelope schema parse and JSON/UTF-8
  reserialization used for queue accounting. The stream parser still validates
  the envelope and supplies its exact frame byte count through a WeakMap.
  Sequence, fixed-head, size, UTF-8, end-marker and cursor checks remain.
- The yield case uses `setTimeout(0)` after four enqueued pages. The smaller queue
  changes only the page cap, from eight to two, retaining the byte cap.

The table reload measurement is a warm read of both tables plus domain decoding
for JSON rows. It is not a full startup measurement. JSON rows preserve logical
content and Dates, but would require a storage codec in the application.

## Combined changes, with a fresh baseline

| Case | n | Restore median (s) | Range (s) | Change | Read + hydrate (s) | Writes |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| baseline | 3 | 16.466 | 16.238–19.558 | +0.0% | 1.336 | [27] |
| no-indexes+single-pass | 3 | 12.142 | 11.925–13.097 | -26.3% | 1.285 | [27] |
| no-indexes+single-pass+yield4 | 3 | 11.557 | 11.427–13.011 | -29.8% | 1.486 | [27] |

## Interpretation

The fresh baseline median is 16.466 seconds. Index removal plus single-pass
processing takes 12.142 seconds (26.3% lower); adding the yield takes 11.557
seconds (29.8% lower). The yield adds only a 0.585-second median gain, with
overlapping ranges, so it is optional tuning rather than the main recommendation.
Use the combined series to assess the practical gain from index removal and
single-pass processing. Do not add individual savings. Three repetitions are a
small sample, and the ranges show substantial browser/host variation. All slow
samples are retained. Host load checks stayed below the stop threshold; that does
not eliminate scheduling or garbage-collection effects. Medians are observations,
not guaranteed savings or confidence intervals.

The JSON row format and two-page queue do not justify adoption from these results.
The smaller queue needs 102–103 writes instead of 27. Index removal and single-pass
page processing are the useful candidates for implementation. Treat the additional
yield as a separate tuning decision based on its combined range and median.

A source search found `toArray()` reads for MemoryDB and statistics and no current
queries on these type/timestamp indexes. Adoption still requires a database schema
version change and regression checks. The in-memory query model need not change.
The byte-count handoff belongs in the library transport API; removing duplicate
validation requires a clear contract that pages have already been validated.
Keep pending-edit checks and cursor-after-commit ordering.

## Reproduction and review order

1. Read this report and the two adjacent JSON result files.
2. Review `scripts/sync-optimization-benchmark/candidates.ts` for the exact variants
   and experimental row codec, then `candidates.test.ts` for its checks.
3. Review `browser.ts` for queue handling, the timed boundary and verification.
4. Review `server.ts` for the guarded, benchmark-only parser transform and separate
   result files. Installed package files and source are not edited.
5. Read the benchmark README for commands and `summarize-candidates.py` for totals.

Validation: scoped TypeScript check; eight benchmark tests; all 27 browser restores
verified. Temporary databases are deleted after each run. Raw metrics contain no
card content or user identifiers.

## Decision after review

Retain the type and timestamp indexes. The user chose not to adopt index removal
and accepted the measured baseline. All candidate changes remain benchmark-only;
this decision does not install the benchmark coordinator or compiled decoder in
the application. Further performance changes are deferred.

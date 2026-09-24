# Streaming restore experiment — 2026-09-19

## Decision

The optional streaming pull transport is now implemented locally in
`@zsh-eng/local-sync` 0.2.1 and connected to Spaced. It uses one ordered writer
and one page of lookahead. The existing paginated transport is a fallback. The local experiment shows
that removing per-page round trips is useful. Larger write batches alone do not
have a consistent advantage on this dataset.

The original experiment below changed only the benchmark. The implementation
was added afterward; see the final validation section. Production has not been
deployed with this transport.

## Proposed flow

1. The client sends its last committed cursor in one authenticated request.
2. The server captures a pagination head and reads records in bounded pages.
3. It sends complete JSON envelopes as newline-delimited frames in the response.
4. The client validates frames and places new records in a bounded queue.
5. One writer takes queued records, applies them through the existing storage
   adapter, and saves the cursor only after the write succeeds.
6. Records that arrive during the write form the next batch. Stop reading when
   the queue is full; resume when the writer makes room.
7. On disconnect, resume from the committed cursor. Revalidate account ownership
   and retain the existing pending-local-write conflict checks.

Do not repeatedly apply the complete growing array. Remove committed records
from the queue. Do not start concurrent IndexedDB writes to the same tables.
The client can combine network frames, but batch size must remain bounded.

A fixed head bounds pagination; it is not a database snapshot isolated from
concurrent writes. Records updated beyond that head are handled by a later pull,
as in the current protocol.

## Scope and method

Use the migrated snapshot's largest account: 97,266 records, 195 pages of up to
500 records. Run the installed SyncClient and actual Dexie storage adapter, with
Spaced's domain decoder and IndexedDB schema, in Chrome 152 on this Mac.
The streaming variants keep the same envelope and domain validations.

Compare localhost and a controlled 100 ms response delay per request. This delay
is synthetic; it does not measure the user's production connection. No bandwidth
limit is applied. Run each mode three times, rotating mode order.

Each run uses a new disposable database. Outside the timed section, compare every
stored row with its decoded source, check the final count and cursor, verify
bootstrap completion, and check that the outbox is empty.

The server preloads and compresses the snapshot. The measurements include browser
transfer/decompression, validation, domain decoding, HLC updates, IndexedDB writes,
and cursor checkpoints. They exclude authentication, D1, Worker serialization,
compression CPU, pushes, and Spaced's final in-memory rebuild. These are not
production end-to-end restore times.

`writeMs` measures time awaiting the storage adapter. In streaming modes that
interval can overlap with producer parsing on the same JavaScript thread. It
must not be read as isolated disk time or added to other timings to derive total
time.

## Memory and transfer

The queued frames peaked at 4,000 records and about 3.5 MB of serialized JSON.
The queue is capped at eight frames and 4 MiB. There can also be an active write
batch, decoded objects, a partial frame, and browser network buffers. This is a
queue-size measurement, not a browser heap profile.

Precompressed payload sizes were 9,030,618 bytes for separate gzip pages and
8,923,366 bytes for the continuous gzip stream. Thus the expected gain is chiefly
from removing request waits, not from reducing transfer size.

## Original adoption checklist

- Implement domain-independent async frame iteration in the remote interface;
  keep decoding and conflict resolution in the existing storage adapter.
- Give the generic Hono/D1 adapter a bounded streaming response implementation.
  Do not copy the benchmark server's full-dataset preload into the Worker.
- Measure the deployed path for D1 query cost, actual response compression,
  early frame delivery, proxy buffering, resource limits, and cancellation.
- Test disconnect/resume, malformed/truncated frames, a changed head, a failed
  transaction, sign-out/account changes, slow consumers, and local edits while
  records wait in the queue. Ensure producer and consumer failures cancel each
  other without unhandled rejections or a stuck producer.
- Mark bootstrap complete only after a valid terminal frame and committed data.
- Add timing/progress hooks and measure the final Spaced MemoryDB rebuild
  separately. Test mobile browsers before selecting batch-size defaults.

Start with streaming and a small bounded writer batch. Treat adaptive merging
as an optional tuning policy. Moving parsing into a Web Worker could improve UI
responsiveness, but this experiment does not establish a total-time improvement.

## Reproduce and review

1. Read this report and the aggregate measurements below.
2. Read `scripts/sync-benchmark/README.md` for commands and exclusions.
3. Review `scripts/sync-benchmark/browser.ts` for the queue and writer comparison.
4. Review `scripts/sync-benchmark/server.ts` for the local fixture transport.
5. Run `bun scripts/sync-benchmark/summarize.ts` for aggregate timings from the
   private results file.

## Measurements

Median of three runs, with observed ranges in parentheses. All 18 restores
passed full stored-row comparison.

| Method                         |  No injected delay | 100 ms per request | Requests | Writes |
| ------------------------------ | -----------------: | -----------------: | -------: | -----: |
| Current paginated pull         | 15.1 s (14.6–16.9) | 33.9 s (33.4–36.6) |      195 |    195 |
| Stream, 500-record writes      | 15.7 s (14.8–17.0) | 14.5 s (13.7–16.4) |        1 |    195 |
| Stream, combined queued frames | 15.4 s (14.3–16.8) | 13.2 s (13.2–18.2) |        1 |  25–26 |

Raw timing samples: [SYNC_STREAMING_BENCHMARK_RESULTS.json](./SYNC_STREAMING_BENCHMARK_RESULTS.json).
No record contents or account identifiers are included.

The delayed-request medians improved by 2.3× with fixed writes and 2.6× with
combined writes. Localhost medians did not improve. Variation in combined-write
runs is too large to treat the batch policy as a settled performance win.

Validation: strict TypeScript checking passed for all benchmark scripts.

A final smoke check after cancellation cleanup and deferred bootstrap completion
also verified every row: 15.3 s, one request, 25 writes, no injected delay.

## Implemented transport and validation

The package source is in `epub-reader-demo/packages/local-sync`; Spaced imports
the local `vendor/zsh-eng-local-sync-0.2.1.tgz` archive. Both lockfiles reference
that archive. No registry publication or data migration is required.

- `/pull-stream` sends up to 32 pages per response, followed by an explicit end
  marker. Further windows keep the same head and use the committed cursor.
- SQL returns up to 500 records per page, with a 512 KiB raw-data budget and one
  lookahead row. JSON frames are capped at 4 MiB.
- Gzip is streamed when accepted. The server does not build the full snapshot.
- The client prefetches one page while one page commits through Dexie. It checks
  pending local edits at apply time. Cursor writes follow database commits;
  bootstrap completes only after a clean final stream.
- Sign-out/wipe cancellation reaches pending reads. A transaction already in
  progress settles before the host releases its lock and deletes local data.
- A 404/405 stream endpoint falls back to paginated pull, probing only once per
  remote instance. Auth failures and truncated streams do not silently fall back.
- Spaced's in-memory database, domain codecs, FSRS settings, and final memory
  rebuild remain in the application. The shared backend does not know those
  schemas.

Validation completed locally:

- 36 package tests, including SQLite integration, byte bounds, gzip, UTF-8 frame
  boundaries, cancellation, failed writes, truncation/resume, and local edits.
- 623 Reader client tests and 112 Spaced tests. Both application builds passed.
- Package lint and focused Spaced runtime lint passed. Reader's full lint was
  blocked by the pre-existing `article-reader/Resources/reader.js`: checking that
  unchanged file alone reproduced all 751 errors.
- A browser restore using the installed package, actual package SQL, compression,
  Spaced transport and decoder, and real IndexedDB verified all 97,266 records.
  It used 7 HTTP requests and 202 bounded writes, taking 13.6 seconds locally.
  This single integration run is not a production performance prediction. The
  prototype queue counters are not instrumented for this package-mode check.
- A separate local Wrangler/D1 copy passed authentication and gzip checks,
  crossed three response windows, and verified 40 newly inserted large opaque
  fixture records. The fixture session was revoked. No production data was
  modified.

A live deployment check and mobile-browser measurements remain open.

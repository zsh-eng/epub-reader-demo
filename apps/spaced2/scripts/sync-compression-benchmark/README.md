# Compression experiment

Read the converted production snapshot locally. Do not connect this fixture to
production. All data files are written under ignored `cutover.local/compression`.
Reports contain only aggregate counts, sizes and timing samples.

## SQLite, codec and wire checks

Run from the Spaced root with Node 25.3.0:

```sh
node scripts/sync-compression-benchmark/storage.mjs
```

The source opens read-only. Each case uses the largest account, the same 97,266
records, all sync metadata and both production indexes. Compare plain TEXT with
individual gzip level 1, gzip level 6 and Zstandard level 3 BLOB values.
Compression is measured separately. Three rotated runs create fresh databases,
write in 500-row durable transactions, then read in 500-row pages and decompress
and JSON-parse every value. A SHA-256 comparison of the complete ordered value
set runs outside timing. SQLite uses DELETE journal mode and FULL synchronous
mode in every case. Reads are warm-cache; this is not D1 or a cold-disk test.
No auth, browser validation, browser storage or application memory work occurs.

The wire comparison encodes compressed values as base64 inside otherwise
identical sync envelopes, then applies HTTP gzip to each complete NDJSON stream.
This models sending compressed values unchanged to the client. A server that
decompresses values first would keep the existing wire size, but pay decode cost.
Binary framing could remove base64 overhead; it is not measured here.

The separate page-cache probe compresses arrays of 500 complete sync records.
It omits page-level cursor/head/hasMore envelope fields.
This is an immutable snapshot-cache experiment, not an interchangeable row
storage format. Pages cannot be individually updated like records. Cache
invalidation, fixed snapshot heads and subsequent deltas would need a design.

## Browser restore comparison

Isolated dependencies: fflate 0.8.3 and fzstd 0.1.1 installed under
`cutover.local/compression/deps`. Application dependencies remain unchanged.
Run `bun scripts/sync-compression-benchmark/server.ts`, open
`http://127.0.0.1:5290/` in Chrome, and click **Run compression comparison**.

Three rotated repetitions compare plain, per-record gzip and per-record Zstd.
All three transfer one precompressed HTTP-gzip NDJSON response. Browser HTTP
decompression happens normally; the gzip/Zstd cases then decode each base64
value and decompress it in JavaScript. `decompressMs` includes base64 conversion,
byte allocation, codec work and UTF-8 decoding, not just the codec call.
All cases use the same experimental
single-pass discriminated Zod 3 decoder, installed SyncClient, DexieSyncStorage,
500-row pages, indexes and pending-edit checks. The decoder change is a bundle
plugin only. App source is unchanged. The single-response fixture iterator is
not the installed Hono transport's 32-page windows or its stream-frame decoder.
Every case uses this same fixture; SyncClient still validates each page.

Timing includes fetch, HTTP decompression, parsing, per-record decompression,
validation, HLC, IndexedDB writes and cursor updates. It excludes fixture SQL,
server compression, DB setup, auth, pushes, final MemoryDB rebuild and full-row
verification. The same decoded objects are persisted in every case. This does
not test compressed browser storage. There is no network bandwidth throttle.
Each restore verifies all saved rows, final cursor, bootstrap flag and empty
outbox against the plain fixture outside timing, then deletes its private DB.
Write timing can overlap decoding of the prefetched page; phase times must not
be summed as independent CPU costs.

Raw results: `cutover.local/compression/{storage,browser}-results.json`.
Use the Cleanup button after any interruption. It only deletes databases whose
names start with `SpacedCompressionBenchmark-` on this isolated loopback origin.
Stop the fixture server after use. Do not run this at the same time as another
benchmark. Machine load is part of the report, not a basis for hiding slow runs.

# Compressed sync values — 19 September 2026

Per-record compression saves server storage but is not yet a reason to change
the sync format. On this corpus, it increases local read/decode work. Sending
independently compressed values in the current JSON envelope makes the HTTP-gzip
download substantially larger. Compression across records is more effective.

Raw storage samples: [SYNC_COMPRESSION_STORAGE_RESULTS.json](./SYNC_COMPRESSION_STORAGE_RESULTS.json).

## SQLite and wire measurements

The same 97,266 records from the converted, read-only production snapshot were
used in all cases. MB means 1,000,000 bytes. Database sizes include the same sync
metadata and two indexes, but exclude other users, auth tables and files.
Timings are medians of three rotated local Node/SQLite runs.

| Value representation | Value bytes | Database file | Read + decompress + JSON parse | Write pre-encoded rows | HTTP gzip download |
| -------------------- | ----------: | ------------: | -----------------------------: | ---------------------: | -----------------: |
| Plain text           |    43.85 MB |      84.35 MB |                        0.266 s |                3.072 s |            9.20 MB |
| gzip level 1         |    28.77 MB |      69.18 MB |                        1.422 s |                3.908 s |           30.42 MB |
| gzip level 6         |    28.68 MB |      69.16 MB |                        1.304 s |                3.794 s |           30.14 MB |
| Zstd level 3         |    28.44 MB |      68.76 MB |                        1.458 s |                3.889 s |           28.00 MB |

Generating all compressed values took about 2.0–2.1 seconds per codec in a
separate single probe. This compression cost is excluded from the write column.
Each row remains independently editable. Every timed restore passed a complete
ordered-value SHA-256 check outside timing.

The download column keeps compressed values opaque: it base64-encodes each value
inside the same JSON envelope and applies HTTP gzip to the entire NDJSON stream.
This loses the benefit of repeated JSON fields across records. A binary wire
format could remove base64 overhead; it was not tested. If the server instead
decompresses each row before transmission, the existing 9.20 MB representation
can remain, at the cost of server decompression.

This is local SQLite, not D1. Reads use warm filesystem caches. The experiment
does not measure the Worker-to-D1 boundary, D1 billing, production bandwidth or
browser storage. The database size result is useful; the read timings must not
be presented as production latency. Host one-minute load was approximately 7
at the start and end. Runtime: Node 25.3.0.

## Larger compressed groups

A separate single probe compressed arrays of complete sync records in groups of 500. These arrays omit the page-level cursor/head/hasMore envelope fields:

| Cached snapshot format | Pages | Total compressed bytes |  Encode | Decode + JSON parse |
| ---------------------- | ----: | ---------------------: | ------: | ------------------: |
| gzip level 6           |   195 |                9.30 MB | 0.903 s |             0.347 s |
| Zstd level 3           |   195 |                8.43 MB | 0.361 s |             0.254 s |

Both passed the full ordered-value checksum. These are codec probes, not
end-to-end restore timings. This representation is a possible immutable cache
at a known sync head. It is not a drop-in replacement for independently updated
rows. A production cache would need snapshot consistency, invalidation, limits,
codec negotiation and a subsequent delta pull.

## Browser comparison

Two complete rotated rounds (six restores) passed full verification of all
97,266 stored rows, final cursor, bootstrap state and empty outbox. All samples
are retained in [SYNC_COMPRESSION_BROWSER_RESULTS.json](./SYNC_COMPRESSION_BROWSER_RESULTS.json).

| Server value carried over JSON       | Completed restore times | Median of two | Additional per-record value decoding, median |
| ------------------------------------ | ----------------------: | ------------: | -------------------------------------------: |
| Plain, with HTTP gzip                |       22.027 / 21.857 s |      21.942 s |                                      0.011 s |
| gzip level 6, base64, with HTTP gzip |       45.105 / 47.575 s |      46.340 s |                                     16.614 s |
| Zstd level 3, base64, with HTTP gzip |       47.075 / 41.544 s |      44.309 s |                                     16.574 s |

Per-record value decoding includes base64 conversion, byte-array creation,
decompression and UTF-8 decoding. It is not pure codec time. Codecs were fflate
0.8.3 and fzstd 0.1.1 in Chrome 152. Results do not establish performance for
native per-record decoders, WASM, shared dictionaries or a binary wire protocol.

All modes use the same faster single-pass discriminated Zod 3 decoder, installed
SyncClient and DexieSyncStorage, 500-record writes, pending-edit checks and
indexes. The browser database stores identical decoded objects in every case.
This is not a compressed-IndexedDB experiment. The single-response fixture is
not the shipping endpoint's bounded response windows. SQL, server compression,
auth, setup, verification and final MemoryDB rebuild are outside browser timing.
There is no bandwidth throttle. Prefetch overlaps value decoding and awaited
writes; those phase durations must not be added as separate CPU costs.

The intended third round was stopped after one-minute host load rose from about
6–10 to 36.24 and browser control detached. No completed verified third-round
sample was saved. The six completed samples above are not a three-repeat study
or a precise production speed prediction. The direction is consistent in both
rounds and agrees with the larger measured wire payloads.

The fixture servers are stopped and disposable browser databases were removed
through a fresh cleanup page. The original interrupted benchmark tab could not
be closed through the browser control tool; its data endpoints are offline.

## Decision

Keep plain server values and HTTP gzip for now. Per-record BLOB compression saved
about 18% of the local indexed database size, but did not improve the measured
read path. Passing compressed values through as base64 made this tested browser
restore slower and enlarged its download. Server-only compression followed by
server decompression would avoid that wire change, but needs D1 measurements
before claiming a benefit across the Worker-to-D1 boundary.

First remove redundant domain parsing and select the schema by record type.
The separate [Zod study](../legacy-sync-benchmark.local/benchmark/zod/REPORT.md)
shows that most decoder cost can be removed without a major-version upgrade.
Then measure the pending-edit reads and database writes. A compressed immutable
snapshot cache is a separate option if the server later becomes the bottleneck.

## Review and reproduce

1. This report, then the aggregate result files.
2. [Methodology](../scripts/sync-compression-benchmark/README.md).
3. [SQLite and codec harness](../scripts/sync-compression-benchmark/storage.mjs).
4. [Browser restore harness](../scripts/sync-compression-benchmark/browser.ts)
   and [private fixture server](../scripts/sync-compression-benchmark/server.ts).

Private generated databases and payloads stay under ignored
`cutover.local/compression`. No application code, dependencies or production data
are changed by these experiments.

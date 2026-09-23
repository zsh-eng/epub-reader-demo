# Dormant native journal performance

The app does **not** use this repository yet. These measurements describe the
staged sync code, not current Arctic UI latency. Live persistence migration
remains a separate approval and validation step.

## Reproduce

Run from the repository root:

```sh
python3 apps/arctic/Tests/check-article-sync.py
python3 apps/arctic/Tests/check-article-sync.py --configuration release --performance
python3 apps/arctic/Tests/check-article-sync.py --performance
swift test --package-path apps/arctic/Sync --scratch-path /tmp/arctic-sync-build
```

The runner compiles the production model and repository with the local sync
package. Performance fixtures contain 1,000 or 10,000 generated articles with
fixed dates, a title, a short description and two tags. There is no network,
authentication or user-library access. Each mutation timing below is the median
of three archive-toggle edits in one process. These are indicative Mac results;
iPhone measurements remain required before activation.

## Measured 2026-09-20

Local arm64 Mac, macOS 26.5.1, SwiftPM debug/release builds. Milliseconds:

| Build | Articles | Full-library transaction | One-article transaction, full import outbox | One-article transaction, empty outbox |
| --- | ---: | ---: | ---: | ---: |
| Release | 1,000 | 174 | 28.3 | 15.8 |
| Release | 10,000 | 1,784 | 320 | 179 |
| Debug | 1,000 | 305 | 28.3 | 15.8 |
| Debug | 10,000 | 3,011 | 324 | 177 |

The full outbox contains three pending records per article. Its journal is
2.93 MB at 1,000 articles and 29.44 MB at 10,000. With no pending uploads, the
same snapshots are 1.66 MB and 16.63 MB respectively. Empty-outbox fixtures keep
the same article rows and private values; they measure storage cost rather than
performing a network sync.

Release-mode phase checks for 10,000 articles:

| Operation | Time |
| --- | ---: |
| Project the entire journal into articles | 373 ms |
| Canonicalize and hash every article URL | 34 ms |
| Build the full-library edit transaction | 716 ms |
| Project one article | 0.08 ms |
| Build one article's transaction | 0.12 ms |
| Encode and atomically persist the full-outbox journal | 331 ms |
| JSON-encode an equivalent journal envelope | 312 ms |
| Atomically write the already encoded bytes | 6.3 ms |
| JSON-encode the empty-outbox envelope | 175 ms |

Phase checks are separate operations, not additive trace spans. Full transaction
work includes projection and comparison. The explicit envelope uses the same
rows, pending values, local values and state fields to isolate encoding cost.

## Implemented bounded change

`ArticleSyncRepository.editArticle(at:_:)` reads only the URL's article, library
and tags records plus its local receipt/cache value. It applies the callback in
the same `SyncStore.transaction` that persists the domain values and outbox.
It returns one article instead of rebuilding and sorting the whole library.
Imports retain the batch transaction API.

Only semantically changed record families become local edits. Different JSON
field order on a remote record does not turn an archive action into a metadata
or tags edit. Deletion creates tombstones. Canonical URL changes are rejected.
The journal also skips unchanged writes while retaining the first empty write
as the completed-migration marker.

This meets the 50 ms Mac release target at 1,000 articles. It does not meet that
target at 10,000 articles. JSON encoding of the full snapshot now dominates;
more concurrency, image caching or a faster URL hash will not remove that cost.

## Next concrete storage change, not implemented

Keep the protocol and one actor per account, but replace the full JSON snapshot
write with a SQLite transaction. Use one database in each existing profile
folder and these logical tables:

- `records`: key, value, deletion flag, schema version, HLC, device ID and server sequence.
- `outbox`: the latest pending version for each key; obtain its payload with a record join.
- `local_values`: private share receipts and cache markers by article identity.
- `state`: account identity, local device ID, HLC and pull cursor.

A one-article edit uses one `BEGIN IMMEDIATE` transaction to update its changed
record families, outbox entries, private value and clock. A pull page commits
winning records and its cursor together. An upload acknowledgement clears only
the matching submitted version, preserving edits made while upload was running.
Batch import remains one transaction. Use WAL mode and keep the legacy source
untouched until a complete migration marker is committed.

Before activation, port and pass the existing account, tombstone, concurrent-edit,
private-receipt and failed-write tests against SQLite. Then measure the same
1,000/10,000-article cases and actual iPhone interactions. Do not add a second,
best-effort outbox beside the current domain store.

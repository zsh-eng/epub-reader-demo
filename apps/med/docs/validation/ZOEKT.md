# Zoekt benchmark: Bun and ten branch snapshots

Measured 19 September 2026 on an Apple M1 Pro, 8 logical CPUs, 16 GiB RAM, macOS arm64. These measurements support trying Zoekt for committed-branch search. This benchmark phase did not change application search. See the subsequent [integration report](ZOEKT_INTEGRATION.md) for the shipped adapter and built-host measurements.

## Interactive search latency

Median of ten timed repetitions. The engines ran serially, with their order rotated between trials. Zoekt timings include loopback HTTP and JSON decoding. Git and ripgrep timings include process creation, output capture and termination. None include the application's server adapter, typing delay, preview reads or browser rendering.

| Literal, case-insensitive query            |   Zoekt |  Git grep |   ripgrep |
| ------------------------------------------ | ------: | --------: | --------: |
| `rewriteForProxiedHttp` — 5 matching lines | 1.44 ms | 218.74 ms | 348.91 ms |
| `setTimeout` — common                      | 2.98 ms |  78.33 ms |  36.00 ms |
| `export` — very common                     | 1.57 ms |  13.60 ms |  10.18 ms |
| `MED_NO_MATCH_7cd25ead8973` — absent       | 1.09 ms | 219.91 ms | 342.37 ms |

These are bounded interactive searches, not complete-result timings for broad queries. Zoekt has a 200-match search/display budget; Git and ripgrep are terminated after the harness receives 200 output lines. Zoekt returned 185–198 lines for the broad queries in the one-branch phase. Match counting, ordering and output buffering differ, so those broad-query rows are useful UI workload comparisons, not identical-output microbenchmarks. The rare and absent queries complete naturally on all engines.

The first use of each query on the one-branch server took 1.47–26.05 ms. This is not a cold-disk measurement: the OS cache was not purged, and each query can benefit from earlier indexing and queries. Service startup and initial index availability took 485 ms, including the readiness poll interval.

## Index cost

Decimal MB/GB below; memory is measured resident set size, not a claim about total machine cache use.

| Operation                         | Elapsed | Index on disk | Indexer peak RSS |
| --------------------------------- | ------: | ------------: | ---------------: |
| Initial index, one branch         |  6.59 s |      410.6 MB |          1.23 GB |
| Check unchanged branch            |   57 ms |      410.6 MB |          50.8 MB |
| Advance that branch by one commit |  108 ms |      412.1 MB |         130.7 MB |
| Expand from one to ten branches   |  6.28 s |      489.0 MB |          1.23 GB |
| Check ten unchanged branches      |   93 ms |      489.0 MB |          52.4 MB |

The one-commit update changed 10 files, with 694 insertions and 220 deletions. It used a delta build. Adding nine branch names caused the requested delta build to fall back to a full build; the raw output records the reason.

Ten related branch snapshots used about 19% more disk than the initial single branch, not ten times the space. The snapshots are Bun HEAD and HEAD~5, ~10, through ~45. They are historical snapshots under synthetic branch names in an isolated bare repository. They model shared content across related branches; they do not model ten independent repositories or ten unrelated feature branches.

The search server's RSS after the one-branch workload was 180.6 MB. After the ten-branch workload it was 101.5 MB. These are end-of-phase samples, not peak server memory. The first phase included exhaustive result checks that touched more data; the second only ran bounded searches, so the two RSS values are not a controlled memory comparison.

## Ten-branch search

Warm medians, ten repetitions per cell. All-branch results retain Zoekt's file-version deduplication rather than expanding each match once per branch.

| Query                   | Selected branch within ten-branch index | All ten branches |
| ----------------------- | --------------------------------------: | ---------------: |
| `rewriteForProxiedHttp` |                                 0.65 ms |          0.60 ms |
| `setTimeout`            |                                 2.75 ms |          2.94 ms |
| `export`                |                                 2.03 ms |          1.96 ms |
| Absent string           |                                 0.63 ms |          0.63 ms |

Treat small differences between phases as noise. These trials do not establish latency percentiles under concurrent agent CPU or I/O load.

## Correctness and coverage

A separate exhaustive search compared the full `(path, line number)` sets, not just counts. All four queries matched exactly across Zoekt, Git and ripgrep: 5, 2,918, 35,914 and 0 lines. Zoekt reported no skipped shards or cancelled files in these exhaustive checks. This validates the selected queries, not every possible query or file encoding.

The benchmark uses an 8 MiB per-file limit across all engines. Two tracked files exceed it and are excluded:

- `src/jsc/bindings/sqlite/sqlite3.c`
- `test/bundler/transpiler/fixtures/lots-of-for-loop.js`

Git uses explicit path exclusions to match the size limit. Binary handling remains engine-specific. The broad exhaustive query exposed a quoted Unicode path difference in the harness; Git's `core.quotePath=false` resolves it before set comparison.

Collecting every result has a different cost from filling a picker. As a single validation sample, all 35,914 `export` lines took 272 ms through Zoekt HTTP/JSON, 244 ms through Git stdout, and 382 ms through ripgrep stdout. This is not a repeated benchmark, but it shows why the 1–3 ms figure must not be presented as an unlimited search guarantee.

## Configuration and reproduction

- Bun commit: `26e7a4b3690dce60d4dcd7f47a12b531deb00837`.
- Source tree: 19,810 entries, 200,569,457 bytes, before binary and size exclusions.
- Zoekt revision: `153817f643cde8b229ee388c1dddbcf07f4798af`.
- Git indexer and webserver built with `CGO_ENABLED=0`; Ctags disabled.
- Four indexing/search worker threads where configurable; `GOMAXPROCS=4`.
- File limit 8 MiB, trigram limit 1,000,000 per document. These are explicit benchmark settings, not Zoekt defaults.
- No Bun code, hooks, builds or tests were executed.
- The original checkout's HEAD, refs, index, status and worktree-list fingerprints were identical before and after the run.
- Benchmark binaries, build caches, isolated Git metadata and index files remain under ignored `.benchmarks/`. The binaries total approximately 94 MB before release stripping. Go was used to build them, not to launch the search/index processes.

Build the pinned tools into an isolated directory:

```sh
mkdir -p .benchmarks/zoekt-tools/bin .benchmarks/zoekt-tools/cache .benchmarks/zoekt-tools/mod
GOBIN="$PWD/.benchmarks/zoekt-tools/bin" \
GOCACHE="$PWD/.benchmarks/zoekt-tools/cache" \
GOMODCACHE="$PWD/.benchmarks/zoekt-tools/mod" \
CGO_ENABLED=0 go install \
  github.com/sourcegraph/zoekt/cmd/zoekt-git-index@153817f643cde8b229ee388c1dddbcf07f4798af \
  github.com/sourcegraph/zoekt/cmd/zoekt-webserver@153817f643cde8b229ee388c1dddbcf07f4798af
node scripts/benchmark-zoekt.mjs
```

Requires a clean checkout with at least 46 commits, Git, ripgrep, and macOS `/usr/bin/time`. The harness creates a new isolated bare copy and index directory for each run. It uses loopback port 6197, which must be free. Stop other heavy work for less variable measurements. Raw samples include versions, arguments, resource output, indexed commit metadata, result checks and source fingerprints.

## Recommendation

Proceed with a small committed-branch integration. Keep one local search service, queue index builds serially, retain the index across launches, and batch branch-set changes. Report the indexed commit and open result previews at that exact revision. Keep direct search available while an index is unavailable.

The data supports low-latency interactive search and efficient storage for similar branches. It does not yet establish performance across several independent large repositories, sustained edit/commit churn, cold OS caches, symbol ranking, concurrent searches or other operating systems.

## Suggested review order

1. This report: scope, timings and caveats.
2. [Raw samples](zoekt-benchmark.json): full result-set checks, branch metadata and indexer logs.
3. [Benchmark harness](../../scripts/benchmark-zoekt.mjs): isolated repository setup, query timing and source integrity checks.

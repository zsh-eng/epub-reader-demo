# File-opening performance: first pass

This is the earlier measurement record. The [second pass](FILE_OPENING_SECOND_PASS.md)
replaces the full HAST transfer and changes file-open scheduling.

Java/C++ support shipped on remote main as `1e213b1` and `0dec97c`. This next
pass reduces rendering work for all supported languages. It does not change
language classification or claim complete Shiki parity.

## Changes

- Resolve token styles once per token kind and selected theme set for each render.
  Join adjacent tokens only when all their rendered styles are equal. Each emitted
  token owns its mutable style object. Pierre still adds offsets, word fragments,
  and diff decorations afterwards.
- Skip decoration-boundary allocation and sorting when a line has no decorations.
  Keep empty-line placeholders intact.
- Encode full-file worker results as JSON. Decode at the worker-pool boundary,
  before the result enters Pierre's cache or renderer. The file result is a dense,
  JSON-compatible HAST tree. Diff results, which have different array semantics,
  retain their original transport. The patch is restricted to Pierre 1.4.3 and
  rejects missing source boundaries during the build.

There is no new file cache, prefetch, or delay. File freshness, repository scope,
virtualization, selection, and theme controls retain their existing behavior.

## Measurement

Apple M1 Pro, Chromium 153.0.8010.12, production builds, Tokyo Night theme.
Sources are the pinned Bun C++ and OpenJDK Java files from the
[language corpus](../../helpers/highlighting/corpus.json).

The final run alternated the shipped Twinkleplop renderer and the optimized
renderer for three rounds. Each file uses a fresh browser context. Both builds
use the same CLI, corpus, viewport, and timing probe. No trace collection runs
inside these timed comparisons. All twelve openings completed without page errors.

| Source       | Before: coloured view | After: coloured view | Before: plus two frames | After: plus two frames |
| ------------ | --------------------: | -------------------: | ----------------------: | ---------------------: |
| Bun C++      |               88.8 ms |              77.9 ms |                122.4 ms |               111.5 ms |
| OpenJDK Java |               88.2 ms |              79.9 ms |                121.6 ms |               112.8 ms |

Values are medians. This is about 9% and 7% less elapsed time in the full
measurement. Earlier separate runs showed larger gains; the alternating run
above is the reported result. Three samples per build/file are a small sample,
and Java ranges overlap. These are local observations, not a broad performance
guarantee. The two extra animation frames remain in both versions, so the
reported improvement is not obtained by removing benchmark waits.

The timer starts when an already fetched file response is released. It excludes
application startup and Git reading. The end condition requires a file-worker
reply, coloured tokens in the main file pane, and two further animation frames.
It includes cold language loading, worker work, transfer, UI updates, and probe
cost. It is not a complete click-to-open latency measurement.

Phase timestamps share that start:

- `response`: the application's fetch resolves.
- `json`: its response body is decoded.
- `worker-send`: the browser sends a file render request.
- `worker-reply`: the probe receives the result, before the pool decodes JSON.
- `visible`: the probe detects coloured tokens in the main pane.
- `ms`: the full end condition, including the two final frames.

Do not treat `worker-reply - worker-send` as pure tokenization or compare that
interval alone across transport formats. The optimized JSON decode occurs after
that stamp. Compare the visible or full end condition for the complete benefit.

The trace showed costs in render-tree construction and nested object transfer,
in addition to cold language imports and main-thread work. For these files,
full-file render trees contain over 20,000 nodes. The optimized trees have 616
fewer nodes for Bun and 308 fewer for Java with token selection disabled. Fewer
allocations and JSON transfer reduce work; most nodes are still required by
Pierre's current result format.

The remaining target is response-to-view scheduling and the main-thread render
path. In the final run, worker replies arrived around 51–60 ms for the optimized
build, while coloured-view detection was around 76–87 ms. Some of that interval
is frame scheduling and measurement. Do not attribute all of it to application
CPU time without a trace.

## Validation

- 12 integration cases compare production Pierre output with Shiki, including
  blank-line placeholders with token selection disabled and diff decorations.
- 71 browser tests cover full-file navigation, selection, syntax workers, and
  live theme changes for both files and diffs.
- 39 existing adapter/language regressions pass.
- All 18 fixture/theme screenshot comparisons pass.
- Whole-file comparison against the shipped adapter finds zero changed text/style
  ranges on both corpus files, with token selection enabled and disabled. This is
  equivalence to the shipped adapter, not proof of full Shiki language parity.
- Build, typecheck, lint, and formatting checks pass.

[Raw results](file-opening-results.json) include every opening sample, phase
stamp, source hashes, build asset digests, and render-tree comparison counts.
The existing [Java/C++ report](JAVA_CPP_HIGHLIGHTING.md) retains the known
whole-file language-classification differences against Shiki.

## Reproduce

From `apps/med`, fetch the pinned corpus if needed, then run:

```sh
bun scripts/fetch-highlighter-corpus.ts
bun run build
node scripts/benchmark-language-ui.mjs --native-only
```

Results and screenshots are written under `.benchmarks/language-ui`. Use
`--skip-build` to reuse an existing build. Only use it when that build contains
the source you intend to measure.

To record a diagnostic trace:

```sh
node scripts/benchmark-language-ui.mjs --native-only --skip-build --profile
```

This writes `profile-results.json` and one Chrome trace JSON per file/round.
Open traces with Chrome DevTools Performance. Tracing adds overhead; keep these
results separate from ordinary timing runs.

To compare two native builds, build each revision into its own directory under
`.benchmarks/language-ui/<label>/web`, then run:

```sh
node scripts/benchmark-language-ui.mjs --skip-build --builds=before,twinkleplop
```

The runner alternates labels each round. Labels identify existing builds; they
do not select a tokenizer. `--builds` requires `--skip-build`. Preserve
`results.json` before another run. The shipped baseline for this record is
`f901787`, whose med source matches remote `0dec97c`.

The runner uses a temporary repository and private host state outside that
repository. It closes its browsers and hosts after each run and does not change
the user's running host.

# Reader performance

This document records the reader startup performance model, measured results,
and benchmark procedure. Treat a duration as evidence only when the trace also
records the test scope, publisher-style setting, and cache state.

## Performance targets

- Show the first useful spread as soon as possible.
- Settle the visible text, fonts, and images before background work competes for
  the main thread.
- Complete precise full-book pagination in the background.
- Keep later navigation responsive while pagination or artifact work continues.

The first useful spread is the primary startup target. Full pagination is a
background completion metric and is not a reveal gate.

## Startup metrics

| Metric | Meaning |
| --- | --- |
| Route mounted | The reader route effect ran. It does not include later source or pagination work. |
| First spread returned | The main thread entered the handler for the worker's first partial result. |
| First spread frame | React committed the first spread DOM and the browser passed two animation frames. An image can still be a size-preserving placeholder. |
| Visible assets settled | `document.fonts.ready` resolved and the visible spread had no pending EPUB images. |
| Visible content settled | The display-ready state committed and the browser passed two more animation frames. This is the closest trace metric to complete visible reader content. |
| Full pagination | All chapter artifacts reached the worker and the worker returned the complete page model. |

The interval from **First spread frame** to **Visible content settled** is
intentional and measurable. For an image spread it contains:

1. Read the image Blob from IndexedDB.
2. Create an object URL.
3. Decode the image.
4. Commit the decoded image in React.
5. Confirm that the document fonts and all visible images are ready.
6. Commit `displayReady` and wait two animation frames.

Use these spans to find the slow step:

- `epub-image-file-read`
- `epub-image-object-url-create`
- `epub-image-decode`
- `epub-image-dom-committed`
- `document-fonts-ready`
- `visible-images-ready`
- `display-assets-settle`
- `reader-display-ready`
- `reader-settled-frame-painted`

Do not subtract only the headline cards and infer the cause. Read the spans
inside that interval.

## Controlled production result

The current reference report is
`diagnostics/reader-startup-settled-gate-v3/reader-startup-benchmark.json`.

Test scope:

- EPUB: *The Way of Kings*, 130 chapters; the initial spread contains a 1.46 MB
  JPEG cover.
- Scenario: first reader open after import in a fresh browser context.
- Build: Vite production preview.
- Viewport: 1440 x 1000.
- Reader font: Lora, 18 px, 1.5 line height.
- Publisher styles: on.
- Cache: the publisher-style body cache and chapter artifacts were cold. The
  extracted EPUB files were already in IndexedDB.
- CPU: 1x and DevTools 4x main-thread slowdown. The worker stayed at 1x.

| Metric | 1x main | 4x main |
| --- | ---: | ---: |
| Route mounted | 5.0 ms | 32.9 ms |
| Styled body cache rebuild | 246.8 ms | 2,037.8 ms |
| Worker fonts ready | 87.6 ms | 178.4 ms |
| Publisher fonts for first artifact | 1.5 ms | 11.5 ms |
| First-spread worker round trip | 3.8 ms | 13.9 ms |
| First spread frame | **299.9 ms** | **2,297.1 ms** |
| First image file read | 1.4 ms | 14.9 ms |
| First image decode | 25.5 ms | 30.4 ms |
| Visible content settled | **367.7 ms** | **2,577.0 ms** |
| Full pagination | 2,491.4 ms | 5,375.8 ms |

In this cold-cache test, worker font startup was not on the critical path. It
finished before the styled body cache rebuild. Publisher font readiness was on
the worker round-trip path, but it used only 1.5 ms at 1x and 11.5 ms in the 4x
main-thread run. The benchmark does not slow the worker, so it cannot predict
worker time on a slower mobile CPU.

At 4x, the dominant first-spread cost was the 2.04 second publisher-style body
cache rebuild on the main thread. This is measured evidence. A publisher-style
cache hit should remove most of that rebuild, but the current benchmark has not
measured a controlled warm reopen yet.

The final 1x interval from first spread frame to visible content settled was
67.8 ms. The equivalent 4x interval was 279.9 ms. Remaining chapter artifacts
do not resume until after the settled-frame mark.

The display-ready transition took 10.0 ms at 1x, including a 7.6 ms Reader
render/commit. At 4x it took 65.5 ms, including a 52.2 ms Reader render/commit.
The 4x render was part of a 114 ms main-thread long task. The trace therefore
attributes nearly half of that long task to the Reader render/commit. The
remaining synchronous post-commit work in the same task still needs finer
attribution.

## Changes and measured effect

| Change | Evidence | Critical path? |
| --- | --- | --- |
| Persistent end-to-end traces (`c03bae0`) | Adds local trace storage, lanes, metadata, long-task records, and the `/reader-traces` viewer. It does not make startup faster. | Measurement only. |
| Production normal/4x harness (`177ccfd`) | Adds a repeatable fresh-import benchmark and records that only the main thread is throttled. | Measurement only. |
| Initial artifact first and bounded task yields (`9e8ae02`) | A manual trace reduced worker-result time outside the worker from about 976 ms to about 400 ms. With the later reveal gate, the controlled result was 2.1 ms at 1x and 12.3 ms at 4x. | Yes for first-result delivery. The first change alone did not settle visible content sooner. |
| Image readiness tracing (`772ef4e`) | Splits first spread paint from image read, decode, DOM commit, and settled reader paint. | Measurement only. |
| Compound `[bookId+path]` file index (`48996c1`) | Cover read fell from 530.9 ms to 9.0 ms at 1x and from 2,831.8 ms to 33.8 ms at 4x. | Yes for image spreads. Artifact work still delayed image decode after the bytes arrived. |
| Resume remaining artifacts after visible readiness (`b2accc9`) | With the index already present, first-spread-to-settled fell from 625.4 ms to 81.1 ms at 1x and from 2,273.7 ms to 384.0 ms at 4x. | Yes. This removed background artifact work from the reveal path. |
| First-spread label correction (`a246fa6`) | Clarifies that the first spread frame can contain an image placeholder. | Measurement only. |
| Settled-frame artifact gate (`bc99686`) | First-spread-to-settled fell from 81.1 ms to 67.8 ms at 1x and from 384.0 ms to 279.9 ms at 4x. The first artifact yield now starts after settled paint. | Yes. It prevents background work from delaying the paint-confirmation frames and adds render/commit attribution. |

The full-pagination duration can stay similar or increase between runs. This is
acceptable when visible content improves because distant chapter work is now
lower priority.

## Earlier performance architecture

These changes predate the current production benchmark. Their architectural
effect is known, but their individual startup impact was not measured with the
current harness.

| Area | Relevant commits | Effect and evidence level |
| --- | --- | --- |
| Visible-first pagination | `4b6fe4e`, `3588dd2`, `6e9f989` | Loads chapters middle-out, emits a partial visible spread, and avoids React updates for each pagination progress event. Architectural effect; no comparable benchmark. |
| Durable normalized body cache | `b1f446a`, `408f562`, `ebd60b4` | Avoids repeated `Blob.text()`, resource normalization, body extraction, and canonical-text parsing after a cache hit. Earlier Poco F3 diagnosis found source HTML materialization slow; no current warm/cold comparison. |
| In-memory reader queries and artifacts | `ddf53f0`, `2a46aca`, `4498b57`, `2633f89`, `90d08ac` | Uses TanStack Query for deduplication and keeps artifact progress out of React render state. Architectural effect; no isolated current measurement. |
| Library prefetch | `b0d8a0e`, `8cbdfe8` | Warms continue-reading inputs and up to two artifacts for an interacted book. Current prefetch uses publisher styles off, so it does not warm the publisher-style cache variant used by the reference test. |
| Stepwise worker scheduler | `350cdb7` | Lets navigation preempt background pagination at chapter yield boundaries. This protects interaction latency more than first-open wall time. |
| Atomic reader reveal | `c430d59` | Coordinates the first spread, visible images, and document fonts while preserving one mounted spread stage. This improves reveal correctness and defines the settled-content gate; it is not a raw CPU optimization. |
| Worker font correctness | `02010f8`, `63dbf38`, `688053a` | Self-hosts app fonts, loads matching faces in the worker, and makes font CSS parsing consistent in dev and preview. These changes protect layout agreement. They do not prove that font startup became faster. |

Firefox full-book pagination has a separate web-font `measureText` slow path.
See the **Firefox Pagination Performance Notes** in `README.md`. That issue is
distributed across thousands of prepare calls and is not the same as startup
font loading.

## Run a controlled benchmark

The benchmark builds the production app, imports the EPUB into a fresh browser
context, and runs 1x and 4x main-thread tests:

```bash
bun run benchmark:reader-startup -- \
  --epub "/Users/admin/Downloads/The Way of Kings (Brandon Sanderson) (Z-Library).epub" \
  --publisher-styles on \
  --out diagnostics/reader-startup-local
```

The output directory contains `reader-startup-benchmark.json` and one trace
screenshot for each CPU scope. Compare JSON span values, not screenshots alone.

To reuse an existing production preview:

```bash
bun run build
bun x vite preview --host 127.0.0.1 --port 4174 --strictPort
```

Then run in a second terminal:

```bash
bun scripts/benchmark-reader-startup.ts \
  --epub "/absolute/path/to/book.epub" \
  --url http://127.0.0.1:4174 \
  --no-start-server \
  --publisher-styles on \
  --out diagnostics/reader-startup-local
```

Restart the preview after each new build. A long-running Vite preview can serve
HTML which references an old hashed asset.

## Record a manual trace

1. Use a production preview when you compare timings.
2. Open **Performance** or `/reader-traces`.
3. Turn on **Record reader traces**.
4. Return to the Library and open a book.
5. Open `/reader-traces` again and select the saved run.
6. Check **CPU throttle scope**, **Publisher styles**, **Chapter source**, and
   the `reader-body-cache-load` `loadKind` before you compare it with another
   run.

Manual DevTools throttling does not populate the trace CPU metadata. Treat a
trace that says **Not recorded** as an unknown CPU scope. The stored trace limit
is 30 runs with at most 160 spans per run.

## Next measurements

1. Add a controlled warm reopen run for the publisher-style body cache.
2. Make Library prefetch use the active publisher-style cache key, then measure
   continue-reading opens against the cold reference.
3. Attribute the synchronous work which remains after the display-ready Reader
   render/commit in the 4x long task.
4. Keep selective worker-font loading behind the reveal and React-commit work.
5. Keep the initial image case in the benchmark. A text-only case is useful as
   a comparison, not as the primary target.

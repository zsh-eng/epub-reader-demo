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
| Route DOM committed | The Reader layout effect ran after React committed the route DOM. |
| Route passive effect | The Reader passive effect ran. The gap from the DOM commit shows React's effect scheduling delay, not storage or pagination work. |
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

### One-run footer suppression experiment

The report in
`diagnostics/reader-startup-no-footer/reader-startup-benchmark.json` temporarily
omitted `ReaderFooter` and its handoff hook. The production source was restored
after the run. This is one A/B sample, so treat large differences as directional
until repeated runs produce a stable median.

| 4x main-thread metric | Reference | No footer | Difference |
| --- | ---: | ---: | ---: |
| Styled body cache rebuild | 2,037.8 ms | 1,176.8 ms | -861.0 ms |
| Chapter source normalization | 1,810.7 ms | 1,008.8 ms | -801.9 ms |
| First spread frame | 2,297.1 ms | 1,368.9 ms | -928.2 ms |
| Visible assets to settled frame | 229.3 ms | 218.9 ms | -10.4 ms |
| Display-ready transition | 65.5 ms | 61.7 ms | -3.8 ms |
| Reader render/commit | 52.2 ms | 50.4 ms | -1.8 ms |
| First spread to settled frame | 279.9 ms | 255.6 ms | -24.3 ms |
| Full pagination | 5,375.8 ms | 4,215.4 ms | -1,160.4 ms |

Removing the footer did not explain the post-asset settling interval. It saved
only 10.4 ms from visible assets to the settled frame. The larger difference
appeared before the first spread, while the styled body cache was rebuilt. The
footer loading scrubber continuously animates a container, a blurred shimmer,
and eleven marks. These main-thread animation updates can contend with source
normalization under 4x slowdown. A follow-up test must keep the footer structure
and disable only its loading animations, then compare repeated medians.

### Warm-library worker startup finding

Trace `2ba71392-5eed-4b22-b721-58a425165da0` is a hard-restart, unthrottled
Library-to-Reader run. Publisher styles were off, so this is not the final
target scenario. It is representative of a fresh app session after normal
Library preload and desktop hover:

| Milestone | Time from open intent |
| --- | ---: |
| Route mounted | 28 ms |
| Initial chapter artifact ready | 47 ms |
| Publisher fonts ready | 65 ms |
| Worker and built-in fonts ready | 109 ms |
| First spread returned | 110 ms |
| First spread frame | 117 ms |

The worker waited 44 ms and command delivery used 18 ms. Worker and built-in
font readiness was the last first-spread barrier in this trace. Exactly two
artifacts were cached and 128 were built later. This matches the Library hover
prefetch limit and does not represent a fully warm Reader cache. Remaining
artifact work resumed only after the 198 ms reveal gate, so it did not delay the
first spread.

Commit `bde13b2` implements the app-lifetime pagination worker. It retains only
the worker and its built-in font readiness:

1. Create one worker after the Library's first painted frame and keep it alive
   across Library and Reader routes.
2. Give each Reader book session a new generation. Stamp every command and
   event with it, and discard stale events on the main thread.
3. On a new `init`, cancel queued background jobs and reset the engine. The
   current scheduler already clears queued jobs, and `PaginationEngine.init()`
   replaces all per-chapter arrays.
4. Invalidate the active generation when the Reader unmounts. Do not terminate
   the worker unless it fails or the app closes.
5. Do not retain complete pagination state for multiple books yet.

The production harness ran the supplied 21.7 MB reference book with publisher
styles on after it observed the real post-Library-paint worker-ready mark:

| Metric | Normal CPU | 4x main-thread CPU |
| --- | ---: | ---: |
| Worker warm at Reader acquire | Yes | Yes |
| Worker/font readiness blocks pagination | No | No |
| First-spread worker round trip | 4.4 ms | 12.9 ms |
| First spread frame | 291.7 ms | 2,081.6 ms |
| Visible content settled | 351.8 ms | 2,336.6 ms |
| Full pagination | 2,335.4 ms | 5,030.9 ms |

This verifies the lifecycle change, but it does not assign a clean end-to-end
gain. In this cold publisher-style run, body normalization used 200.6 ms at 1x
and 1,676.4 ms at 4x before the first artifact could enter pagination. That
stage hid most or all of the removed worker-startup wait. The change should not
materially change full-pagination time.

### Controlled warm-library 4x comparison

The harness then ran five 4x main-thread samples per version with publisher
styles off, a desktop hover prefetch, and a 3 second Library dwell. Every run
started with the body cache outside the trace, two decorated artifacts cached,
and 128 artifacts left to build. Medians are:

| Metric | Before global worker | Global worker | Global worker + deferred handoff |
| --- | ---: | ---: | ---: |
| First spread frame | 216.6 ms | 215.8 ms | 195.9 ms |
| Visible content settled | 526.1 ms | 505.4 ms | 473.8 ms |
| Full pagination | 2,528.5 ms | 2,519.9 ms | 2,438.3 ms |
| First-spread worker round trip | 39.4 ms | 22.3 ms | 20.4 ms |
| All-device checkpoint wall time | 70.7 ms | 72.1 ms | 1.2 ms |
| Extracted-file check | 57.0 ms | 57.8 ms | 52.6 ms |

The global worker reduced its first-spread round trip by 17.1 ms, but that work
overlapped route startup, so the first-spread median stayed flat. The controlled
storage medians also stayed flat. The earlier 369 ms checkpoint sample was not
a persistent storage regression.

An intermediate experiment started the all-device checkpoint query immediately
after settled paint. Artifact work delayed its callback to a 727.2 ms median,
and full pagination regressed to 2,770.4 ms. This shows that the storage span is
a wall-clock measurement which includes main-thread callback starvation. Commit
`5035bec` instead starts this optional handoff query after both settled paint
and full pagination. This is also the first point where the handoff prompt has
the complete chapter-to-page map that it needs.

Commit `74792f7` splits settled-frame confirmation into its two animation
frames, React commit, and passive-effect confirmation. The final five runs had
a 94.8 ms median confirmation at 4x. Median stage delays were 47.4 ms to the
first frame, 25.3 ms to the second frame, 19.6 ms to commit, and 7.2 ms to the
effect. All runs stayed visible and focused. The earlier 548 ms confirmation
gap was not reproduced.

## Changes and measured effect

| Change | Evidence | Critical path? |
| --- | --- | --- |
| Persistent end-to-end traces (`c03bae0`) | Adds local trace storage, lanes, metadata, long-task records, and the `/reader-traces` viewer. It does not make startup faster. | Measurement only. |
| Production normal/4x harness (`177ccfd`) | Adds a repeatable fresh-import benchmark and records that only the main thread is throttled. | Measurement only. |
| Initial artifact first and bounded task yields (`9e8ae02`) | A manual trace reduced worker-result time outside the worker from about 976 ms to about 400 ms. With the later reveal gate, the controlled result was 2.1 ms at 1x and 12.3 ms at 4x. | Yes for first-result delivery. The first change alone did not settle visible content sooner. |
| Image readiness tracing (`772ef4e`) | Splits first spread paint from image read, decode, DOM commit, and settled reader paint. | Measurement only. |
| Compound `[bookId+path]` file index (`48996c1`) | Cover read fell from 530.9 ms to 9.0 ms at 1x and from 2,831.8 ms to 33.8 ms at 4x. | Yes for image spreads. Artifact work still delayed image decode after the bytes arrived. |
| Resume remaining artifacts after visible readiness (`b2accc9`) | With the index already present, first-spread-to-settled fell from 625.4 ms to 81.1 ms at 1x and from 2,273.7 ms to 384.0 ms at 4x. | Yes. This removed background artifact work from the reveal path. |
| App-lifetime pagination worker (`bde13b2`) | The publisher-style normal/4x harness acquired a warm worker in both runs. Worker/font readiness became non-blocking, and first-spread worker round trips were 4.4 ms and 12.9 ms. | Yes when worker startup is the final barrier. The cold styled-body rebuild hid its end-to-end gain in this reference run. |
| Settled-frame scheduling trace (`74792f7`) | Splits both frame callbacks, the resulting React commit, and the passive-effect confirmation. It also records page visibility and focus changes. | Measurement only. |
| Deferred handoff checkpoint query (`5035bec`) | Five 4x medians improved from 215.8 ms to 195.9 ms for first spread, 505.4 ms to 473.8 ms for settled content, and 2,519.9 ms to 2,438.3 ms for full pagination. | Yes. The optional all-device query now starts only after the page map is complete. |
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

To reproduce the five-run warm-Library comparison, add:

```bash
--publisher-styles off --cpu-rate 4 --repetitions 5 \
  --hover-prefetch --library-wait 3000 --wait-for-worker-warm
```

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

1. Compare warm-body-cache Library-to-Reader medians with and without the
   app-lifetime worker, using publisher styles on and explicit normal/4x scope.
2. Keep the footer structure but disable only its loading animations, then
   repeat the 4x benchmark to isolate their main-thread cost.
3. Add a controlled warm reopen run for the publisher-style body cache.
4. Make Library prefetch use the active publisher-style cache key, then measure
   continue-reading opens against the cold reference.
5. Attribute the synchronous work which remains after the display-ready Reader
   render/commit in the 4x long task.
6. Keep selective worker-font loading behind the app-lifetime worker and reveal
   work.
7. Keep the initial image case in the benchmark. A text-only case is useful as
   a comparison, not as the primary target.

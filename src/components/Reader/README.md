# Reader

This reader has a small reader-side content pipeline before content reaches `pagination-v2`.

## Why the pipeline exists

- We load EPUB chapter files from IndexedDB-backed storage and normalize embedded resources before pagination sees the content.
- We keep `canonicalText` derived from the base chapter HTML, before highlight markup is injected.
- We inject highlights into the HTML before parsing it into pagination blocks so the rendered DOM, the parsed block structure, and the user's selection/highlight interactions all flow through the same representation.

That split gives us stable text offsets for highlight storage while still letting the rendered page include highlight markup.

## Pagination model

The reader uses real pagination rather than approximate locations. Every loaded chapter is parsed into blocks, converted into prepared text segments, and laid out against the current font, viewport, and spacing settings. This gives us precise page and spread counts, fast page-number jumps, and stable navigation once pagination is complete.

That precision has a cost. The engine has to translate between rendered selections, highlight offsets, fragment targets, content anchors, chapter-local pages, and global pages. Readers that use approximate locations can treat navigation as a lighter-weight scroll/location problem; this reader pays more up front so later movement through the book can be exact.

The tradeoff is usually worth it on modern devices, but it shapes the rest of the architecture: pagination is isolated in a web worker, source data is cached aggressively, and the worker is scheduled so navigation stays responsive while expensive relayout work continues in the background.

## Worker scheduling

`pagination-v2` runs inside a dedicated web worker so expensive pagination work does not block React or the browser's main UI thread. The worker is still a single JavaScript event loop, though, so long synchronous jobs cannot be interrupted in the middle. To keep latency low, the engine exposes pagination work as resumable jobs that can be stepped by the worker scheduler.

The scheduler treats work as different priorities:

- navigation commands (`nextSpread`, `prevSpread`, `goToPage`, `goToChapter`, `goToTarget`) are user-priority work and should feel immediate;
- layout commands (`init`, `updateChapter`, `updatePaginationConfig`) can produce new page geometry and may take longer;
- background chapter additions are useful for completing the book, but should not delay interaction.

This job scheduling bears a passing similarity to React Fiber: split expensive work into units that can yield, resume, and be superseded. After each step, the worker can process newer commands, discard stale queued work, and run higher-priority navigation before returning to lower-priority relayout. Relayout jobs process chapters incrementally, usually in a middle-out order around the current anchor, so the visible area becomes correct before distant chapters finish.

Epochs keep events from old layout work from overwriting newer results on the main thread. Coalescing prevents repeated config changes or repeated navigation commands from forcing the worker to finish work that no longer matters.

## High-level stages

1. `Book -> ChapterEntry[]`
   We derive spine-aligned chapter metadata used by navigation and chapter loading.

2. `Chapter file -> base chapter content`
   We load a chapter file, process embedded resources, extract the body HTML, and derive canonical text.

3. `Base content + highlights -> decorated chapter artifact`
   We inject highlight markup into the HTML, then parse that highlighted HTML into pagination blocks.

4. `Decorated artifacts -> pagination feed`
   We initialize pagination with the first available chapter, stream the remaining chapters as they load, and send targeted chapter updates when highlight decoration changes a chapter's blocks.

5. `Pagination commands -> scheduled worker jobs`
   We enqueue init, chapter updates, config updates, background chapter additions, and navigation commands into the worker scheduler. The scheduler steps the highest-priority available job and yields back to the event loop between chunks of work.

## Invalidation rules

- `bookId` or `book` change:
  Reload base chapter content and reinitialize pagination.
- highlight data change:
  Re-run only the decoration stage for already loaded chapters, then update pagination for chapters whose highlighted HTML changed.
- pagination config or spread config change:
  Pagination handles relayout itself. Reader-side chapter content does not reload.

## Performance Optimization

Reader startup used to be dominated by materializing the source HTML. On slower Chrome on Android (Poco F3), opening a large EPUB spent most of the source time inside `Blob.text()`. This is less visible on faster devices like the iPhone 15 Pro Max or MacBook Pro M1 Pro.

The fix is to split reader startup into two caches.

Idea 1: A durable cache stores normalized chapter body HTML and canonical text. It is local-only, versioned, and rebuildable from the EPUB files. This removes repeated blob reads, embedded-resource normalization, image-dimension injection, body extraction, and canonical-text parsing from the steady-state open path. Work that depends only on the EPUB contents should happen when the EPUB is processed, not every time the reader opens.

Idea 2: Use React Query for a "hot cache". Reader startup data is expensive, and body cache rows, current checkpoint, highlights, and derived chapter artifacts all benefit from `QueryClient` deduping and reusing memory. When the queries are warm, the reader avoids the Dexie/IndexedDB hop entirely.

Idea 3: The `<Library>` prewarms the path users are likely to take next. "Continue-reading" books are fetched into memory, and hovered/pressed/focused book cards warm themselves before navigation. Even long books often have only 1-6 MB of chapter HTML, so the memory tradeoff is reasonable. In the best path, the reader opens with the body, checkpoint, highlights, and derived artifacts already in memory, so the source wall time falls effectively to zero and the remaining work is the pagination worker itself.

Idea 4: Precompute cautiously. Some derived artifacts can be prepared before the reader route opens, including highlighted chapter HTML and parsed pagination blocks. This can make the open path very fast, but background CPU still competes with active reading and library interaction. Background preparation should therefore be limited to likely-next books or likely-next chapters, and it should back off when the user is interacting.

The larger goal is to hide latency in layers: cache EPUB-derived HTML durably, keep likely reader inputs hot in memory, feed the worker as soon as the first chapter is available, and let the scheduler prioritize visible navigation over full-book completion.

## Firefox Pagination Performance Notes

Firefox has a specific slow path in full-book pagination that is much more visible with web fonts than with system fonts. The clearest example so far is *The Way of Kings* with EB Garamond enabled. Chrome completed the prepare stage in about 940ms, while Firefox took about 13.9s on the same book. The source load, visible-first-page time, cache behavior, and layout time were not the bottleneck.

Representative measurements:

| Browser/font | Prepare total | Pretext time | Other prepare time | Prepare calls | Cache misses | Layout total | Pagination total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Chrome / Garamond | 940.1ms | 847.6ms | 81.7ms | 16,873 | 15,492 | 565.9ms | 1506.0ms |
| Firefox / Garamond | 13,916.0ms | 13,776.0ms | 134.0ms | 16,873 | 15,484 | 55.0ms | 13,971.0ms |
| Firefox / Iowan | 1909.0ms | 1769.0ms | 133.0ms | 16,873 | 15,484 | 72.0ms | 1981.0ms |

The cache numbers are nearly identical between Chrome and Firefox, so this is not primarily a prepared-text cache hit/miss problem. The workload is also not dominated by one bad paragraph: the slowest individual `prepareWithSegments` run was only tens of milliseconds, and many slow runs were short strings. The cost is distributed across thousands of ordinary prepare calls.

Deep primitive profiling pointed at canvas text measurement rather than segmentation. In the slow Firefox/Garamond run, almost all pretext time was inside `measureText`; `Intl.Segmenter` word and grapheme work was small by comparison. Switching Firefox to Iowan or a monospace/system font brought prepare time back near the low-single-second range, which suggests the expensive path is tied to worker canvas measurement with loaded web fonts.

A stripped-down Playwright repro narrowed the browser behavior further. Measuring many strings with a single stable canvas font is fast in Firefox. The slowdown appears when the worker has multiple `FontFace` rules registered, especially @fontsource unicode-range slices, and the measurement loop repeatedly assigns `ctx.font` before short batches of `measureText` calls. That resembles pretext's internal pattern: each `prepareWithSegments(text, font, ...)` call sets the shared measurement context's font before measuring that text's segments.

On one local run, the default repro measured 1000 calls with the app-like font set:

| Case | Time |
| --- | ---: |
| Chromium worker `OffscreenCanvas` + EB Garamond | 7.0ms |
| Firefox worker `OffscreenCanvas` + EB Garamond | 49.0ms |
| Firefox page canvas + EB Garamond | 2.0ms |

The practical takeaway is that Firefox is paying an unusually high per-prepare measurement cost for web fonts in the pagination worker. Registering fewer worker font faces changes the repro cost, but that is only an observation so far, not a chosen product fix. Any mitigation has to preserve measurement/rendering agreement; measuring with one font and rendering with another would make page counts and line breaks drift.

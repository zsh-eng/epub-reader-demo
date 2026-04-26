# Reader

This reader has a small reader-side content pipeline before content reaches `pagination-v2`.

## Why the pipeline exists

- We load EPUB chapter files from IndexedDB-backed storage and normalize embedded resources before pagination sees the content.
- We keep `canonicalText` derived from the base chapter HTML, before highlight markup is injected.
- We inject highlights into the HTML before parsing it into pagination blocks so the rendered DOM, the parsed block structure, and the user's selection/highlight interactions all flow through the same representation.

That split gives us stable text offsets for highlight storage while still letting the rendered page include highlight markup.

## High-level stages

1. `Book -> ChapterEntry[]`
   We derive spine-aligned chapter metadata used by navigation and chapter loading.

2. `Chapter file -> base chapter content`
   We load a chapter file, process embedded resources, extract the body HTML, and derive canonical text.

3. `Base content + highlights -> decorated chapter artifact`
   We inject highlight markup into the HTML, then parse that highlighted HTML into pagination blocks.

4. `Decorated artifacts -> pagination feed`
   We initialize pagination with the first available chapter, stream the remaining chapters as they load, and send targeted chapter updates when highlight decoration changes a chapter's blocks.

## Invalidation rules

- `bookId` or `book` change:
  Reload base chapter content and reinitialize pagination.
- highlight data change:
  Re-run only the decoration stage for already loaded chapters, then update pagination for chapters whose highlighted HTML changed.
- pagination config or spread config change:
  Pagination handles relayout itself. Reader-side chapter content does not reload.

## Performance Optimization

Reader startup used to be dominated by materialising the source HTML. 
On slower Chrome on Android (Poco F3), opening a large EPUB spent most of  thesource time inside Blob.text().
This is not an issue on faster devices like the iPhone 15 Pro Max or Macbook Pro M1 Pro.

The fix is to split reader startup into two caches.

Idea 1: A durable cache stores normalized chapter body HTML and canonical text. It is local-only, versioned, and rebuildable from the EPUB files. This removes repeated blob reads, embedded-resource normalization, body extraction, and canonical-text parsing from the steady-state open path.

Idea 2: Use React Query for a "hot cache". Reader startup data is expensive and body cache rows, current checkpoint, highlights, and derived chapter artifacts all benefit from QueryClient sdeduping and reusing memory. When the queries are warm, the reader avoids the Dexie/IndexedDB hop entirely.

Idea 3: The `<Library>` prewarms the path users are likely to take next. "Continue-reading" books are fetched into memory (even for long books, the HTML is between 1-6MB), and hovered/pressed/focused book cards warm themselves before navigation. In the best path, the reader is opened with the body, checkpoint, and artifacts already in memory, so the "source wall time" (wall clock time for data fetching) falls effectively to zero and the remaining work is the pagination worker itself, which helps us avoid UI thrashing.

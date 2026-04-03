# New Pagination Core: Design Evaluation & Implementation Plan

## Context

The current pagination prototype has accumulated complexity: a revision/epoch system to discard stale worker events, derived state spread across refs and state, and no support for navigating pages while chapters are still being laid out. The goal is to rewrite the pagination core into a new directory (`src/lib/pagination-v2/`) — keeping the existing prototype untouched — and build a cleaner implementation that can be shipped as a real reader feature. The shell component and most UI components can be reused with minimal changes.

---

## Design Evaluation: Missing Pieces & Proposals

### 1. `processEmbeddedResources` Placement

**Missing from design.** Chapter HTML must be run through `processEmbeddedResources` (CSS inlining, image dimension injection) before being passed to `parseChapterHtml`. `parseChapterHtml` requires the DOM and runs on the main thread. The shell layer is responsible for this full pipeline: load HTML → `processEmbeddedResources` → `parseChapterHtml` → send blocks to the hook/worker. The pagination core only receives `Block[]`.

### 2. Navigation During Relayout — Worker Architecture

**Underspecified.** The concrete mechanism: after each `maybeYield()` in the relayout loop, the worker drains any pending navigation commands before continuing to the next chapter. Navigation commands (nextPage, prevPage, goToPage) are handled inline without restarting the relayout.

### 3. Epoch System — Keep Simple

One monotonic `layoutEpoch` integer, incremented on `init` and `updateConfig`. All events carry it; the hook discards events from older epochs. Simpler than the current revision system; handles the one real race (stale progress events from an interrupted relayout).

### 4. `ResolvedPage` — Rename from "Page"

The internal `Page` type in `layout-pages.ts` (array of `PageSlice[]`) conflicts with the proposed event payload name. The event payload is named **`ResolvedPage`**:

```ts
interface ResolvedPage {
  currentPage: number;
  totalPages: number;
  currentPageInChapter: number;
  totalPagesInChapter: number;
  chapterIndex: number;
  content: PageSlice[];
}
```

These values are **not cached** on the engine — they are computed via helper methods on demand. Iterating a few hundred chapter entries is microseconds.

### 5. `totalPagesInChapter` / `currentPageInChapter`

Included in `ResolvedPage`. Computed at resolution time by the engine's `buildResolvedPage()` helper using `chapterPageOffsets`. No caching needed.

### 6. HTML Loading Strategy

Load all chapter HTML files in one shot, run `processEmbeddedResources` + `parseChapterHtml` on all of them on the main thread (~60ms for long books). Send the first chapter's blocks inside the `init` command; send remaining chapters as `addChapter` commands immediately after. This ensures the engine always has at least one chapter from the moment of initialization.

### 7. Anchor is Always Non-Null After Init

The engine is not instantiated until the `init` command (which includes the first chapter) is received. Once initialized, `this.anchor` is always a valid `ContentAnchor` — either the `initialAnchor` passed in, or the middle-of-first-page anchor derived from the first chapter layout. `getCurrentPage()` reads `this.anchor` directly, takes no parameter.

### 8. `PaginationStatus` — Four States

```ts
type PaginationStatus = "idle" | "partial" | "recalculating" | "ready";
```

- `idle` — not yet initialized
- `partial` — first chapter laid out, remaining chapters pending
- `recalculating` — config changed, relayout in progress
- `ready` — all chapters laid out

### 9. Font Loading in Worker

`ensurePaginationWorkerFontsReady()` from `pagination-worker-fonts.ts` is reused as-is. The worker awaits it before processing any commands.

---

## Implementation Plan

### Directory

New code in `src/lib/pagination-v2/`. Nothing in `src/lib/pagination/` is touched until cutover.

**Reused directly (import from `../pagination/`):**

- `parse-html.ts`, `prepare-blocks.ts`, `layout-pages.ts` — no changes
- `pagination-worker-fonts.ts` — no changes
- `pagination-tracer.ts` — no changes

---

### Phase 1: Types (`engine-types.ts`, `types.ts`)

**`ContentAnchor` (discriminated union):**

```ts
type ContentAnchor =
  | {
      type: "text";
      chapterIndex: number;
      blockId: string;
      offset: TextCursorOffset;
    }
  | { type: "block"; chapterIndex: number; blockId: string };
```

**`ResolvedPage`:**

```ts
interface ResolvedPage {
  currentPage: number;
  totalPages: number;
  currentPageInChapter: number;
  totalPagesInChapter: number;
  chapterIndex: number;
  content: PageSlice[];
}
```

**Commands:**

- `InitCommand` — `{ totalChapters, config, initialChapterIndex, initialAnchor?, firstChapterBlocks: Block[] }`
- `AddChapterCommand` — `{ chapterIndex, blocks: Block[] }`
- `UpdateConfigCommand`, `NextPageCommand`, `PrevPageCommand`, `GoToPageCommand`, `GoToChapterCommand`

**Events:**

- `PartialReadyEvent` — `{ type: 'partialReady'; epoch: number; page: ResolvedPage; estimatedTotalPages: number }`
- `ReadyEvent` — `{ type: 'ready'; epoch: number; page: ResolvedPage }`
- `ProgressEvent` — `{ type: 'progress'; epoch: number; chaptersCompleted: number; totalChapters: number; estimatedTotalPages: number }`
- `PageContentEvent` — `{ type: 'pageContent'; epoch: number; page: ResolvedPage }`
- `PageUnavailableEvent` — `{ type: 'pageUnavailable'; epoch: number }`
- `ChapterUnavailableEvent` — `{ type: 'chapterUnavailable'; epoch: number; chapterIndex: number }`
- `ErrorEvent` — `{ type: 'error'; message: string }`

---

### Phase 2: Pagination Engine (`pagination-engine.ts`)

Key differences from existing engine:

- **Engine not instantiated until `init` is called** (with first chapter included)
- **`this.anchor: ContentAnchor`** — always valid after init, never null
- **No cached derived state** — `getTotalPages()`, `getCurrentPage()`, `buildResolvedPage()` are helper methods that compute from `pagesByChapter` / `chapterPageOffsets`
- **Anchor never updated during relayout** — only updated by navigation commands (nextPage, prevPage, goToPage, goToChapter)
- **`buildResolvedPage()`** — constructs `ResolvedPage` from `this.anchor` + chapter offsets; returns null only if anchor's chapter not yet laid out
- **Middle-out relayout order** — centered on `this.anchor.chapterIndex`

Key method signatures:

```ts
init(totalChapters, config, initialChapterIndex, initialAnchor, firstChapterBlocks)
addChapter(chapterIndex: number, blocks: Block[]): void
updateConfig(config: PaginationConfig, runtime: PaginationRuntime): Promise<void>
nextPage(): void
prevPage(): void
goToPage(page: number): void
goToChapter(chapterIndex: number): void
```

---

### Phase 3: Worker (`pagination.worker.ts`)

- `layoutEpoch` replaces revision system (incremented on `init` and `updateConfig`)
- At each `maybeYield()` boundary during relayout: drain pending navigation commands before continuing
- Command coalescing: collapse consecutive `updateConfig` into last one; collapse consecutive `nextPage/prevPage/goToPage` into last one; `init` and `addChapter` never coalesced

---

### Phase 4: Hook (`use-pagination.ts`)

```ts
interface UsePaginationResult {
  page: ResolvedPage | null;
  status: PaginationStatus;
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
  goToChapter: (chapterIndex: number) => void;
  addChapter: (chapterIndex: number, blocks: Block[]) => void;
  tracer: PaginationTracer;
  markFontSwitchIntent: (from: string, to: string) => void;
}

interface UsePaginationOptions {
  config: PaginationConfig;
  initialChapterIndex?: number;
  initialAnchor?: ContentAnchor;
}
```

- State: `{ page: ResolvedPage | null; status: PaginationStatus }`
- Epoch filter: discard events where `event.epoch < currentEpoch`
- No optimistic local navigation state — worker is single source of truth

---

### Phase 5: Shell Component (`src/components/ReaderV2/index.tsx`)

Loading strategy:

1. Load ALL chapter HTML files at once
2. Run `processEmbeddedResources` + `parseChapterHtml` on all chapters (main thread)
3. Call `usePagination` init via `totalChapters` change, passing `firstChapterBlocks` in init command
4. Send remaining `blocks` via `addChapter`

Reuse unchanged: `NavigationSection`, `SettingsSection`, `DebugSection`, `InspectorPanel`, `InspectorDrawer`, `LazyImage`

Renders `pagination.page?.content` instead of `pagination.slices`.

---

### Phase 6: Tests (`test/client/pagination-engine-v2.test.ts`)

1. Init with first chapter → `partialReady` → remaining chapters → `ready`
2. `nextPage` / `prevPage` / `goToPage` / `goToChapter` with full layout
3. Navigation at chapter boundaries
4. Anchor preserved across relayout (config change doesn't shift position)
5. Navigation command during relayout applied at yield boundary
6. Middle-out chapter ordering
7. `totalPagesInChapter` / `currentPageInChapter` correctness
8. `chapterUnavailable` when `goToChapter` targets unloaded chapter

Patterns from `test/client/pagination-engine-middle-out.test.ts`.

---

## Files to Create

| File                                                 | Notes                               |
| ---------------------------------------------------- | ----------------------------------- |
| `src/lib/pagination-v2/engine-types.ts`              | Commands, events, `ResolvedPage`    |
| `src/lib/pagination-v2/types.ts`                     | `ContentAnchor` discriminated union |
| `src/lib/pagination-v2/pagination-engine.ts`         | New engine                          |
| `src/lib/pagination-v2/pagination-worker-runtime.ts` | Epoch-based runtime                 |
| `src/lib/pagination-v2/pagination.worker.ts`         | New worker                          |
| `src/lib/pagination-v2/use-pagination.ts`            | New hook                            |
| `src/lib/pagination-v2/index.ts`                     | Public exports                      |
| `src/components/ReaderV2/index.tsx`                  | New shell                           |
| `test/client/pagination-engine-v2.test.ts`           | Tests                               |

## Files Reused (import from `../pagination/`)

`parse-html.ts`, `prepare-blocks.ts`, `layout-pages.ts`, `pagination-worker-fonts.ts`, `pagination-tracer.ts`

---

## Verification

1. `bun run build` — no type errors
2. Manual test: open book, navigate pages, change font, verify position preserved after relayout
3. Manual test: long book, navigate before all chapters load, verify smooth navigation
4. `bun run test test/client/pagination-engine-v2.test.ts`

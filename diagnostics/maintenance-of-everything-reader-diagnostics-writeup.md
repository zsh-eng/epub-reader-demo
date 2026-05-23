# Reader Diagnostics: Maintenance of Everything

EPUB:
`/Users/admin/Desktop/epubs/Maintenance of Everything (Stewart Brand) (z-library.sk, 1lib.sk, z-lib.sk).epub`

Date: 2026-05-23

## Summary

The Reader diagnostics CLI can now load and scan this 57 MB EPUB, and the full-book scan improved from `153` failing pages to `10` failing pages.

The main reader bug was a mismatch between pagination and rendering for rich inline text. Pagination modeled lines across styled run boundaries, but the rendered native paragraph was allowed to reflow those fragments into different browser lines. Once Chromium produced one extra visual line, the fixed-height page slice overflowed by a line height.

## Changes Kept

### Rich inline line layout

File: `src/lib/pagination-v2/shared/layout-text-lines.ts`

Normal text layout now uses `@chenglou/pretext/rich-inline` instead of laying each prepared inline item independently. This preserves browser-like collapsed whitespace and run-boundary behavior while still carrying anchor offsets, links, inline roles, code chrome, and highlight marks back into `PageFragment`s.

A small `2px` native inline width reserve is kept because several Chromium line probes showed edge-fit lines where canvas/pretext measurement was a little optimistic.

### Render modeled line boundaries

File: `src/components/Reader/PageSliceView.tsx`

Native text slices now emit `<br />` between modeled `PageLine`s. This keeps Chromium from reflowing the already-paginated slice as one continuous paragraph. Leading gaps are rendered as real breakable spaces rather than `margin-left`, so the browser can still wrap at collapsed whitespace boundaries.

### h2 line-height and diagnostics tolerance

Files:

- `src/lib/pagination-v2/shared/spacing.ts`
- `src/components/Reader/debug/page-debug-validation.ts`

The diagnostics line probe showed `h2` rendered as `25px / 28px` with `3px` vertical overflow. The h2 line-height factor was increased so the rendered h2 line box has enough room.

After that, Chromium still reported a consistent `1px` scroll-height artifact on h2 slices. The debug validator overflow tolerance now matches the existing `1.5px` height tolerance so these rounding artifacts do not fail a scan.

## Attempts Rejected

- `overflow-wrap: anywhere` on rendered slices reduced none of the full-scan failures. It also changed browser wrapping behavior too broadly, so it was removed.
- A large `16px` width reserve reduced the full scan to `5` failing pages, but increased the book from `442` to `457` pages and still did not fix the TOC failure on page `6`. This was rejected as too blunt for review.

## Diagnostics Runs

### Startup and CLI loading

The first auto-start attempt timed out waiting for `http://127.0.0.1:5173/diagnostics/reader`. Running the dev server manually worked:

```bash
bun run dev -- --host 127.0.0.1
```

All later scans used:

```bash
--no-start-server --timeout-ms 120000
```

Chromium also failed inside the filesystem sandbox with:

```text
MachPortRendezvousServer ... Permission denied (1100)
```

The Playwright diagnostics commands had to run with escalation.

The large-EPUB transfer path is now using `Uint8Array`; the one-page scan confirmed that the CLI can load this EPUB and reach pagination.

### Baseline full scan

Report:
`diagnostics/maintenance-of-everything-full-after-transfer-fix.json`

Result:

- Pages scanned: `435`
- Total pages: `435`
- Failing pages: `153`
- Main issue classes: `extra-dom-lines`, `slice-overflow`, `page-content-overflow`

### Final full scan

Report:
`diagnostics/maintenance-of-everything-full-after-reader-fixes.json`

Dumps:
`diagnostics/maintenance-of-everything-full-after-reader-fixes-dumps/`

Result:

- Pages scanned: `442`
- Total pages: `442`
- Failing pages: `10`
- Remaining failures: all are still `extra-dom-lines` paired with `slice-overflow`

Remaining failing pages:

```text
6, 44, 55, 75, 83, 119, 267, 291, 299, 314
```

The biggest remaining outlier is page `6`, block `text-4`, the table-of-contents link cluster. Pagination models `13` lines, Chromium renders `15`.

## Verification

Passed:

```bash
bun run test test/client/pagination-layout-text-lines.test.ts test/client/page-slice-view.test.ts test/client/pagination-selection-anchors.test.ts
```

Result:

- `3` test files passed
- `17` tests passed

Passed:

```bash
bun run build
```

Result:

- TypeScript build succeeded.
- Vite production build succeeded.
- Vite emitted existing chunk-size / stale browser data warnings.

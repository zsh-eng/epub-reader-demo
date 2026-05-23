# Reader Diagnostics: The Infinity Machine

## Scope

Primary EPUB:

`/Users/admin/Desktop/epubs/The_Infinity_Machine_Demis_Hassabis,_z_library_sk,_1lib_sk,.epub`

Additional formatting-heavy EPUB used after the primary book passed:

`/Users/admin/Desktop/epubs/The Pragmatic Programmer, 20th Annive... (Z-Library).epub`

One larger future target was also scanned:

`/Users/admin/Desktop/epubs/Systems Performance Enterprise and the Cloud (Brendan Gregg) (z-library.sk, 1lib.sk, z-lib.sk).epub`

All scans used the Reader diagnostics mobile baseline profile: 390x844,
Iowan, 16px font size, 1.5 line height, light theme, medium content width, and
paragraph spacing factor 0.8.

The dev server was reused on `http://127.0.0.1:5174/diagnostics/reader`
because `5173` was already occupied.

## Results

| EPUB | Before | After | Notes |
| --- | ---: | ---: | --- |
| The Infinity Machine | 9 failures / 907 pages | 0 failures / 907 pages | Fixed diagnostics false positives for superscripts. |
| The Pragmatic Programmer | 7 failures / 639 pages | 0 failures / 639 pages | Fixed native modeled-line rewrapping and zero-width-break drift. |
| Systems Performance | not scanned before this patch | 710 failures / 2491 pages | Not fixed here; separate line-height/rendered-height class. |

Key reports:

- `diagnostics/infinity-machine-full-before.json`
- `diagnostics/infinity-machine-full-after-final-fixes.json`
- `diagnostics/pragmatic-programmer-full-before.json`
- `diagnostics/pragmatic-programmer-full-after-final-fixes.json`
- `diagnostics/systems-performance-full-after-final-fixes.json`

## Bug 1: Superscripts Counted As Phantom Lines

The Infinity Machine baseline failed pages:

`158, 272, 402, 422, 477, 484, 715, 756, 845`

Every failure was `extra-dom-lines`. The dumps showed scientific notation and
footnote-like superscripts such as `10^20`, `10^70`, and `10^300`. The page
slice heights matched the model, but the visual-line collector grouped DOM rects
by nearly identical `top` positions. Raised superscript rects have different
tops from the baseline text, so diagnostics counted them as separate visual
lines even though Chromium had not produced extra rows.

Fix:

- `src/components/Reader/debug/page-debug-dump.ts`
- `test/client/page-debug-dump.test.ts`

`createVisualLineGroups` now accepts the slice line height and groups rect tops
within half a line height when that is known. This keeps raised inline rects
attached to their baseline row while still separating ordinary line-height
spaced rows. A focused unit test covers the superscript geometry.

## Bug 2: Modeled Native Lines Could Rewrap

The Pragmatic Programmer baseline failed pages:

`185, 246, 279, 332, 393, 508, 557`

Most failures were real `slice-overflow` with one extra visual line. The modeled
pagination slice had already split text into lines, but the native renderer
emitted each line's fragments directly followed by `<br>`. Chromium was still
free to wrap inside a modeled line before reaching the `<br>`.

Examples:

- A Clojure code-like paragraph modeled the first line as ending with `:pre`,
  while Chromium wrapped `:pre` onto its own visual line.
- A prose paragraph modeled a line as ending with a lone `W` from the next run,
  while Chromium wrapped that `W` onto its own visual line before the modeled
  break.

Fix:

- `src/components/Reader/PageSliceView.tsx`
- `test/client/page-slice-view.test.ts`

Native text rendering now wraps each modeled line in a `white-space: nowrap`
span, matching the manual-justify renderer's existing invariant that a modeled
line is one rendered line. The explicit `<br>` remains between modeled lines.
This fixed the full Pragmatic Programmer scan without changing its total page
count.

## Bug 3: Zero-Width Breaks Need Extra Width Reserve

The programming EPUB also contained code-like text with many `U+200B`
zero-width break characters. Pretext recognizes zero-width breaks, but the
browser's native wrapping at those boundaries was slightly more conservative in
the failing examples.

Fix:

- `src/lib/pagination-v2/shared/layout-text-lines.ts`
- `test/client/pagination-layout-text-lines.test.ts`

Native rich-inline layout now uses the existing 2px width reserve for ordinary
text and an 8px reserve when any prepared item contains `U+200B`. This keeps the
modeled lines closer to Chromium's zero-width-break behavior without changing
ordinary prose.

## Attempts Rejected

I tried guarding the rich-inline adapter against carrying a single grapheme from
the next run at the end of a line. It passed a focused unit case but did not
change the diagnostic slice for the real Pragmatic Programmer page, likely
because the rich-inline range included trailing empty fragments around the run
boundary. I removed that experiment and kept the simpler renderer-level line
invariant instead.

I also tuned a broader run-boundary width reserve from 3px through 10px. It was
not reliable in a full-book scan and started changing page counts, so it was not
kept.

## Remaining Work

Systems Performance is a good next target but not the same bug. Its full scan
after these fixes still had 710 failing pages out of 2491. The issue profile is
almost entirely `slice-overflow` with matching visual line counts:

- `slice-overflow`: 1565 issue instances
- `page-content-overflow`: 7 issue instances
- `extra-dom-lines`: 1 issue instance

Representative failures show rendered text slices a few pixels taller than the
modeled height while the visual line count matches. That points to a broader
rendered-height or line-height modeling mismatch for technical blocks, not
line rewrapping.

## Verification

Focused tests:

```bash
bun run test test/client/page-slice-view.test.ts test/client/pagination-layout-text-lines.test.ts test/client/page-debug-dump.test.ts
```

Full diagnostics:

```bash
bun run diagnostics:reader -- \
  --epub "/Users/admin/Desktop/epubs/The_Infinity_Machine_Demis_Hassabis,_z_library_sk,_1lib_sk,.epub" \
  --no-start-server \
  --url http://127.0.0.1:5174/diagnostics/reader \
  --timeout-ms 120000 \
  --out diagnostics/infinity-machine-full-after-final-fixes.json \
  --dumps-dir diagnostics/infinity-machine-full-after-final-fixes-dumps
```

```bash
bun run diagnostics:reader -- \
  --epub "/Users/admin/Desktop/epubs/The Pragmatic Programmer, 20th Annive... (Z-Library).epub" \
  --no-start-server \
  --url http://127.0.0.1:5174/diagnostics/reader \
  --timeout-ms 120000 \
  --out diagnostics/pragmatic-programmer-full-after-final-fixes.json \
  --dumps-dir diagnostics/pragmatic-programmer-full-after-final-fixes-dumps
```

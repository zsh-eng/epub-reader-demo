# Reader Diagnostics: The Player of Games, Pages 1-50

Date: 2026-05-23

EPUB:

`/Users/admin/Desktop/epubs/Culture_02_The_Player_of_Games_Iai_z_library_sk,_1lib_sk,.epub`

Diagnostic profile:

- `mobile-baseline`
- 390x844 container
- Iowan body/heading font
- 16px base font size
- 1.5 body line-height factor
- left text alignment

## Initial Scan

Command:

```bash
bun run diagnostics:reader -- \
  --epub "/Users/admin/Desktop/epubs/Culture_02_The_Player_of_Games_Iai_z_library_sk,_1lib_sk,.epub" \
  --from 1 \
  --to 50 \
  --out diagnostics/player-of-games-pages-1-50-before.json \
  --dumps-dir diagnostics/player-of-games-pages-1-50-before-dumps \
  --timeout-ms 60000
```

The first sandboxed run could not launch the browser. Running the diagnostics CLI with Playwright approval produced the real report.

Result:

- Pages scanned: 50
- Total pages: 605
- Failures: 4
- Failing pages: 2, 3, 4, 5
- Issue code: `slice-overflow`

The failures were all text-slice overflows. The modeled and visual line counts matched, which ruled out line wrapping as the primary bug.

## Evidence

The failing dumps showed that semibold Iowan headings were rendered taller than the line boxes pagination allocated:

- Page 2, `h1` title:
  - Modeled line height: `35px`
  - Rendered scroll height: `39px`
  - Overflow: `4px`
  - Visual line rect: `44px`
- Page 2, `h3` subtitle:
  - Modeled line height: `24px`
  - Rendered scroll height: `26px`
  - Overflow: `2px`
  - Visual line rect: `28px`

Pages 3, 4, and 5 had the same `h1` failure pattern.

## Attempted Change

The first code change increased the heading line-height factors enough to match the rendered scroll heights:

- `h1`: `35px` to `39px`
- `h3`: `24px` to `26px`

That reduced the failures but did not fully fix them:

- `h1` still overflowed by `2px`
- `h3` still overflowed by `1px`

The after-dumps showed that increasing line-height also changed the browser's internal placement of the glyph box. Matching only `scrollHeight` from the original dump was not enough; the modeled line box needed to cover the full visual glyph rect.

## Final Fix

The final code change updates the reader heading rhythm in `src/lib/pagination-v2/shared/spacing.ts`:

- `h1` line-height factor: `1.1` to `1.38`
- `h3` line-height factor: `1.18` to `1.37`

At the diagnostic profile, those constants produce:

- `h1`: `44px`
- `h3`: `28px`

Those values match the visual rect heights observed in the failing dumps.

A focused regression test was added in `test/client/pagination-layout-pages.test.ts` to lock the modeled h1/h3 line heights for the mobile Iowan diagnostic profile.

## Why This Fix Works

The pagination engine already chose the correct lines for each page. The bug was that the DOM render box for heading slices was shorter than Chromium's actual rendered Iowan semibold glyph box.

`PageSliceView` sets text-slice height to:

```ts
slice.lines.length * slice.lineHeight
```

For normal body text, the configured `24px` line height is enough. For the affected headings, the old factors created line boxes that were too tight:

- `h1` used `600 32px / 35px`
- `h3` used `600 20px / 24px`

Chromium rendered those Iowan heading glyphs outside the allocated slice height, so diagnostics reported `slice-overflow` even though no extra DOM lines were created. Increasing the modeled heading line heights keeps pagination and rendering in agreement.

## Verification

Focused unit test:

```bash
bun run test test/client/pagination-layout-pages.test.ts
```

Result:

- 1 test file passed
- 7 tests passed

Failed-page rescan:

```bash
bun run diagnostics:reader -- \
  --epub "/Users/admin/Desktop/epubs/Culture_02_The_Player_of_Games_Iai_z_library_sk,_1lib_sk,.epub" \
  --pages-from-report diagnostics/player-of-games-pages-1-50-before.json \
  --out diagnostics/player-of-games-pages-1-50-after-failed-pages-v2.json \
  --dumps-dir diagnostics/player-of-games-pages-1-50-after-failed-pages-v2-dumps \
  --timeout-ms 60000 \
  --no-start-server
```

Result:

- Pages scanned: 4
- Failures: 0

Full first-50-page rescan:

```bash
bun run diagnostics:reader -- \
  --epub "/Users/admin/Desktop/epubs/Culture_02_The_Player_of_Games_Iai_z_library_sk,_1lib_sk,.epub" \
  --from 1 \
  --to 50 \
  --out diagnostics/player-of-games-pages-1-50-after.json \
  --dumps-dir diagnostics/player-of-games-pages-1-50-after-dumps \
  --timeout-ms 60000 \
  --no-start-server
```

Result:

- Pages scanned: 50
- Total pages: 605
- Failures: 0

Build/type check:

```bash
bun run build
```

Result: passed. The build emitted existing bundle-size/chunking and stale browser-data warnings.

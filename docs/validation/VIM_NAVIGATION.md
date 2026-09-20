# Single-file Vim navigation

Vim mode is opt-in from the command palette and remains read-only. It applies only to the focused full-file pane. Palettes and text fields retain their own keys. Outside this pane, `?` still opens the command guide.

Supported motions: `h j k l`, counts, `w b e`, `0 ^ $`, `f t F T`, `; ,`, `gg G nG`, `Ctrl-D / Ctrl-U`, `zz`, and paragraph `{ }` with counts. Paragraph boundaries are empty lines (including CRLF), not whitespace-only lines. Insert mode, operators, visual mode, registers, and macros are out of scope.

`/` and `?` open a local file search. Typing previews literal smart-case matches against the exact loaded file content in a dedicated worker, without debounce. Lowercase queries ignore case; an uppercase letter makes the query case-sensitive. Every preview starts from the original cursor position. Enter accepts the preview; Escape restores the starting cursor and scroll position and clears highlights. Escape in normal mode clears highlights while retaining the search for `n/N`. `n/N` repeat in either direction; `*/#` search the current keyword with boundaries. Vim regular-expression syntax is not supported. The first 200,000 match positions are retained; the status says “First 200,000 matches” at that limit. Only mounted matches receive CSS highlights, at most 1,000 at a time.

The text model owns the cursor and cached line/grapheme indexes. React and Pierre items do not change on each motion. Tabs use two columns, matching the viewer style. Horizontal character movement does not split grapheme clusters. Vertical preferred columns account for tabs and common wide characters; complex-script font shaping is not a full terminal-cell emulator.

Pierre remains the only virtualizer. Local moves paint a range-sized caret over mounted code. A move outside the viewport uses Pierre's instant `scrollTo`; Pierre can coalesce pending requests before rendering. Cursor measurement runs after the renderer finishes, to avoid forced layout inside its render pass. Initial preview positioning retains its existing synchronous flush to avoid a first-frame jump.

## Browser measurements

Measured 2026-09-20 with headless Chromium through Vitest, 70 samples per scenario. The 40,000-line fixture is 1,297,780 ASCII bytes. The long-line fixture contains one 100,000-character ASCII line plus a second line.

| Scenario                                            | Key handler p50 / p95 | Correct visible cursor at a sampled frame p50 / p95 | Mounted rows at end |
| --------------------------------------------------- | --------------------: | --------------------------------------------------: | ------------------: |
| Local `j/k/w/b`, 40k lines                          |          0.6 / 0.8 ms |                                      17.4 / 18.6 ms |                  26 |
| Repeated `j` through viewport, 40k lines            |          0.1 / 0.7 ms |                                      22.6 / 38.2 ms |                  38 |
| Repeated `G/gg`, 40k lines                          |          0.1 / 0.2 ms |                                      19.1 / 39.2 ms |                  20 |
| Start/end/word/character moves, 100k-character line |          2.0 / 3.5 ms |                                      17.3 / 18.7 ms |                   3 |

These are synthetic key dispatch and DOM/frame observations, not display presentation timestamps or physical keyboard measurements. Each frame sample verifies that the visible caret has the requested line and column. The local motions fit within one sampled frame. Viewport scrolling and distant jumps can require about two frames at p95; they are not claimed to complete within 1 ms. The benchmark does not measure syntax highlighting of a 100k-character line (the fixture deliberately uses the existing plain-text path).

Before coalescing scroll requests and removing synchronous layout from render callbacks, the mixed 40k-line sequence had a 29.5 ms p95 key handler and a 53.6 ms p95 next-frame observation. The separated final scenarios above are the reproducible results; their different command mixes prevent treating this as a strict before/after ratio.

Raw results: [vim-navigation-benchmark.json](vim-navigation-benchmark.json).

Reproduce with `npm run test:browser -- tests/browser/full-file.test.tsx --reporter=verbose`. Look for the `VIM_BROWSER_BENCHMARK` test annotation. The same suite verifies the initial-jump behavior, virtualized row limits, native scrolling, search focus, preview highlights, and missing/binary metadata handling. Navigation unit tests cover counts, Unicode graphemes and words, tabs, CRLF paragraphs, find repeats, and smart-case search.

## Integrated validation

The final integration passed 324 unit/host tests (including the real Zoekt binaries), 64 Chromium UI tests, and 8 Go helper tests. After the last cursor callback change, all 19 affected file-view and App navigation tests passed again. TypeScript, Oxlint, formatting, and production builds passed.

Production screenshots use the existing Bun checkout: [project symbols](project-symbols.png), [file symbols](file-symbols.png), and [Vim navigation with file search](vim-navigation.png). The temporary validation host was stopped after capture. Universal Ctags and the v3 search helper are installed for the next normal launch.

# Read-only visual selection and copying

Implemented for full-file views. Enable Vim navigation from the command palette.

| Command                         | Result                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `v`                             | Start character selection. Press again to leave it.                                                  |
| `Shift+V`                       | Start whole-line selection. Press again to leave it.                                                 |
| `v` / `Shift+V` while selecting | Change the selection mode and keep the anchor.                                                       |
| Existing motions and counts     | Move the active end, including words, paragraphs, search, and file jumps.                            |
| `o`                             | Move the other end of the selection.                                                                 |
| `y`                             | Copy to the system clipboard. After success, leave visual mode and return to the start of the range. |
| `⌘C` / `Ctrl+C`                 | Copy the selection and keep visual mode active.                                                      |
| Escape                          | Clear the selection and keep the cursor position.                                                    |

Files remain read-only. Rectangular selection, editing operators, text objects, registers, macros, and multibuffer selections are outside this scope.

## Implementation

`vim-navigation.ts` stores the anchor and cursor in the loaded text model. Character endpoints include complete graphemes, including emoji and combining characters. Linewise copying includes existing line terminators; it does not add a missing final newline. Copy uses source text, so unmounted rows and gutter numbers do not affect the result.

`visual-selection.ts` uses CSS Highlight ranges for character selections. This reuses the same browser primitive as search highlighting. Ranges follow horizontal scrolling without a separate rectangle overlay or changes to syntax-token nodes. Only mounted rows are visited. Whole-line selection uses row background attributes; an empty character-selected line gets a one-cell marker. Both use the current cursor color at 45% opacity. This avoids changing Pierre's line selection, which also controls Git blame.

The painter refreshes after virtualized rendering and cursor movement. A file/source change, refreshed text, disabling Vim, or a file-symbol preview clears visual selection. Search input and ordinary palettes keep their normal key handling. Clipboard failures retain the selection and report an error. Late clipboard results cannot move a different file or revive a canceled selection.

## Validation

- Pure tests cover forward/reversed ranges, mode switching, endpoints, paragraphs, counts, CRLF, missing final newlines, empty lines, tabs, emoji, and combining characters.
- Browser tests copy character and line selections across 40,000 lines, verify bounded mounted rows, and check cancellation, file changes, platform copy events, and clipboard failures.
- Real production clipboard writes were checked with `y` and `⌘C` in Chromium on macOS. The prior clipboard was restored. Safari and Linux clipboard behavior were not tested in this run.

[Character selection screenshot](validation/visual-character.png) · [Line selection screenshot](validation/visual-line.png) · [Clipboard check](validation/visual-clipboard.json)

The full browser suite passed 86 tests. All 16 Vim model tests passed, along with type checking, lint, formatting, and the production build.

## Performance

[Measured data](validation/visual-selection-benchmark.json), Chromium headless, 40 samples per scenario. Key handler timings exclude frame presentation and clipboard work. Frame timings observe when the visible caret reaches the requested position, not when the display presents it.

| Scenario                                            | Key handler p95 | Observed frame p95 | Mounted rows |
| --------------------------------------------------- | --------------- | ------------------ | ------------ |
| Character selection, local movement in 40,000 lines | 0.7 ms          | 17.6 ms            | 28           |
| Character selection, jumps across 40,000 lines      | 0.3 ms          | 44.2 ms            | 21           |
| Line selection, jumps across 40,000 lines           | 0.4 ms          | 43.8 ms            | 21           |
| Character selection in a 100,000-character line     | 1.2 ms          | 16.9 ms            | 3            |

Selection state has two endpoints. Painting cost follows mounted rows and token nodes. Copy cost follows selected text size.

Reproduce the benchmark after installing dependencies:

```sh
npm run test:browser -- tests/browser/full-file.test.tsx -t 'benchmark: visual' --reporter=default --reporter=./scripts/visual-benchmark-reporter.mjs
```

Review order: text ranges in `src/web/data/vim-navigation.ts` → mounted-range painting in `src/web/data/visual-selection.ts` → input and clipboard integration in `src/web/data/use-file-vim.ts` → styles and status in `src/web/components/FullFileView.tsx` → pure and browser tests.

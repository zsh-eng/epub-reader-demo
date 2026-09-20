# Read-only visual selection and copying

Scope assessment after adding `:<line>`. Visual mode is not implemented in this change.

## Recommendation

Add whole-line selection first (`V`), then character selection (`v`). Both can use the current Vim model and Pierre viewer. No editor replacement, server endpoint, or new dependency is needed for this scope.

| Step               | Difficulty    | User behavior                                                                                    |
| ------------------ | ------------- | ------------------------------------------------------------------------------------------------ |
| Whole lines        | Low           | `V`, existing motions and counts, `y` to copy, Escape to leave selection                         |
| Characters         | Moderate      | `v`, inclusive character ranges across lines, `o` to move the other end                          |
| Rectangular blocks | Higher; defer | `Ctrl+V`, screen-column rectangles, tabs, wide characters, short lines and browser key conflicts |

The command conventions follow [Neovim visual mode](https://neovim.io/doc/user/visual.html). This remains a read-only subset: delete/change/insert operators, text objects, registers, macros, and multi-file selections are outside the first two steps. `gv` can follow later.

## Existing support

- `src/web/data/vim-navigation.ts` already owns the loaded text, line start offsets, grapheme boundaries, cursor, preferred column, and motion counts. Add an anchor and a selection mode to that model; retain one cursor.
- The installed Pierre 1.4.3 `CodeView` has `setSelectedLines`, `getSelectedLines`, and `clearSelectedLines`. Its public `SelectedLineRange` has line endpoints, not character endpoints. This fits `V` directly. Use `notify: false` when painting a Vim selection so arrow-key movement does not start Git blame requests through the existing selection callback.
- `src/web/data/search-highlights.ts` already paints CSS ranges inside Pierre's mounted shadow DOM. A separate visual-selection highlighter can reuse the text-node mapping approach. It should receive source offsets, not run a text search.
- Pierre also exposes editor selection APIs, but those require an editor instance. The current viewer uses its read-only rendering path. Turning on the editor only to select text adds integration work that this feature does not require.

## State, rendering, and copy

Store the anchor and cursor in the text model, keyed to the displayed file identity. Extend the current motion handler. Exiting the file, refreshing its bytes, or changing sources clears the selection. Typing in palettes and prompts must not change it; a symbol jump should end visual mode before previewing another location.

For `V`, map the normalized line endpoints to Pierre's line selection. For `v`, paint only the range portions that intersect mounted rows; rebuild those ranges after Pierre renders or scrolls. Empty selected lines need a visible marker because a zero-length text range has no area. Keep visual selection separate from search highlighting, with a clear precedence when both cover the same characters.

Copy from the loaded source string, not `window.getSelection()` or mounted DOM text. This preserves content from unmounted lines and excludes gutter numbers. Keep the original line endings and include each selected line's existing terminator for linewise copy. Character selection includes the complete final grapheme. No server read is needed.

`y` writes to the system clipboard and exits visual mode after success. Support the usual platform Copy shortcut through the focused file's copy event as well. If a clipboard write fails, retain selection and show an error; do not report a successful copy. The [Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText) is asynchronous and can reject writes. Escape clears the visual selection and keeps the current cursor position.

## Cost and verification

Selection bookkeeping needs only two endpoints; it does not grow with selected line count. Rendering work should track mounted rows and token nodes. Copy cost grows with selected bytes, and must be measured separately from navigation. Existing file-size limits still apply. These are design expectations, not measured results for an implemented visual mode.

Test forward and reversed selections, counts, paragraphs, blank lines, CRLF, missing final newlines, tabs, emoji and combining characters. Add browser checks for selection through unmounted lines, horizontal scrolling, source switches, Escape, search overlap, copy shortcuts and rejected clipboard writes. Measure key-handler and frame timing on the existing 40,000-line and long-line fixtures, and verify the mounted-row count stays bounded. Validate real clipboard writes in Chromium and the macOS browser used for the app before claiming cross-browser support.

Implementation order: model and exact copy ranges → line-selection adapter and `V` → character highlight adapter and `v` → clipboard/focus integration → browser and performance validation. The pure range tests and character highlighter can be built independently after the model contract is fixed.

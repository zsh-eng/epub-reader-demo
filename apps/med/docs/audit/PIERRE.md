# Pierre integration constraints

Checked 2026-09-19 against official live documentation and upstream `main` source. These links are mutable, not a release lock. The fetched Diffs `main` manifest reports **1.4.3**; audited Hunk pins **1.3.5**. Exact 1.3.5 declarations could not be fetched in this check. Do not assume the APIs below exist unchanged in that version. No installation or runtime test was performed. [Current manifest](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/package.json#L1-L3), [Hunk pin](https://github.com/modem-dev/hunk/blob/9b95a71b76c472bad21ffa5cc6b01b204e2f6f7a/packages/hunk/package.json#L65).

## Continuous stream and updates

Current `CodeView` owns one scroll region, line virtualization, measured layout, sticky headers and item/line reveal. Use it as the first integration candidate. [Official guide](https://diffs.com/llms-full.txt).

Every item needs a unique `id`. Updating a record with the same `version` is ignored by `syncItemRecord`; changing the object alone is insufficient. Increment `version` for content, annotation and collapse changes. `setItems` reconciles the full list and captures an anchor; append has a separate fast path. Public methods include `getRenderedItems`, `subscribeToScroll` and `getTopForItem`. These can inform scheduling, but they are not a promised generic lazy-data API. [Implementation: update contract](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/components/CodeView.ts#L2695-L2717), [rendered items and scroll subscription](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/components/CodeView.ts#L1843-L1934).

React offers controlled `items` or imperative `initialItems` plus a ref. Choose one ownership model per mount. The ref exposes item updates, `scrollTo`, line selection and `getInstance`. Custom headers, annotations and gutter utilities receive the owning item. React portals that content into the item's host. [React API](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/react/CodeView.tsx#L121-L158), [annotation adapter](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/react/CodeView.tsx#L905-L969).

Recommendation: start controlled, with a thin adapter that maps canonical review keys to render IDs and maintains per-item versions. Keep content identity separate from display identity.

## Important lazy-loading constraint

The public item union has only `file` with `FileContents`, or `diff` with `FileDiffMetadata`. There is **no unloaded, placeholder, error, or arbitrary-card item type** in the inspected declaration. Collapse still requires a valid item. [Item types](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/types.ts#L513-L543).

`loadDiffFiles(fileDiff)` loads full source files for an existing partial diff. Expansion invokes the loader; completion checks that the renderer still uses the same metadata before hydration. Hydration mutates that metadata. This is not an initial patch loader. [Hydration implementation](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/components/FileDiff.ts#L1096-L1178).

**Integration gate:** do not promise metadata-only placeholders or bounded eviction of all offscreen patches as existing CodeView features. Prove a supported strategy first. A first candidate can populate the tree immediately, append valid parsed patches in canonical order, and lazily load full sources. Measure retained patch memory. If strict memory bounds require placeholder records, seek an explicit Pierre API or assess the lower-level renderer deliberately. Do not construct fake empty diffs and present them as loaded files. A file selected before its patch arrives needs a pending reveal request.

## Selection and annotation mapping

`SelectedLineRange` contains start/end lines and optional start/end sides. `DiffLineAnnotation` has `side: 'additions' | 'deletions'`, `lineNumber`, and metadata. Map Hunk `new` to `additions` and `old` to `deletions`; use note IDs in metadata. A range note still needs one chosen render anchor. Item and range scroll targets accept IDs and alignment. [Public types](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/types.ts#L485-L586).

CodeView's selected-lines state is `{ id, range }`: one item's range at a time. “Viewer-wide selection” does not establish semantic multi-file range selection. Native text-copy behavior across virtualized items requires separate testing. [Selection shape](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/components/CodeView.ts#L201-L204).

## StyleX and shadow roots

Diff rows live in Shadow DOM. Ordinary application selectors cannot style those rows directly. Set documented CSS variables on the host/ancestor and use Pierre themes. Annotation slots accept normal application styling. `unsafeCSS` injects internal CSS, but its compatibility is not guaranteed even across patch releases. Keep it out of the default design. Custom line metrics need validation with `__devOnlyValidateItemHeights`; do not leave that diagnostic enabled for performance measurements. [Styling and metrics guide](https://diffs.com/llms-full.txt).

Recommendation: StyleX styles the shell, Base UI controls and note cards. A small theme adapter sets Pierre's documented variables, such as `--diffs-font-family`, `--diffs-font-size`, `--diffs-line-height`, and addition/deletion color overrides. Verify note popups and dialogs inherit the same tokens after portal mounting.

## Trees boundary

Trees is marked beta. Its public identities are canonical paths, not our review file keys. Use a path-to-key map, with explicit handling for renames and repeated paths in multi-commit reviews. `useFileTree` creates its model once; later hook option changes do not update it. Use methods such as `resetPaths`, `setGitStatus`, and `setComposition`. Prepare large inputs outside rendering with the public preparation helpers. Trees already virtualizes rows. [Official Trees API](https://trees.software/llms-full.txt).

Recommendation: use one canonical filtered file set for both tree and stream. Prove that tree sorting matches review order; do not assume arbitrary Hunk sidecar order fits a hierarchical path tree. Either preserve a flat ordered-list option or define the intended ordering change. Keep tree search from becoming a second incompatible file-filter policy.

## Required proof before parallel feature work

1. Pin an exact published Diffs/Trees pair; inspect that pair's exports and declarations in the production Vite build.
2. Load many valid patches into one stream; jump to an unloaded file; test cancellation and stale completion after a comparison change.
3. Replace one patch under the same ID with a new version. Check selection, note drafts and the viewport anchor.
4. Expand context from exact captured old/new contents. Change the worktree while the fetch is pending and verify no mixed-version display.
5. Test split/unified toggles, custom font metrics, note insertion above the viewport, selection and copy during virtualization, and theme changes across shadow/portal boundaries.
6. Measure model memory, worker memory, startup time and scroll behavior separately. DOM virtualization alone does not prove bounded content memory.

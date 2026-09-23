# Replacing Shiki in Pierre

Investigated on 2026-09-24 against med's installed Pierre Diffs 1.4.3.

**Shiki is not a requirement for Pierre's diff layout, virtualization, comments, or file navigation. A complete highlighting-engine replacement is feasible.** The earlier fallback recommendation was a way to preserve language coverage during migration, not a fundamental requirement of the renderer.

The isolated adapter probe passes six checks through Pierre's real file/diff rendering utilities. med's running app still uses Shiki. This is evidence for the integration boundary, not a completed app migration.

## Current path

1. `src/web/main.tsx` creates a Pierre worker pool with one to three workers and an AST cache. med uses Pierre's default `shiki-js` engine.
2. `WorkerPoolManager` resolves language names into Shiki/TextMate grammar data on the main thread. It resolves theme definitions and sends these to the workers. Its queue, result cache, and render-options version checks are also here.
3. Each worker creates a shared Shiki highlighter, attaches grammars/themes, and handles file/diff requests.
4. `renderFileWithHighlighter` or `renderDiffWithHighlighter` calls `highlighter.codeToHast`. HAST is a tree of HTML elements and text. A diff highlights its before/after content separately. Pierre calculates word/character change ranges and passes them to this call as decorations.
5. Pierre's transformers turn the coloured spans into line nodes. They attach line numbers, before/after change types, paired line numbers, diff-row indexes, and token-column metadata. Word-change wrappers must survive this stage.
6. The worker returns those nodes and theme styles. Pierre's renderers use them for the visible file/diff rows. They control scrolling, folding, split/unified layout, selection, gutters, and annotations.

There is also a main-thread highlighting path in `FileRenderer` and `DiffHunksRenderer`. Replacing only the worker would leave that Shiki path active. med's theme preview code in `src/web/pierre-theme.ts` resolves upstream syntax themes and sends updated themes to the pool.

The public `preferredHighlighter` option accepts only `shiki-js` and `shiki-wasm`. Registering a custom language still expects a TextMate grammar; it does not install another tokenizer. The package's streaming/editor entry points also use Shiki, but med does not currently use those components.

## Probe result

`scripts/highlighters/pierre-adapter.mjs` supplies a small object with `getTheme` and `codeToHast`, the methods used by these two renderer utilities. It uses Twinkleplop's TypeScript/TSX token ranges directly and constructs line/span nodes. It never calls Twinkleplop's HTML renderer or Shiki's tokenizer.

`scripts/probe-pierre-highlighter.mjs` invokes the real, unmodified Pierre render utilities. All six checks pass:

| Check                                        | Result                                                          |
| -------------------------------------------- | --------------------------------------------------------------- |
| CRLF, Unicode, empty lines, trailing newline | Correct four line nodes; no doubled CRLF lines                  |
| Token columns                                | `data-char` reaches Pierre's output, including Unicode text     |
| Diff line identity                           | Before/after lines 38–40 and change types remain correct        |
| Word diff                                    | `10` and `20` retain their `data-diff-span` wrappers            |
| Light/dark colours                           | Both token-colour variables and theme surfaces reach the result |
| Unsupported language                         | C++ fails explicitly; no hidden Shiki fallback                  |

Reproduce after the [benchmark dependency setup](HIGHLIGHTERS.md#reproduce):

```sh
node scripts/probe-pierre-highlighter.mjs
```

This probe intentionally uses version-checked private module paths. It still imports Pierre utilities, including the utility that imports `@shikijs/transformers`. It proves that **Shiki tokenization is unnecessary at this boundary**, not that the complete dependency graph is already free of Shiki. It is not a general Shiki-compatible API implementation. It supports only the tested languages, two probe themes, and Pierre's single-line word decorations. It does not implement long-line limits, arbitrary third-party transformers, worker transport, renderer-cache integration, or actual browser selection/comment gestures.

## Complete replacement design

Keep Pierre's renderer and introduce an engine interface beneath it. Prefer a maintained Pierre patch/fork or an upstream extension over application code that pretends to be the full Shiki API.

| Layer              | Required change                                                                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language loader    | Map filenames/aliases to Twinkleplop factories. Load those modules directly instead of resolving/transferring TextMate grammars.                                                                                                                                                                         |
| Token conversion   | Split token ranges at line and decoration boundaries; preserve whitespace, UTF-16 columns, empty lines, and newline policy. Emit Pierre's existing line/span format.                                                                                                                                     |
| Diff assembly      | Keep Pierre's before/after grouping, hunk metadata, and word/character diff calculation. Apply its decorations to the new token spans.                                                                                                                                                                   |
| Themes             | Map med's syntax palettes to Twinkleplop token types. Retain shell colours and theme-preview invalidation. Theme data can exist without the Shiki tokenizer, but exact scope-to-token colour parity is not automatic.                                                                                    |
| Workers and cache  | Keep scheduling, cancellation/version guards, and AST caching. Replace initialization and language/theme payloads in both worker and main-thread paths. Cache identity must distinguish engine and grammar/theme revisions.                                                                              |
| Dependency removal | Remove unused Shiki exports/imports, `@shikijs/transformers`, and default Shiki language/theme resolution from the patched entry points. Audit Pierre theme/tree packages and the actual production bundle separately; a transitive npm dependency and a shipped browser tokenizer are different things. |

A complete migration must pass the existing browser tests for comments, selection, Vim navigation, empty lines, context expansion, theme preview, and split/unified diffs. It also needs direct tests for partial patches, renames with different before/after languages, large-file limits, cancelled requests, and stale theme/grammar results. Then measure the complete worker-to-renderer path on the benchmark corpus.

## Language coverage and the earlier fallback recommendation

Twinkleplop's current upstream language directory has 23 entries, including JavaScript, TypeScript, TSX, Rust, Go, Python, HTML, CSS, SQL, and Svelte. It has no C/C++/Zig grammar in that directory. The earlier npm check agrees. Bun's C++ files are the concrete coverage gap for our benchmark repositories. Source: [upstream languages](https://github.com/pngwn/twinkleplop/tree/main/languages), checked through the GitHub API on 2026-09-24.

Without Shiki, unsupported files can still be viewed, diffed, and commented on as plain text. Preserving syntax highlighting for them requires adding grammars. We should define the required language set per med's supported use cases and add missing grammars before claiming equivalent coverage. Reusing Shiki's TextMate grammars is not a direct substitution for Twinkleplop's grammar format.

The previous CRLF finding is not a blocker for this design: direct token conversion avoids the HTML renderer and the probe preserves line counts. Markdown embedded languages are also solvable by tokenizing fenced regions with the appropriate factory and adjusting offsets; that work must be included in performance and correctness tests. Neither issue requires Shiki as a permanent fallback.

**Recommended direction:** target a single Twinkleplop engine, keep Pierre for rendering, and make unsupported-language coverage explicit. The adapter probe removes the main architecture uncertainty. The remaining scope is a renderer integration patch plus language/theme coverage and end-to-end validation. Do not silently treat lost highlighting as a completed replacement.

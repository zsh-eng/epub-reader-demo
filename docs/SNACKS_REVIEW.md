# Snacks feature review

Reviewed against the upstream [picker](https://github.com/folke/snacks.nvim/blob/main/docs/picker.md), [explorer](https://github.com/folke/snacks.nvim/blob/main/docs/explorer.md), and [module list](https://github.com/folke/snacks.nvim). This is a product comparison, not a Snacks integration.

| Idea                                     | Status                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| File preview inside picker               | Implemented. Highlight a result to preview it; Enter opens; Escape preserves the workspace view.                |
| Smart open/recent files                  | Implemented. Open and recently used paths receive a ranking bonus within the current workspace.                 |
| Resume search                            | Implemented. Restore mode, query, selected result, and preview scroll within the current source.                |
| Content search and line preview          | Implemented. Literal case-insensitive search, source-scoped results, selected-line preview.                     |
| Selected-line Git blame                  | Implemented independently of Snacks. On-demand author, commit, date and summary for at most 200 selected lines. |
| Navigation back/forward                  | Still proposed.                                                                                                 |
| File-level Git history                   | Still proposed. Repository commit history already exists.                                                       |
| Open beside diff                         | Still proposed. Current files use tabs.                                                                         |
| Explorer status badges and hidden toggle | Still proposed. Current-file reveal and ignored toggle exist.                                                   |
| Live themes and large-file limits        | Already implemented.                                                                                            |

## Picker behavior

The highlighted result controls a preview inside the picker. It does not change the active file tab or diff scroll. Enter opens the selected file; Escape closes the picker. The file and content modes remember their own query and selection. Resume selects the last-used mode for that source. Normal reopening also retains the chosen mode's query.

File ranking uses only entries from the current manifest. Open and recent paths never add files from another source. Recent paths are session-only, bounded to 50 per workspace. Picker query/selection records are bounded to 16 source/mode sessions, with at most 50 preview scroll positions per session. The preview retains one file response, not an unbounded text cache.

File previews start after a short selection delay and cancel obsolete reads. Content search uses a separate typing delay, with a visible pending state. Both reject responses from a different source. Preview text uses the existing binary, byte and line limits. No new editor, virtualizer, or runtime dependency was added.

## Git blame and Pierre

The installed `@pierre/diffs` 1.4.3 exposes file rendering, line selection and annotations; it has no built-in Git blame API. The [official package README](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/README.md) describes these renderer primitives.

Our host runs `git blame --line-porcelain` on demand. Worktree blame uses verified file content and checks the file identity and HEAD again afterward. Commit blame uses the exact object ID. The UI shows attribution for the selected lines; it does not add an always-on gutter for every line. Uncommitted lines are labeled explicitly, and a file without history shows a clear state.

## Shortcuts and shell

The repository title bar has been removed. The branch bar remains, and duplicate tab labels get the shortest useful path context. The question-mark button in the status bar and the `?` key open the same searchable command guide with semantic `kbd` keycaps. Commands that do not apply are disabled.

| Shortcut        | Action                                     |
| --------------- | ------------------------------------------ |
| `?`             | Shortcuts and commands                     |
| Command–K       | Command palette                            |
| Command–Shift–K | File picker                                |
| Command–Shift–F | Search workspace contents                  |
| Option–R        | Resume last file search                    |
| Command–B       | Left sidebar                               |
| Command–Shift–B | Right Files sidebar                        |
| Option–W        | Close current file                         |
| Option–Shift–W  | Close all files in the current workspace   |
| Option–Shift–O  | Close other files in the current workspace |
| Option–P        | Keep preview tab open                      |
| Option–B        | Toggle selected-line Git blame             |

Control is also accepted in place of Command. Option shortcuts use physical key codes so macOS alternate characters do not break them. File actions and `?` do not run while typing or inside another dialog. Space has no application binding. The permanent Changes tab cannot be closed.

Terminal integration, dashboards, scratch buffers, file mutation, language-server features, and image/PDF rendering remain outside this iteration.

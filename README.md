# med

A local Git review app for macOS and Omarchy Linux. Review changes, explore branches, and read code without changing your checkout.

![Commit history, changed files, and a continuous split diff](docs/README-main.png)

## What you can do

- **Review changes in one view.** Scroll through all changed files. Use split or unified diffs, expand context, wrap lines, and add notes to selected lines.
- **Explore branches and worktrees.** Switch between branch tabs, browse commit history, and inspect working changes. Read branches without a worktree directly from Git.
- **Read full files.** Browse unchanged and untracked files, keep files in tabs, and open historical versions from a diff.
- **Find code.** Search file names or committed file contents with a code preview. Jump to symbols in a file or across a project. Resume your last search.
- **See who changed a line.** Toggle gutter blame in a full file to see the author and commit. Hover a label for the date and commit message.
- **Use the keyboard.** Open the command palette, find shortcuts, or use Vim navigation for movement, search, and text selection.
- **Choose a theme.** Preview Vitesse, Rosé Pine, Tokyo Night, and Graphite themes before applying one.

![File search with matching paths and a code preview](docs/validation/picker-preview.png)

med runs in your browser with a local server. It does not edit reviewed files, stage changes, switch branches, or run code from the repository. Review notes stay on the local host for the session.

## Get started

From a checkout of this project, with Git and Node **22.12 or newer** installed:

```sh
npm ci
npm run build
node dist/cli.js /path/to/repository
```

The command opens the app in your browser. Keep the terminal open; press `Ctrl+C` to stop it. The npm package is not published yet.

### Optional search tools

- **Universal Ctags** enables symbol search. Install it with `brew install universal-ctags` on macOS or `sudo pacman -S ctags` on Omarchy.
- **Zoekt** adds indexed branch search and is required for project symbol search. With Go installed, run `node dist/cli.js --setup-search` once.

Content search reads **committed content**. It does not include uncommitted or untracked changes. Without Zoekt, content search falls back to Git. Symbol language support depends on the installed Ctags parsers.

## Useful shortcuts

On Linux, use `Ctrl` in place of `⌘`.

| Action                     | Shortcut |
| -------------------------- | -------- |
| Command palette            | `⌘K`     |
| Find a file                | `⌘⇧K`    |
| Search file contents       | `⌘⇧F`    |
| Symbols in this file       | `⌘O`     |
| Symbols in the project     | `⌘⇧O`    |
| All commands and shortcuts | `?`      |

Vim navigation is enabled by default; the command palette can toggle it. In a focused Vim file view, `?` searches backward; use `⌘K` to open commands.

See the [usage guide](docs/USAGE.md) for all shortcuts, search setup, patch and file inputs, and limits.

## Libraries and tools

| Project                                                            | Use in med                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| [Pierre Diffs and Trees](https://github.com/pierrecomputer/pierre) | Code and diff rendering; file trees                    |
| [Base UI](https://base-ui.com/)                                    | UI controls and dialogs                                |
| [Universal Ctags](https://github.com/universal-ctags/ctags)        | Symbol extraction                                      |
| [Zoekt](https://github.com/sourcegraph/zoekt)                      | Indexed search across committed branches               |
| [React](https://react.dev/) and [StyleX](https://stylexjs.com/)    | UI components and styles                               |
| [Chokidar](https://github.com/paulmillr/chokidar)                  | Watch repository changes                               |
| [Zod](https://zod.dev/)                                            | Validate messages between the browser and local server |
| [Geist and Geist Mono](upstream/GEIST.md)                          | Locally loaded fonts                                   |

Build and test tools: TypeScript, Vite, Vitest, Playwright, Oxlint, and Oxfmt. See [package.json](package.json) for the full list and pinned versions.

### Design and source references

- **[Zed](https://zed.dev/)** — a reference for selected UI designs, including theme preview, confirm, and dismiss behavior. See [theme provenance](upstream/THEMES.md).
- **[snacks.nvim](https://github.com/folke/snacks.nvim)** — a reference for the file picker and code preview. See the [feature comparison](docs/SNACKS_REVIEW.md).
- **Hunk** — adapted review logic and tests. See [source provenance](upstream/HUNK.md) and the original [MIT notice](upstream/HUNK-LICENSE).

## Development

```sh
npm run dev -- /path/to/repository
```

Open the Vite URL with the `#token=…` fragment printed by the API host.

See the [architecture](ARCHITECTURE.md), [development checks](docs/USAGE.md#development), and [limits and validation reports](docs/USAGE.md#limits-and-evidence).

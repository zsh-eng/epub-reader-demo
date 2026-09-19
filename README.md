# med

A local Git review application with a commit graph, a changed-file tree, and one continuous diff stream. Built with React, Pierre Diffs/Trees, Base UI, StyleX, and Vite. It reads Git objects; selecting a commit does not check it out.

## Run from this checkout

```sh
npm ci
npm run build
node dist/cli.js /path/to/repository
```

The CLI prints a private local URL and opens the browser. Use `--no-open` to print the URL only. Use `--port 4173` for a stable local address. Git and Node 22.12+ are required; development and validation use Node 24 LTS.

The package is not published yet. Test the actual npm tarball locally:

```sh
npm pack
npx --yes --package ./med-diff-0.1.0.tgz med-diff /path/to/repository
bunx --package ./med-diff-0.1.0.tgz med-diff /path/to/repository
```

`bunx` package launch and execution under the Bun runtime are different checks. The executable has a Node shebang. The installed package serves compiled files; Vite is only a development/build tool.

## Review

- Select a commit in the graph to compare it with its first parent. Merge commits are labeled as first-parent comparisons. Root commits compare with an empty tree. A missing parent in a shallow clone produces an explicit error.
- Select working, staged, or unstaged changes, or compare two explicit revisions.
- Open a standalone patch with `med-diff --patch change.patch` or pipe it with `git diff | med-diff --patch -`. Compare two files with `med-diff --files old.ts new.ts`.
- Use the top branch tabs to select an existing worktree automatically. Branches without a worktree show committed files and history without checkout. Use the + button to find more branches.
- Use ⌘B (Ctrl+B on other platforms) to hide or show the sidebar.
- Open Change theme for live previews: Vitesse, Rosé Pine, Tokyo Night, and neutral Graphite palettes. Arrow keys preview, Enter saves, and Escape restores.
- Geist and Geist Mono are served locally; no external font request is required.
- Select a changed path to reveal it in the continuous stream. All changed paths stay in the file tree, including files without renderable text.
- Switch split/unified view, toggle line wrapping, filter paths, find changed text, expand context, and add review notes to selected lines.
- Use the command menu for available keyboard actions and display options.

The application does not stage changes, change branches, run repository scripts, or modify reviewed source files.

## Browse full files

Open the right Files sidebar to browse the active worktree, including unchanged and untracked files. Single-click to preview; double-click or press Enter on a selected file to keep its tab. Changes remains open beside file tabs. Double-clicking a path in the Changes list opens its current working file, even when the diff shows an older commit. Missing files show an explicit message.

Use **⌘⇧K**, or the command guide (`?`) for the workspace-scoped file picker. It supports fuzzy paths and `file:line`, with at most 50 results. Use **⌘B** for the left sidebar and **⌘⇧B** for the right sidebar. The branch bar remains; the separate title bar has been removed. Space has no application shortcut. Branches without a worktree browse their resolved commit; no checkout occurs. Where available, **Open before** and **Open after** open the exact historical diff versions.

Binary and unsupported files show metadata only. Text above 8 MiB, 200,000 lines, or 250,000 characters on one line is not rendered. Supported text above 1 MiB or with a line above 20,000 characters uses plain-text rendering. The file manifest is capped at 50,000 entries; directories are not loaded in pages. [File browsing behavior and limits](docs/FILE_BROWSING.md) describes source identity, tab retention, refresh, and remaining scope.

Picker results now have content previews, scoped open/recent ranking, and search resume (**⌥R**). Use **⌘⇧F** for workspace content search. Full-file views support selected-line Git blame (**⌥B**). Press **?** for the full command guide, including file close actions. See [navigation behavior](docs/SNACKS_REVIEW.md).

## Development and checks

```sh
npm run dev -- /path/to/repository
npm run typecheck
npm run lint
npm run test:unit
npm run test:browser
npm run format:check
npm run build
```

Development prints the API host URL with a capability token. Open the Vite URL with the same `#token=…` fragment. Vite proxies API requests to the local host. A production build needs no development proxy.

Vite 8 supplies Rolldown and Oxc. StyleX uses its official Vite plugin and its build-time Babel compiler. Oxlint runs the StyleX validation plugin directly; a test verifies that an invalid declaration fails. Oxfmt handles formatting. Vitest runs the retained Hunk semantics, host/protocol tests, and real-browser tests. Zod 4.6.5 was the latest stable npm release at installation and is pinned exactly.

## Validation

The reproducible host benchmark uses a separate, ignored checkout:

```sh
git -c core.hooksPath=/dev/null clone --depth=200 --single-branch --no-tags https://github.com/oven-sh/bun.git .benchmarks/bun
npm run build
node scripts/benchmark.mjs .benchmarks/bun
```

No Bun source code or install script is run. The benchmark records repository identity, sample commits, request timing, host memory, and unchanged HEAD. First-request and cached timings are separate. Browser rendering is measured separately; HTTP timings do not establish paint or scroll performance.

See [baseline performance](docs/validation/RESULTS.md) and [theme/workspace validation](docs/validation/UI_UPDATE.md) for measured scope, screenshots, and current limits.

## Boundaries

- This is the first graphical implementation, not complete Hunk feature parity. The Hunk daemon wire protocol, agent/extension host, JJ/Sapling, rich STML, terminal modes, and native desktop packaging are not implemented.
- Commit history is paged from the selected worktree's HEAD ancestry. It is not an all-repository branch explorer.
- Review notes are session data, held by the local host; closing it ends the session. There is no account or cloud service.
- Patch, source, request, and cache sizes are bounded. Very large and non-text inputs show an explicit limitation.
- Context expansion for mutable files rejects stale sources. It cannot combine an old patch with newly saved file contents.
- Browser preferences belong to the local origin. Use a fixed port to retain them across restarts.

Hunk's retained semantic source and tests carry their original MIT notice in [upstream/HUNK-LICENSE](upstream/HUNK-LICENSE). [Source provenance](upstream/HUNK.md) records the pinned revision and adaptations. Application architecture and audit evidence are in [ARCHITECTURE.md](ARCHITECTURE.md).

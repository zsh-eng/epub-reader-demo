# Review links and agent comments

med connects an agent's changes to a local review. A review can contain comparisons from several registered repositories. Its link has no access token. Comments are saved locally and can be copied together as Markdown for any agent.

## Start and connect

Build med, then start it with the repositories you want to review:

```sh
node /Users/admin/med/dist/cli.js \
  /Users/admin/spaced2 \
  /Users/admin/epub-reader-demo \
  /Users/admin/med
```

The default address is `http://127.0.0.1:4173`. An occupied port produces an error; med does not silently change the address. Use `--port` to choose another port. Keep the host running while using review links.

Open the launch URL once in the browser where you will review changes. med exchanges its token for a browser cookie and removes the token from the address. Links such as `http://127.0.0.1:4173/review/r_…` then work in new tabs in that browser. A different browser must open the launch URL once too. Do not put launch tokens in agent instructions or review links.

The CLI finds the running host through a private local connection file. The default state directory is `~/.local/state/med`; use `MED_STATE_DIR` or `--state-dir` to change it. The host and agent commands must use the same state directory and port. Saved reviews and comments survive restarts when that directory is retained. Re-register the repositories at startup; a saved link does not grant access to an unrelated repository.

## Choose the correct repositories

An agent can inspect the user's registered repositories and worktrees:

```sh
node /Users/admin/med/dist/cli.js review repos
```

This list is the user's review scope, not a request to include every listed repository. The agent should compare it with the task, its working directory, Git repository root, linked worktree paths, and the files it actually changed. Include only the repositories affected by the task. Use canonical local paths to distinguish separate clones with the same name or remote URL. A worktree belongs to its repository family but has its own working files.

The host discovers new linked worktrees when the catalogue refreshes. If the task changes an unrelated repository that is not registered, explain which one is missing. Ask the user before adding it to their review setup. Do not scan the home directory, add every nearby checkout, or include unrelated dirty files just to produce a link.

## Create a review

Record the starting commit before work, then use the exact start and end commits for the handoff:

```sh
node /Users/admin/med/dist/cli.js review create \
  --title "Fix navigation" \
  --repo /Users/admin/med \
  --base <commit-before-work> \
  --head <commit-after-work>
```

The result is ready to paste into the final response:

```markdown
[Review changes here](http://127.0.0.1:4173/review/r_example)
```

The base is the state before the task's changes, not the first changed commit. med resolves the endpoints and captures the comparison. It does not switch branches, stage files, or make commits. Do not commit solely to create a link unless the user has authorized commits.

For uncommitted changes:

```sh
node /Users/admin/med/dist/cli.js review create \
  --title "Navigation draft" \
  --repo /path/to/worktree \
  --working
```

This captures the working comparison at creation time, including staged, unstaged, and untracked changes supported by the viewer. It also includes pre-existing changes. If other work is present, explain that scope and resolve any ambiguity with the user. A captured working comparison cannot infer which lines an agent authored.

For multiple repositories or multiple comparisons in one repository, write a manifest:

```json
{
  "title": "Update reader integration",
  "targets": [
    {
      "repo": "/Users/admin/epub-reader-demo",
      "comparison": { "kind": "range", "base": "<reader-before>", "head": "<reader-after>" }
    },
    {
      "repo": "/Users/admin/spaced2",
      "comparison": { "kind": "range", "base": "<spaced-before>", "head": "<spaced-after>" }
    }
  ]
}
```

```sh
node /Users/admin/med/dist/cli.js review create --manifest /path/to/review.json
```

A manifest accepts commit, range, working, staged, and unstaged comparisons. Patch and arbitrary file-pair inputs are not saved-review targets. Use `review create --help` for connection options. Keep generated manifests outside the reviewed changes unless they are intended project files.

## Review and return comments

A link opens its first target. The compact review bar shows a target selector when the review has more than one target, including different comparisons on the same branch. Open **Review** for the full title, repository path, comparison, and capture time. The normal history and file browser remain available. Use **Return to review** to restore the captured comparison after browsing elsewhere. Working files shown in the file browser remain live; the saved diff and its expanded context are captured content.

Add comments to lines or line ranges in the saved diff. The comment card shows **You** and the selected lines: **L** for the old side, **R** for the new side. Write the comment, then select **Comment** or press Cmd/Ctrl+Enter. **Cancel** or Escape closes the draft. Saved cards keep the same text layout, with **Reply**, **Edit**, and **Delete** below the text.

**Copy comments** collects comments from all targets in that review, including inactive targets. It uses the same field names as Codex diff comments: **File**, **Workspace**, **Side**, **Lines**, **Diff hunk**, and **Comment**. Each comment also includes the exact comparison endpoints, capture type, and repository, target, and comment IDs. Replies refer to their parent comment. Diff excerpts include the selected lines and up to three nearby patch rows on each side. If the saved patch does not cover the selection, the export uses clearly labelled captured source lines instead. It never reads current working files for this context. After a successful copy, the copy icon changes to a checkmark briefly. Copying does not delete comments. Paste the text into the agent that should handle it.

Use **Clear** next to **Copy comments**, then **Confirm clear**, to remove comments from this review across its targets. Other saved reviews are unchanged. If comments changed after the confirmation was opened, med rejects the stale clear request. Clearing comments does not delete the captured review or change source files.

After an agent revises the code, create a new review link for the new comparison. The previous link and comments retain their original context.

## Suggested AGENTS.md guidance

**Confirm this workflow and its repository scope with the user before adding this guidance to their AGENTS.md.** Reading this documentation is not authorization to edit that file. Adapt the executable path and connection settings to the user's installation.

Suggested text:

```markdown
When handing off code changes, provide a med review link if the user's med host is running.

- At the start, record the relevant repositories/worktrees, starting commit IDs, and any pre-existing changes.
- Use `node /path/to/med/dist/cli.js review repos` to discover the user's registered review scope.
- Match the task's actual working directories to that list. Include only repositories changed for this task. Do not include every registered repository.
- Prefer exact before/after commit IDs for completed changes. For uncommitted work, use `--working` and explain any pre-existing changes included in the snapshot.
- Use `review create` for one target, or `review create --manifest` for several repositories or comparisons. Include its Markdown link in the final response.
- Do not commit, switch branches, add unrelated repositories, or edit AGENTS.md just to generate a link. Follow the user's authorization for those actions.
- If the host is unavailable or a relevant repository is missing, state what is needed. Do not invent a URL or print the host's access token.
- Treat pasted review comments as scoped to its named repositories and captured comparison. Check current source before applying it; line numbers may have changed.
```

## Limits

Saved reviews are local to the machine running med. A localhost link will not open the same review on another person's computer. Registration is still session-local; saved review records and comments are persistent. Clear comments when they are no longer needed.

One review can contain up to 16 targets. Capture is bounded to 500 changed files and 24 MiB of patch/source content per target. The store permits 64 MiB per saved record, 128 records, 512 MiB total saved data, and 500 comments per review. Comment export is limited to 8 MiB. It reports an error instead of truncating comments; narrow selected line ranges or remove unneeded comments before copying. A capture limit produces an error; narrow the comparison. Binary or oversized files retain diff metadata but cannot supply text context for comments. There is no automatic deletion of old saved reviews.

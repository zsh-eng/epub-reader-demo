# med in Workbench

med is now owned by `apps/med`, alongside Reader and Arctic. Its source, tests,
fonts, provenance files, documentation, and recorded comparisons are part of
Workbench. It is a normal app directory, with no nested Git repository or
submodule.

The import preserves the complete med history through commit
`66c3d9868026e7c8eb37a300142f314da4a869c4`. The import commit is `8708db3`.
Future med changes belong in Workbench.

## Commands

From the Workbench root:

```sh
bun install --frozen-lockfile
bun run build:med
bun run med /path/to/repository /path/to/another-repository
```

Use `bun run dev:med /path/to/repository` during development and
`bun run check:med` for formatting, lint, unit tests, browser tests, type checking,
and the production build. App commands also work from `apps/med`.

There is one root `bun.lock`. med declares its own dependencies and uses Vite 8.
Reader retains its `rolldown-vite@7.3.1` alias. The old root Vite override was
removed because it applied to every app. The existing apps' direct dependency
versions are retained in the lockfile, including their separate React and Base
UI versions. Node still runs med's local host; Bun manages workspace commands
and dependencies.

## Local state and agent links

The default address remains `http://127.0.0.1:4173`. Saved reviews and comments
remain in `~/.local/state/med` (or the configured state directory). Source moves
do not migrate or erase that data. Only one host can use the same port at once.
Stop the old host before launching the Workbench build on that port.

Agents should now invoke `node /path/to/workbench/apps/med/dist/cli.js`. For med
changes, use the Workbench root as the repository. `apps/med` has no separate
branch or worktree. Read the [agent integration guide](../apps/med/docs/AGENT_INTEGRATION.md)
for repository selection and review creation. Confirm that guidance with the
user before adding it to their `AGENTS.md`.

The former `~/med` checkout has been removed. The host now runs from Workbench
on the same port with the same saved state. New Workbench review links continue
to work. Historical links that target `~/med` retain their saved data, but that
repository path is no longer available. Development uses `~/workbench/apps/med`.

Historical benchmark reports retain their recorded source hashes and paths.
Run med's comparison scripts from `apps/med`; the production recording script
resolves the Workbench repository and app path separately. Caches, installed
packages, and build output were not imported.

## Verification

The frozen Bun install, med's full checks (462 unit and 131 browser tests),
Reader's build and 623 client tests, and the shared package suites pass. Six
existing med unit tests remain skipped. Built-app browser checks also pass for
multi-repository selection and saved review links, including persistent comments
and copying comments across repositories. These checks start isolated local
hosts; no deployment or remote data migration is part of this change.

# Spaced in Workbench

Spaced is a normal app at `apps/spaced2`, without a nested Git repository.
Its complete source history through `286533dd10945e47355c4d41ae1baa71b2f57aff`
was imported in commit `787f5b0`. Future changes belong in Workbench.

## Commands and dependencies

Use the root Bun install and `bun.lock`. Spaced uses the shared
`@zsh-eng/local-sync` workspace package instead of a vendored tarball. Its
app dependency versions were pinned to the installed versions, including
React 18, Vite 6, TypeScript 5.6, Zod 3 and ts-fsrs 5.4.2. Other apps retain
independent dependency versions. Build, dev, server and test commands build
the shared sync package first.

Tailwind CSS and its PostCSS plugin move together from 4.0.0 to 4.2.4.
The old plugin allowed a newer native scanner with an incompatible API.
Spaced resolves React 18 and Zod 3 types from its own dependencies and
deduplicates React at runtime. The sync package explicitly imports `zod/v4`
and pins its existing 4.3.6 version so its public types remain correct for
consumers on either Zod major version. Existing Workbench apps retain their
locked direct dependency versions.

```sh
bun install --frozen-lockfile
bun run dev:spaced2
bun run dev:spaced2-server # second terminal
bun run test:spaced2
bun run build:spaced2
```

The default root commands still target Reader. `deploy:spaced2` explicitly
builds and deploys Spaced. No deployment or remote migration is part of the
repository import.

## Production and private state

The Worker remains `spaced2`, serving `spaced2.zsheng.app`. D1 remains
`spaced2-v2`, R2 remains `spaced2-files-v2`, and all auth redirects and secrets
remain unchanged. Browser databases and image caches keep their existing
origins and names. No sign-in or browser resync is required for this move.

Local environment files, Wrangler state, production backups, optimizer data,
and benchmark fixtures remain private and excluded from Git. They must be
preserved during checkout relocation. Historical benchmark reports retain
original absolute paths as evidence, not as instructions to use the old repo.

## Validation

- Spaced: 137 tests passed; client and Worker type checks and production build passed.
- Shared sync package: 36 tests passed.
- Reader: 623 client tests and production build passed.
- Med: production build passed.
- Worker deployment dry run passed with the existing D1 and R2 bindings.
- Root frozen install passed; existing workspace direct versions are unchanged.
- Browser smoke check: home and card editor render; empty card submission
  shows both required-field errors. No production account or data was used.

The canonical local app is `/Users/admin/workbench/apps/spaced2`. The former
`/Users/admin/spaced2` path is a compatibility symlink to this app.
The retired checkout is kept under ignored `migration-backups.local/spaced2`;
private environment files, Wrangler state and `.local` data directories moved
to the canonical app. The archive is for recovery, not continued development.

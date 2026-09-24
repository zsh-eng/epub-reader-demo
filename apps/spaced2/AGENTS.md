# Spaced in Workbench

Follow the root Workbench guidelines. Read `ARCHITECTURE.md` before changes to
storage, sync, auth, or review performance.

Use the root Bun install and lockfile. Run `bun run test:spaced2` and
`bun run build:spaced2` from the workspace root. The test command excludes
private local benchmark and browser fixtures. Preserve React 18, Vite 6,
Zod 3 domain validation and the FSRS parameters during structural changes.
The sync package owns its separate Zod dependency.

Keep local writes independent of network requests. Preserve the active review
card during background changes. Test UI changes in a browser. Do not include
private backups, optimizer data, credentials, or local state in Git.

Worker, D1, R2, database names and auth callback URLs are production identities;
do not rename them as part of repository cleanup. Deploy only when requested.

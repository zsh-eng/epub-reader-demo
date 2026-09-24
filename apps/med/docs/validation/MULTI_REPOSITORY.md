# Multi-repository validation

The host, browser controller, and branch picker were implemented in parallel. The existing architecture task reviewed repository identity and resource ownership. Its deleted-registration-worktree finding was fixed and covered by regression tests.

## Checks

- `npm run format:check`, `npm run lint`, and `npm run typecheck`: pass.
- `npm run test:unit`: 370 pass; 6 optional search-tool tests skipped.
- `MED_TEST_ZOEKT_BIN=<installed-tools> npm run test:unit -- tests/host/zoekt.test.ts`: 7 pass, including all six tests skipped by the default run.
- `npm run test:browser`: 109 pass in Chromium.
- `npm run build`: pass. The existing large-chunk warning remains.
- `node scripts/validate-multi-repo.mjs`: pass against the built CLI, real temporary Git repositories, and Chromium; no browser page errors.
- `MED_VALIDATION_ZOEKT_BIN=<installed-tools> node scripts/validate-multi-repo.mjs`: pass with real indexes for three repositories. Each scoped search reports the Zoekt engine and the correct repository.

The built-app check covers multiple CLI paths, grouped branch selection, identical branch and file names, commit selection restoration, adding and removing repositories, repository-scoped Git search, removing all repositories, reloading the empty session, and adding a repository again. Set `MED_VALIDATION_SCREENSHOT` to an absolute PNG path to capture the picker during this check. The picker was also visually inspected at 1440 × 1000.

Host tests cover linked-worktree deduplication, same-commit clones, source and note isolation, request cancellation during removal, revoked review IDs, replaced checkout paths, lazy search routing, shared index scheduling, and active watcher limits. Two tests cover recovery when the first registered linked worktree is deleted and the main checkout survives.

Controller and browser tests cover stale responses, external-client removal, detached worktrees, duplicate labels, input errors, result limits, tab limits, and navigation cleanup after removal. File navigation tests cover ten repository tabs and late file reads after removal.

## Scope and limits

Repository registration and navigation are session-local. History pages are refreshed when a branch tab is selected. Search remains scoped to committed content in the selected repository; there is no search across all repositories. Both the Git fallback and the installed Zoekt helper were tested. The installed helper path was `/Users/admin/.cache/med/search/tools/153817f643cd-v3/darwin-arm64`; all validation indexes were created in temporary directories.

The host accepts up to 32 repository families, retains up to four search services, and keeps up to eight watched sources. Active event streams pin their watchers; excess simultaneous watched sources receive an explicit limit error. The browser supports 32 branch tabs and renders at most 200 picker results until the query is narrowed.

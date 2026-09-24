# Generic backend migration

Production cutover completed on 19 September 2026. See
[CUTOVER_STATUS.md](CUTOVER_STATUS.md) for deployed versions, validation, and recovery.
This replaces the earlier plan to keep running `spaced-backend`.

## Design

Spaced2 now contains the Hono Worker and the frontend. The Worker serves `/api/*`;
Cloudflare serves the built frontend assets from the same origin.

- Better Auth owns users, credentials, Google links, verification, and sessions.
- `@zsh-eng/local-sync/hono` owns opaque records and last-write-wins sync.
- D1 holds auth, generic file metadata, and generic sync records.
- R2 holds user-owned bytes at `files/{userId}/{contentHash}`.
- Cards, decks, review history, FSRS, and data conversion remain client/tool concerns.
- MemoryDB remains the fast UI read store. IndexedDB stores records and the outbox.

The implementation follows EPUB Reader's backend design and reuses the extracted
sync package. It does not copy Reader features such as device management or books.
The package archive is checked into `vendor/`; no sibling checkout is required.

The relay currently retains records and files until deletion. Automatic expiry is
not implemented. An expiry policy must provide a way for clients to restore a
complete snapshot before the server can safely discard its last copy.

## Conversion

The converter reads the original database and R2 backup. It writes a new directory
and refuses to overwrite an existing result. It performs no network operations.

```sh
bun scripts/backend-migration/convert.ts \
  production-backups.local/2026-09-19-refresh/production.sqlite \
  production-backups.local/2026-09-19-refresh \
  consolidation.local/converted
bun scripts/sync-migration/verify.ts \
  production-backups.local/2026-09-19-refresh/production.sqlite \
  consolidation.local/converted/backend.sqlite \
  consolidation.local/converted/aliases.json
```

Conversion preserves user IDs, provider account IDs, card IDs, review IDs,
scheduling values, record timestamps, and history. It backfills `learning_steps`
and converts deck membership to a last-write-wins boolean. Existing nonempty
password hashes use a tagged compatibility verifier. New passwords use Better
Auth's current hash format. Existing sessions are not imported.

Image bytes are verified against the backup SHA-256 checksums. The converter
creates content IDs and updates old image URLs in card text. Every referenced
image must exist and belong to the card owner, or conversion stops.

The verified result contains:

| Item | Count |
| --- | ---: |
| Users | 265 |
| Nonempty password credentials | 3 |
| Google account links | 263 |
| Sync records | 99,811 |
| Files | 634 |
| Changed image references | 852 in 821 cards |

The independent verifier checked 999,817 fields across all 99,811 records. SQLite
integrity and foreign keys passed. The source backup was opened read-only.
There is one known legacy file catalog entry with no backed-up object; no card
references it. It is not imported into the new file catalog.

Private output is in `consolidation.local/converted/`. It contains account data
and image bytes and is ignored by Git. The preview emulator contains separate
local test credentials; never use emulator state as a production seed.

## Local operation

Seed a fresh emulator once. The tool refuses a nonempty database. Both the seed
tool and Wrangler use `consolidation.local/state/v3` internally.

```sh
bun scripts/backend-migration/seed-local.ts consolidation.local/converted
bun run dev:server
# In another terminal:
bun run dev
# In another terminal, after the server starts:
bun scripts/backend-migration/check-local.ts
```

Open `http://localhost:5180`. Vite proxies `/api` to Wrangler on port 8791.
The seed creates an empty local account: `test@local.invalid`, password
`test-user-password`. Verification codes go only to the local server log.
`check-local.ts` expects that log at `consolidation.local/server.log`; start the
server with `bun run dev:server > consolidation.local/server.log 2>&1` for that check.
The HTTP check creates disposable users and records in the local emulator.

The client starts a new `SpacedRecordsV3` database and image cache. It does not
replay old client edits. After successful restore it requests deletion of the
old databases, as agreed. Users must sign in again. Google sign-in now uses a
redirect instead of Google One Tap.

## Validation and remaining work

- `bun run build` passed for client and server. Wrangler deployment dry-run
  bundled the Worker successfully. The production guard checks for placeholder IDs.

- 111 unit and regression tests passed, including old-password compatibility
  and the changed upload/auth contracts.
- The local HTTP check covers password sign-in, email verification, sign-out,
  file checksums, size limits, deletion/re-upload, account isolation, opaque
  record sync, and rejection of stale writes.
- Chrome restored 7,938 cards and 67,051 review records (including deletion
  records). A migrated image decoded successfully. Two clients passed new-card,
  grading, Undo, membership removal/re-addition, reload, deletion, tab refresh,
  and local database reset checks. No browser errors were recorded. Evidence:
  `consolidation.local/browser-report.json`.
- Real Google OAuth and production restore passed at cutover. Live email
  verification remains untested; local tests use console email.
- See [CUTOVER_STATUS.md](CUTOVER_STATUS.md) for resource and seed progress;
  the cutover is live. See [DEPLOY.md](DEPLOY.md).

Review order: `server/index.ts`, `server/lib/auth.ts`, `server/lib/files.ts`,
`drizzle/0000_generic_backend.sql`, `scripts/backend-migration/convert.ts`,
`src/lib/auth/index.ts`, `src/lib/sync/engine.ts`, then `wrangler.jsonc`.

## Cloudflare tooling upgrade

On 19 September 2026, upgraded Wrangler from 4.85.0 to 4.135.0 and Workers
types from 4.20260424.1 to 5.20260919.1. The compatibility date is now
2026-09-19. Miniflare and workerd use the versions supplied by Wrangler. Both
lockfiles are updated. All 111 tests, the build, local HTTP checks, Worker
bundling, and the two-client Chrome migration checks passed with the new versions.

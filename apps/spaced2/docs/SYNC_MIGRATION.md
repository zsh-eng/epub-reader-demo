# Local sync and FSRS-6 migration

Implemented and deployed on 19 September 2026. See [CUTOVER_STATUS.md](CUTOVER_STATUS.md).
The backend is now consolidated into `/Users/admin/spaced2`. See
[BACKEND_MIGRATION.md](BACKEND_MIGRATION.md) for the current conversion and deployment plan.
The rehearsal below documents the preceding sync-only stage.

## Implemented behavior

- Both applications use the same pinned `@zsh-eng/local-sync@0.1.0` archive in
  `vendor/`. Reader owns the package source. A sibling checkout is not needed to build.
- `SpacedRecordsV3` now replaces the legacy client operation log. Each operation
  family has one current record per entity. This retains separate conflict
  boundaries for schedule, content, bookmark, deletion, suspension, and metadata.
- Local records and the outbox commit in one IndexedDB transaction. MemoryDB
  remains the UI read store and changes only after that transaction succeeds.
- Hybrid logical clocks select winners. Deck membership is `present: boolean`;
  removal and re-addition use the same last-write-wins rule as other fields.
- The client verifies the account, downloads all records, and resumes interrupted
  downloads from a durable cursor. It shows a restore message until the download
  finishes. A fresh IndexedDB database resets any old cursor in localStorage.
- Legacy IndexedDB data is not replayed. After a successful restore, the client
  requests deletion of `SpacedDatabase`. This includes unsent legacy edits, as
  authorized. An old open tab may delay physical deletion; it cannot feed the new store.
- Web Locks serialize local writes and sync across tabs. BroadcastChannel updates
  other tabs' MemoryDB views. Sync uses a 15-second timeout for each HTTP request.
- `/api/sync/v2` uses the existing session authentication. The server derives the
  account from the session. A seed marker enables v2 and rejects legacy `/sync`
  requests with HTTP 409. The two protocols cannot write independently after cutover.
- ts-fsrs is pinned to 5.4.2. The scheduler uses the 21 fitted weights and explicit
  learning steps. Existing card and review rows get `learning_steps: 0`. Existing
  due dates, stability, difficulty, history, IDs, and timestamps are preserved.
  Grading, persistence, sync, and Undo retain the new field.

The earlier backend kept legacy tables. The consolidated backend has only auth,
file metadata, and sync records. The original database remains in the backup.

## Data rehearsal

Input: `production-backups.local/2026-09-19-refresh/test-data.sqlite`.
This is the fresh production snapshot with authentication data scrubbed.

| Data | Rows |
| --- | ---: |
| Cards | 8,408 |
| Card content | 8,408 |
| Deletion, bookmark, suspension, metadata | 5,754 |
| Decks | 265 |
| Deck memberships | 9,429 |
| Review logs | 65,764 |
| Review deletion flags | 1,783 |
| **New sync records** | **99,811** |

The converter copies the input, validates the rows, and writes a new SQLite
file, seed SQL, and a manifest. It refuses to overwrite output files. It does
not contact D1. A failed conversion leaves a `.partial` file, not a completed
SQLite output. The verifier independently compares all mapped fields.

```sh
mkdir -p migration.local
bun scripts/sync-migration/seed.ts \
  production-backups.local/2026-09-19-refresh/test-data.sqlite \
  migration.local/new-seed.sqlite
bun scripts/sync-migration/verify.ts \
  production-backups.local/2026-09-19-refresh/test-data.sqlite \
  migration.local/new-seed.sqlite
```

The verified output is currently `migration.local/final-seed.sqlite` (about
129 MiB), with `.sql` and `.manifest.json` sidecars. The verification checked
99,811 records and 999,817 fields. SQLite integrity and foreign keys passed.
The source backup remains unchanged.

## Local preview and test evidence

The isolated preview uses `http://localhost:5178` and a backend on port 8787.
`migration.local/wrangler.json` names only dummy local D1/R2 resources and local
credentials. It has no production resource IDs.
For the local preview only, sign in with `migration@local.invalid` and
`test-user-password`. This account uses the copied review data; its production
credentials were not changed. Private test files and data
remain in the Git-ignored `migration.local` directory.

```sh
# Backend, from spaced2
../spaced-backend/node_modules/.bin/wrangler dev --local \
  --config migration.local/wrangler.json \
  --persist-to migration.local/wrangler-state --port 8787

# Frontend, in another terminal
VITE_BACKEND_URL=http://localhost:8787/api bun run dev \
  --host localhost --port 5178 --strictPort
```

The installed Wrangler 3 / Node 25 combination failed to import the large SQL
file. For this rehearsal only, the empty, stopped local emulator SQLite database
was filled with SQLite's backup API. The resulting database was then served by
Wrangler. This is not a production import method.

Validation:

- Frontend: 109 tests passed; production build passed.
- Backend: 77 tests passed; 12 existing tests skipped; TypeScript passed.
- Chrome: full account restore (7,938 cards, 65,269 reviews plus deletion flags),
  two independent clients, create, grade, Undo, membership removal/re-addition,
  reload, deletion, same-origin tab refresh, and reset with a retained old cursor.
  Initial restore took about 10 seconds on this machine. No page errors occurred.
- Browser report: `migration.local/browser-report.json`. The rehearsal creates
  and then soft-deletes test cards, so its local server counts exceed the clean seed.
- Outbound browser requests were limited to localhost. Backend tests stub email
  delivery and block external connections.

## Constraints and release work

- This does **not** implement server expiry, relay reset detection, or recovery
  after server data loss. Keep server records until the shared package supports
  that recovery contract. See `SYNC_ADOPTION_PLAN.md`.
- Before production cutover, stop legacy writes and take a fresh backup. Convert
  that final snapshot, verify it, seed the new tables, and then deploy both sides.
  Do not use this rehearsal snapshot to replace a later live database.
- After v2 accepts writes, rollback must preserve those writes. Reverting only
  the frontend would lose them.
- The old server does not retain card creation time separately. Legacy cards use
  their schedule timestamp as the existing fallback; the migration cannot recover
  missing creation dates. Newly created cards now preserve creation time through
  schedule changes and reloads.
- ts-fsrs 5.4.2 can return 101–102-day intervals despite `maximum_interval: 100`.
  This is package behavior observed with both default and fitted weights. This
  implementation retains that behavior; see `FSRS_OPTIMIZATION.md`.
- The frontend keeps Zod 3.24.1 because 3.25.76 caused TypeScript to exhaust its
  default heap with the existing form resolver. Shared protocol validation uses
  the package's own Zod 4. Backend validation uses Zod 3.25.76. The optional Hono
  development peer warning does not affect the browser bundle.

## Suggested review order

1. This report and `scripts/sync-migration/convert.ts`, `seed.ts`, and `verify.ts`.
2. Backend `drizzle/0004_record_sync.sql`, `src/sync-v2.ts`, and `test/sync-v2.spec.ts`.
3. Frontend `src/lib/sync/records.ts`, `src/lib/db/persistence.ts`, and `src/lib/sync/engine.ts`.
4. `src/lib/sync/operation.ts`, `src/lib/review/review.ts`, and the fitted parameter constant.
5. `tests/sync-v2.test.ts`, the adjusted regression tests, and `src/components/sync-status.tsx`.

The pre-existing `src/components/stats/time-bar-chart.tsx` changes are outside this work.

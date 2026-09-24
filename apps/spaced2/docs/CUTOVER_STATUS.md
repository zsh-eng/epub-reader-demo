# Cutover status — 19 September 2026

Production now runs the consolidated `spaced2` Worker. The Worker route
`spaced2.zsheng.app/*` serves the frontend and `/api/*` from the new deployment.
The existing Pages project remains for recovery; no DNS change was required.

## Completed

- Wrangler 4.135.0, Workers types 5.20260919.1, compatibility date 2026-09-19.
- All 111 tests, the build, Worker dry-run, local HTTP integration checks, and
  two-client Chrome checks passed after the upgrade.
- New D1 `spaced2-v2`: `3ec0ff8a-230f-4c3a-8d93-4d4c9e58007b`, created in APAC.
- New R2 `spaced2-files-v2`: all 634 objects read back and SHA-256 verified.
- Seeded 265 users, 266 credential/provider account rows, 634 file metadata rows,
  and 99,811 sync records. A remote export exactly matched every local seed row.
- Froze the legacy Worker, then exported the final source database. All migrated
  tables and the image inventory were unchanged since the candidate seed.
- Final independent backup: `production-backups.local/2026-09-19-final`.
- Local Google sign-in and restore confirmed by the user.
- Production secrets configured. The email key is valid and restricted to sending;
  domain-list access is denied by that scope. No test email was sent.
- Preview and production HTTP probes passed: assets, session validation, 500 real
  record comparisons, a migrated image checksum, correct Google callback, and
  unknown API route handling. Each temporary probe session was revoked.
- Production Google sign-in and full browser restore passed. The public review
  screen is populated with the existing cards. Reload also preserved them.

## Deployment and recovery

Current Worker version: `197edba8-2ebd-4312-848b-cc474be01672`.
Previous consolidated Worker version: `05a049a9-650a-47c1-8287-6de95c41363a`.
App route: `4888f2fd959e402f97281bd931fa94f0`, with fail-open disabled.
Legacy frozen version: `4bb1209f-d44f-436f-bb3a-a4366a830261`.
Previous legacy version: `65fe4abe-e16d-48b7-9a80-3182569bd6b6`.

The legacy Worker was configured to return HTTP 410 with a reload message.
At the latest release check, `api.spaced2.zsheng.app` did not resolve and was
absent from the account Worker custom-domain list. Thus the notice is currently
unavailable at that hostname. DNS record inspection was denied by the token scope.
The new app uses same-origin `/api` routes and passed its live checks.
Its database, R2 bucket, secrets, prior deployment, and local source are retained.
The retirement handler and config are `server/legacy-retired.ts` and
`wrangler.legacy-retired.jsonc`. Do not redeploy the old application over it.

The release was built in `cutover.local/release` with the unrelated existing
`time-bar-chart.tsx` edit excluded. That working-tree edit remains untouched.

After new user writes, rollback needs data reconciliation. Do not switch back to
legacy storage without preserving those writes. Private evidence and recovery
metadata are in `cutover.local`; backups contain full auth and study data.

## Remaining validation

- Live email verification has not been exercised; local OTP verification passed.
- During reload, the empty-card view can briefly appear before local data is
  loaded. The subsequent populated view was verified; a loading view would be
  clearer.
- At cutover, first restore fetched all records in sequential pages of 500. The
  observed local restore used 196 pull requests and zero image requests. It is
  separate from image downloads; later syncs fetch changes only.

## Review order

1. `wrangler.jsonc`: production binding and app route.
2. `server/legacy-retired.ts`, `wrangler.legacy-retired.jsonc`: legacy retirement.
3. `scripts/backend-migration/export-sql.ts`: remote seed export.
4. This file, `BACKEND_MIGRATION.md`, and `DEPLOY.md`: deployment and recovery.

## Local performance work after cutover

Streaming package/client changes and legacy code cleanup were deployed from
commit `fd23572`, using the clean snapshot `release-20260919.local`. All 123 tests
and the production build passed. Live checks verified the deployed HTML, auth,
Google callback configuration, a migrated image checksum, and all 97,267 owner
records streamed across seven requests with unique keys and ordered cursors.
The temporary probe session was revoked. No data reseed was needed. The roughly 16-second benchmark baseline also uses experimental
adaptive batching, an empty-outbox shortcut and a compiled Zod 4 domain decoder;
these are not all present in the application runtime. See the benchmark reports
for the exact configurations. Keep the type and timestamp indexes: the user
explicitly chose to retain them and stop further optimization work for now.

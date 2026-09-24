# Legacy cleanup review

The migration and performance work is committed. Keep IndexedDB's `type` and
`timestamp` indexes. Candidate optimizations remain experiments; the measured
16-second configuration is not the application runtime. No deployment is part
of this commit pass.

## Completed code cleanup

- Removed the unused `VITE_BACKEND_URL` type, Google Identity Services types and
  `@types/google.accounts` dependency; updated both lockfiles. Also removed the
  unused legacy client-ID argument from `registerAndSync`.
- Removed `server2ClientSyncSchema`, `Server2Client`, the `_id`-based
  `OperationWithId` type, and the unused MemoryDB operation map. Review fixtures
  now use current operation types without synthetic local IDs.
- Live membership records require boolean `present`. The offline converter still
  maps historical `cl_count` to `present`. Regression tests cover that boundary
  and two-client remove/re-add convergence.
- Removed the unused 0.1.0 package archive. Git history retains it; 0.2.1 is unchanged.

## Retained by design

- `server/legacy-retired.ts` and its Wrangler config: keep the 410 reload/sign-in
  response, as requested. This is a helpful retirement notice, not a technical
  requirement to keep the old Worker running forever. The old writable API stays
  unavailable; the new app uses its own same-origin `/api` routes.
- `server/lib/password.ts`: migrated password accounts still need the tagged
  legacy verifier. Removing it could prevent sign-in.
- The current `/login-success` route: it completes the new Google redirect flow.
- `/api/sync/v2/pull` and its fallback: these are supported current package APIs.
- Post-bootstrap old-database cleanup: clients that have not migrated still need it.
- Conversion/verification tools, backups and old Cloudflare resources: these are
  recovery evidence. Remote deletion requires a separate retirement decision.
- Benchmark reports: historical measurements are useful evidence, not runtime code.

## Cleanup validation and review order

123 application/benchmark tests passed, including the new membership-schema test.
The application build passed. An isolated Chrome smoke test with synthetic data
and mocked auth passed sign-in, streaming restore, grade/Undo, membership
remove/re-add and persisted reload. This was not a new live Google OAuth test.
The temporary browser database was deleted after the check. No deployment or
remote-resource changes were made. The indexes and unrelated statistics edit
remain untouched.

Review `src/lib/sync/schema.ts` and `tests/sync-v2.test.ts` first, then
`src/lib/db/memory.ts` and the review fixtures, then auth/config and lockfile
removals, and finally `vendor/README.md` and this record.

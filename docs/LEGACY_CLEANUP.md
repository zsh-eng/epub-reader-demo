# Legacy cleanup review

The migration and performance work is committed. Keep IndexedDB's `type` and
`timestamp` indexes. Candidate optimizations remain experiments; the measured
16-second configuration is not the application runtime. No deployment is part
of this commit pass.

## Next code cleanup, in order

1. Remove unused `VITE_BACKEND_URL` typing in `src/vite-env.d.ts`, the
   `@types/google.accounts` dependency, and `google.accounts` from TypeScript's
   type list. The client uses `/api`; Google sign-in now redirects through
   Better Auth. Update both lockfiles.
2. Remove unused `server2ClientSyncSchema` and `Server2Client` exports from
   `src/lib/sync/schema.ts`. Neither has a remaining consumer. Replace the old
   `_id`-based `OperationWithId` type in MemoryDB and review fixtures with current
   operation types before deleting it. The unused `memoryDb.operations` field
   can be removed in the same pass after a reference check.
3. Remove the `clCount` fallback from the live membership schema after updating
   its tests. The offline converter already maps `cl_count` to `present`; retain
   that conversion for historical backups. New runtime membership is boolean LWW.
4. Remove `vendor/zsh-eng-local-sync-0.1.0.tgz` from the working tree and update
   vendor notes. No active manifest references it; its bytes remain in Git history.

Validate with the application tests and build, then one focused browser check of
sign-in, restore, grading/Undo and membership changes. Keep cleanup commits separate
from any new optimization or deployment.

## Keep

- `server/legacy-retired.ts` and its Wrangler config: the old API must continue
  returning 410 so stale clients cannot write to the old store.
- `server/lib/password.ts`: migrated password accounts still need the tagged
  legacy verifier. Removing it could prevent sign-in.
- The current `/login-success` route: it completes the new Google redirect flow.
- `/api/sync/v2/pull` and its fallback: these are supported current package APIs.
- Post-bootstrap old-database cleanup: clients that have not migrated still need it.
- Conversion/verification tools, backups and old Cloudflare resources: these are
  recovery evidence. Remote deletion requires a separate retirement decision.
- Benchmark reports: historical measurements are useful evidence, not runtime code.

## Verification for this commit pass

122 application/benchmark tests passed; 36 shared-library tests passed. The app
build, Worker dry-run and scoped shared-library lint passed. The 14 vendored package
build artifacts match Reader commit `15b11ee` byte-for-byte. The existing statistics
edit and local package cache were not included in the commits.

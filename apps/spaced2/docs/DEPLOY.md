# Deployment

The new design deploys one Cloudflare Worker from this repository. It serves the
frontend assets and `/api/*`. It no longer needs a separate domain-aware backend.
The cutover is live. See [CUTOVER_STATUS.md](CUTOVER_STATUS.md) for deployed
versions, validation, and recovery details. The checklist below records the
procedure used for the migration.

`.env.production` alone is not sufficient. Old `VITE_BACKEND_URL` and Google GIS
settings are no longer used. The client uses same-origin `/api` requests.

## Before production

1. Create a new D1 database and R2 bucket. Replace the placeholder production
   bindings in `wrangler.jsonc`. Keep the old resources for rollback.
2. Configure `BASE_URL` as the public app origin and `MAIL_FROM` as a verified
   sender. Set Worker secrets with Wrangler: `BETTER_AUTH_SECRET`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `RESEND_API_KEY`.
3. Add `https://spaced2.zsheng.app/api/auth/callback/google` to the Google OAuth
   client's redirect URIs. Test Google login and email verification on staging.
4. Stop legacy writes and take a final D1 and R2 backup. Convert and independently
   verify it as described in [BACKEND_MIGRATION.md](BACKEND_MIGRATION.md).
5. Apply `drizzle/0000_generic_backend.sql` to the new empty D1 database. Import
   converted `user`, `account`, `file_storage`, and `sync_records` rows, preserving
   `server_seq`. Upload each entry in `files.json` to the new R2 key. Use `scripts/backend-migration/export-sql.ts` to export the four converted
   tables for `wrangler d1 execute --remote --file`. The R2 copy and checksum
   verification procedure is currently in the private `cutover.local` scripts.
6. Verify remote counts and image checksums before routing traffic. Disable the
   old backend's mutation routes so old clients cannot continue writing to the
   legacy store. Do not point the new client at an unseeded database.
7. Switch the app's Pages/custom-domain route to the new Worker and deploy with
   `bun run deploy`. This command builds and refuses placeholder production IDs.
8. Test sign-in, full restore, an existing image, a new review, and a second client.
   Users must sign in again; the app creates a fresh local database.

`bun run build` compiles both server and client. It does not configure secrets,
create resources, import data, or deploy. `bun run deploy` publishes the Worker
and its assets only after the production binding guard passes.

For rollback, preserve the old deployment and the final pre-cutover backup.
New generic records are not written back to legacy tables. After users make new
writes, rollback needs a data reconciliation step; switching the route alone
would lose those changes.

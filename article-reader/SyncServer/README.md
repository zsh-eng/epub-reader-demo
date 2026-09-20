# Arctic sync integration

## Current scope

This backend is mounted in `server/index.ts` under `/api/arctic`. `../Sync` is a
tested Swift package with a durable local record store, HTTP transport and
Keychain session storage. The new database is created and bound in the default
Wrangler configuration. **No remote migration or Worker deployment has run yet.**
The native domain bridge and account UI are separate integration work; do not
expose a working-sync indicator until the complete flow is verified.

## Host and authentication

Reuse Reader's Cloudflare Worker and Better Auth accounts. Mount
`createArcticRoutes` at `/api/arctic` after the existing session middleware.
Pass `requireAuth`, authenticated `user.id`, `deviceId`, a **separate D1 database**
for Arctic, and `BOOK_STORAGE` (its Arctic prefix isolates these objects).
Apply `migrations/0001_records.sql` only to the new database. Reader's D1 stream
cannot contain Arctic records: its client rejects unknown record types.

Native email/password sign-in calls `/api/auth/sign-in/email`. The client stores
only the resulting signed `__Secure-better-auth.session_token` cookie in its
own device-only Keychain service. It uses an ephemeral URLSession without shared
cookie storage, forbids redirects and accepts HTTPS origins only. Passwords are
not stored. `Origin` equals the API origin, so Better Auth can retain CSRF
validation. Session renewal cookies replace the Keychain credential. Revoked or
expired sessions return an error; they do not clear local articles.

The app must save `HTTPRemote.signIn`'s result with `SessionKeychain.save` before
showing a signed-in state. Call `signOut`, cancel the old transport, then clear
the credential. Keep a reference to the old account until network work ends.
Do not reuse an actor, journal path, cursor or outbox for a different account.
If network sign-out fails, clear the device credential and report that server
session revocation is pending; do not claim that all devices were signed out.
Google-only users need a web authentication/code-exchange flow or an account
password before this initial email/password path is useful. No client secret
belongs in the iOS app. The Jev key is never part of sync.

## Native store integration

Add the local Swift package `../Sync` and its `ArcticSync` product to ArticleReader.
Keep one `SyncStore` actor per account journal file. Its snapshot is authoritative
for synced values; it is not safe to write the domain file then best-effort enqueue
an independent outbox. Both writes must be one durable operation. Local mutations,
pending uploads, HLC, retained winning versions and pull cursor share one atomic
file replacement. Import a batch with one `commit` call.

Suggested record families, each with schema version 1:

- `article/<sha256(canonical URL)>`: URL, source title/description, preview URL.
- `library/<same hash>`: savedAt, saved/archive/read flags; preserve import dates.
- `tags/<same hash>`: manual, automatic and rejected tag sets plus generation.
- `annotation/<UUID>`: article URL, exact/context anchor, note, highlight, dates.
- `content/<same hash>`: SHA-256 file reference and extraction recipe version.

Keep downloadedAt, loading errors, speculative tagging state, transient notices,
credentials and local file paths out of these values. Separate metadata refresh
from user-authored fields so a network preview cannot overwrite a user's tags or
archive state. Article identity must derive from the canonical URL; random per-
device UUIDs would duplicate independently saved articles. An annotation retains
its UUID across devices. Delete with a tombstone, never remove the pending record.

Supply `SyncStore`'s `validateValue` closure to decode supported record families
and schema versions. Rejected values stop the page before rows/cursor commit.
After a successful sync, apply its snapshot to the UI on MainActor; never upload
that remote application as a fresh local edit. Keep a UI account-generation guard
around awaited work. `SyncStore` preserves an edit made while an older push is in
flight and keeps it pending for the next pass. Trigger on local commit (debounced),
foreground, successful sign-in and connectivity recovery. Use one sync task per
account; offline errors leave the durable outbox intact. The package throws on
concurrent sync calls so ownership is explicit.

This initial JSON journal rewrites a compact metadata snapshot per batch. Benchmark
large-library changes before moving to SQLite transactions; do not use one commit
per imported row. The wire protocol is the existing local-sync v2 contract: HLC
and device ID resolve conflicts; pull pages use a fixed head. A server cursor
reset is an error, not permission to discard local state. Keep server tombstones
and records until an explicit recovery/retention protocol exists.

## Article HTML

Upload HTML using `HTTPRemote.upload` **before** publishing its content-reference
record. Retry from durable local intent after a crash. Upload concurrency should
be low and viewport metadata/reading takes priority. Do not delay saving metadata
on file upload. Restore visible HTML on demand; do not download every article body
at sign-in. Native download checks SHA-256 before committing bytes.

The R2 key includes the server-authenticated user and content hash. The API uses
SHA-256, rejects files over 8 MiB, and serves downloads as inert binary attachments
with a sandbox CSP. Same bytes upload idempotently. There is no public R2 URL and
no destructive file-delete endpoint; references from another device must stay
valid. `private, no-store` prevents an HTTP cache from crossing account changes;
the account-scoped local content store owns caching.

Store uncompressed UTF-8 HTML initially. R2/HTTP transfer optimization and optional
compression must be measured on real saved articles. If stored gzip is introduced,
hash the exact stored bytes and version the representation; never combine an
uncompressed content hash with compressed stored bytes or double-decompress in
URLSession. Metadata and HTML must remain separate.

## Validation and release

```
bun test article-reader/SyncServer/routes.test.ts
swift test --package-path article-reader/Sync --scratch-path /tmp/arctic-sync-build
```

The host integration test runs actual Better Auth sign-in/sign-out, D1 and R2
inside local workerd, with HTTPS cookie settings. It confirms that Arctic records
never enter Reader's database, another account cannot read articles/files, and
revoked sessions cannot sync. Run it with:

```
bun run test --run test/server/arctic-sync.test.ts
```

Resource created 2026-09-20: `arctic-db`, APAC,
`810925d0-4966-4da9-840b-16e6347e245e`. It is empty on Cloudflare. Existing
`reader-db` and `epub-reader-books` resources were not migrated or modified.
The default config binds `ARCTIC_DATABASE` to the new database. HTML uses the
existing bucket under `arctic/v1/users/<authenticated-user>/<sha256-id>`.

After root review and native integration checks, deployment commands from the
repository root are:

```
bunx wrangler d1 migrations apply arctic-db --remote
bun run build
bunx wrangler deploy
```

Use the default configuration, as the existing Reader release workflow does.
The optional `--env production` block does not declare database/R2 arrays and
must not be used without separately configuring its non-inherited bindings.
Do not run Reader's database migration command for this Arctic change.
Verify the remote migration list, unauthenticated Arctic 401 responses, and
existing Reader asset/auth health after release. Then verify native sign-in,
second-device restore, offline edit recovery, logout/account switching, and
HTML restoration. Do not create real accounts or upload the user's library
merely to smoke-test an unreviewed backend.

Sources checked 2026-09-20:

- [Better Auth cookies](https://better-auth.com/docs/concepts/cookies)
- [Better Auth bearer support](https://better-auth.com/docs/plugins/bearer)
  (not required for the signed-cookie native transport).
- [Apple URLSession cookie storage](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/httpcookiestorage)
- [Cloudflare R2 Worker bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)

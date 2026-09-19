# Shared sync adoption scope

Status: locally implemented and tested, 19 September 2026. Production is unchanged.
See [SYNC_MIGRATION.md](SYNC_MIGRATION.md) for the implemented contract, validation,
and local commands. Reader's `@zsh-eng/local-sync` extraction is merged into its
local `main` at `59dd80a`. The backend is in `../spaced-backend`.

The user approved discarding legacy client data and rebuilding from the seeded
server. This replaces the earlier proposal to preserve pending legacy operations.
The design discussion below remains useful context; the implementation report
is the current source for the client reset policy.

## Recommended boundary

Keep MemoryDB and its UI subscriptions. Replace the operation replay store and
network engine underneath it with durable domain records and an atomic outbox.
Keep the current study-day rules, authentication, and image URLs unchanged.
Plan the FSRS upgrade and sync schema conversion as one coordinated data
migration, with separate conversion steps and tests. Keep the backend repository
merge outside this scope.

The intended write path is:

```text
User action -> domain records + outbox in one IndexedDB transaction
            -> update affected MemoryDB entries after commit -> notify UI
            -> background sync
Remote sync -> validate + commit domain records
            -> update affected MemoryDB entries -> notify UI
```

UI reads still use MemoryDB. Startup loads current card/deck/membership records
instead of replaying the full operation history. Review history stays outside
MemoryDB and is queried only for statistics. This preserves the fast read path;
startup time and grading latency must be measured before making speed claims.

## What can be reused

| Layer | Shared package | Spaced-owned work |
| --- | --- | --- |
| Protocol | Versioned records, HLC ordering, batch limits | Domain codecs and legacy conversion |
| Client | Pull/push engine and response validation | Fetch transport, session handling, lifecycle, retry UI |
| Local storage | Dexie write capture and atomic reconciliation | Schema, account scope, MemoryDB projection, statistics queries |
| Server | Hono routes and D1 record storage | Existing session/client identity middleware, migrations, migration gate |
| Files | None in this release | Existing R2 upload, quota, cache, and file routes |

Use a local package link for development. Use a pinned package archive or
published version for repeatable builds in both repositories. Package subpaths
are `@zsh-eng/local-sync`, `/dexie`, and `/hono`. The package has its own Zod 4
dependency; Spaced can retain Zod 3 for existing forms. Verify the Hono validator
peer versions in the backend and update Dexie to the package's supported range.
Do not upgrade unrelated dependencies as part of adoption.

## Preserve the conflict boundaries

The current app has ten operation families. Do not combine all fields into a
single card record: a content edit must not overwrite a concurrent review.

| Existing state | Proposed record boundary |
| --- | --- |
| Card schedule | One record per card, with all FSRS scheduling fields |
| Card content | One record per card for front/back |
| Card deletion, bookmark, suspension | Separate record for each flag family |
| Card metadata | Separate note ID and sibling-tag record |
| Deck | One record per deck |
| Deck membership | One last-write-wins record per deck/card pair |
| Review log | Immutable record keyed by the existing review ID |
| Review undo | Separate deletion-state record keyed by review ID |

Use explicit codecs for dates, optional values, enums, and IDs. Keep domain
deletion flags distinct from the package's `isDeleted` envelope flag where a
record represents another record's state. Retain deleted records for recovery.
Use collision-safe composite IDs for deck/card pairs.

Decision, 19 September: use last-write-wins for deck membership. Store a stable
record ID for each `(deckId, cardId)` pair; use `isDeleted` for removal and keep
the tombstone. Re-adding writes a newer non-deleted version. The package compares
HLC and device ID; this is a deterministic order, not proof of real-world timing
between disconnected devices.

For migration, resolve legacy membership by maximum `clCount` first, then map
odd to present and even to absent. Preserve a deterministic original version;
do not use the time when the migration runs. All 9,429 membership rows in the
19 September production backup have count 1. Browser-only pending operations
must still be converted by the general rule. No custom counter merge extension
or immutable membership revision table is needed. Test remove/re-add, concurrent
writes, duplicate delivery, and return of an old device.

Grade and Undo each need one local transaction covering the schedule, review
history, sibling suspension changes, and outbox. Update MemoryDB only after a
successful commit. The package does not preserve a multi-record action as an
atomic unit across remote pages. Test projection readiness for partial imports;
add transaction-group support only if remote all-or-nothing visibility is required.

## Combined schema and FSRS migration

The stable npm release was checked again on 19 September: `ts-fsrs` 5.4.2;
6.0.0-beta.9 remains a beta. The current app uses 4.5.0. Version 5 introduces
FSRS-6 and `learning_steps` on cards and review logs. See
`TS_FSRS_UPGRADE_REVIEW.md` for the earlier source and runtime assessment.

Prepare one versioned target schema with the separate conflict families above,
last-write-wins memberships, FSRS learning-step state, explicit date codecs,
account scope, and the sync version metadata needed by the chosen recovery scope.
The server seed writes opaque domain records into `sync_records`; it does not
need a new SQL table for every card field. Authentication and file metadata
tables remain in use.

Use separate deterministic transforms: legacy operations/tables to resolved
domain state; membership conversion; scheduler-field adaptation; then sync
envelope/version generation. Use the same domain conversion rules for the D1
snapshot and each browser's local database. Record source snapshot identity,
target schema version, converter version, counts, and checksums in a seed manifest.
Make repeat execution safe and validate it against an empty local target first.

Preserve existing due dates, stability, difficulty, review IDs, and historical
reviews. Do not replay all history through FSRS-6 or bulk-reschedule cards as a
side effect. Use the new scheduler for future reviews. Old data has no explicit
learning-step index. The v5.4.2 learning scheduler falls back to zero; use an
explicit zero backfill when the field is absent, while preserving valid existing
values. Test each card state, especially Learning and Relearning. This is a
compatibility default, not reconstructed progress. If the default is materialized
in old logs, record their legacy origin. See the migration guidance check in
`TS_FSRS_UPGRADE_REVIEW.md`. New fields must survive grading, reload, sync,
export, and Undo. Keep fuzz, retention, maximum interval, and learning-step
configuration explicit; compare representative old/new scheduling results.

Personal FSRS-6 weights have now been fitted locally and staged in
`src/lib/review/fsrs6-personal-parameters.ts`. Use them as the app-wide defaults
when this migration activates ts-fsrs 5.4.2. See `FSRS_OPTIMIZATION.md` for the
chronological validation, rating interpretation, and interval-cap finding.
The live FSRS-5 scheduler remains unchanged until that migration.

One production cutover can contain these independently tested steps. This does
not authorize implementation or deployment during the current scoping discussion.

## Client migration and production cutover

The browser can migrate its own IndexedDB data. It cannot, by itself, guarantee
that every production account or offline device has been migrated.

1. Build deterministic conversion functions against a copy of the fresh backup.
   Compare complete domain values, counts, flags, memberships, review IDs, and
   dates, not just row counts. Preserve original versions; do not timestamp all
   imported rows with the migration time, which could make stale rows win.
2. Add a new account-scoped IndexedDB database with domain tables, outbox,
   version metadata, and a durable migration checkpoint. Leave the old database
   intact until validation completes. Account identity must be verified before
   attaching the existing single-database data to an account.
3. Open the new `SpacedRecordsV2` database and download all records. Discard old
   client data, including unsent legacy writes, as authorized. Resume interrupted
   downloads from a durable cursor. Do not expose a partial restore as complete.
4. Add versioned server endpoints alongside `/sync`. Reuse current authentication;
   never trust a user ID from the request body. Map `X-Client-Id` to the new device
   identity contract and test cross-account access.
5. Rehearse conversion and seeding locally using the fresh backup. At production
   cutover, use an account migration gate to freeze legacy writes, take a complete legacy
   snapshot, rerun the tested converter, seed the new record store, verify it,
   then enable the new protocol. Today's rehearsal seed must not replace a later
   live database; otherwise changes made since the backup would be lost.
   Keep legacy data for rollback. Seed dormant accounts before removing old tables.
   The current pull API excludes a client's own records; it is not a complete
   migration export. Add a full authenticated snapshot or use a controlled D1 seed.
6. A returning old device must upgrade before syncing. Discard its old cache and
   unsent operations. Do not upload that cache as fresh edits. Reject the old
   protocol after the seed is complete.
7. Keep rollback data and a conversion/export path until the new system is proven.
   After new writes are accepted, rollback needs to preserve those writes too;
   switching the old frontend back is not a sufficient rollback plan.

Account migration can be on demand, with a controlled batch for remaining
accounts. Rehearse both methods locally before selecting the production cutover.
An old offline device must reconnect and upgrade before it can use the new data.

## Make the server temporary storage

This needs shared-package work before we can promise safe server deletion. The
current Dexie adapter retains pending versions but removes them after an
acknowledgement. It does not retain each acknowledged record's full version.

- Persist the original HLC, originating device ID, schema version, and deletion
  state for every local record, even after upload. Compare incoming versions
  against that state, not only against pending writes.
- Add a server generation/epoch and bind cursors to it. Detect reset and expiry
  explicitly. Do not infer a reset only from a smaller sequence number.
- Add a recovery protocol to exchange full local state and reconcile multiple
  clients without changing original versions. The current push assigns the
  requesting device ID, so a recovery upload needs a separate way to preserve
  provenance. Uploading old data as a new edit is unsafe.
- Keep tombstones until a defined device-retirement/checkpoint rule permits
  deletion. An old client must not restore a deliberately deleted card.
- Serialize sync and clock writes across browser tabs. The current synchronous
  state store does not coordinate tabs. Also notify MemoryDB of commits from
  another tab and stop in-flight work safely on account change or sign-out.
- Define an export/restore format that includes records, versions, and files.
  Record acknowledgement alone must not permit erasing the only durable local
  copy if the server can expire it.
- Treat images separately. A cached image is not a guaranteed local replica.
  Before R2 expiry, ensure referenced files have a durable recovery source.

If every client copy is lost and server data has expired, recovery requires an
independent backup. Account identity and authentication can still be server-owned;
the temporary-storage principle here concerns study records and files.

Recommendation: first adopt the shared engine while retaining server records,
then enable expiry only after reset/recovery tests pass and retention rules are
agreed. If disposable server storage is required at the first release, the
recovery work above is a prerequisite rather than a later phase.

## Test and release gates

1. Backup conversion: compare all accounts and all record families, including
   deleted records, note metadata, and memberships. Check protocol size limits.
2. Storage: aborted writes, interrupted migration/restart, quota errors, duplicate
   imports, two tabs, account switching, and offline edits during migration.
3. Sync: edit versus grade, concurrent reviews, last-write-wins membership races, delete versus
   edit, Undo with sibling suspensions, in-flight edits, lost acknowledgements,
   expired sessions, unsupported schemas, and an old device returning later.
4. Recovery: reset the relay; reconnect a stale client before a newer client;
   restore from an export; prove no deleted card returns and no newer state is lost.
5. UI/performance: startup and grading timings, uninterrupted offline study,
   statistics parity (local time zone / 04:00 study day), sign-out behavior,
   image availability, and service-worker upgrade behavior.

Implement in small steps: target schema, conversion and fixtures, FSRS adaptation;
package recovery contracts;
local persistence and MemoryDB projection; backend endpoints and migration gate;
two-device rehearsal; production cutover. Do not deploy during the scoping phase.

## Decisions before release

- Keep server records for the first adoption release (recommended), or require
  disposable server storage immediately?
- How long may a device remain offline before it must restore from a checkpoint,
  and how long should server records, tombstones, and images remain available?
- Is a temporary upgrade-required state acceptable for old clients at account
  cutover? Decision: yes. Discard legacy local data and restore from the server.
- Confirm sign-out semantics once the server is temporary: keep a protected local
  copy or require a verified export/replica before local deletion. A successful
  push alone will no longer prove durable recovery.

## Sources and review order

1. This plan, especially conflict boundaries and cutover/recovery rules.
2. `../epub-reader-demo/packages/local-sync/README.md` and its
   `src/dexie/storage.ts`, `src/client.ts`, and `src/hono/d1.ts` contracts.
3. `src/lib/sync/operation.ts`, `src/lib/db/persistence.ts`, and
   `src/lib/db/memory.ts` for the adapter boundary.
4. `../spaced-backend/src/server2client.ts`, `src/client2server.ts`, and
   `src/db/schema.ts` for server conversion and original conflict ordering.
5. `production-backups.local/2026-09-19-refresh/README.md` and
   `migration-profile.json` for the current private test baseline.

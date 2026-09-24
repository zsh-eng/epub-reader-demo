# ts-fsrs update review

Local implementation update, 19 September 2026: ts-fsrs 5.4.2 and the fitted
21-parameter configuration are active locally. See [SYNC_MIGRATION.md](SYNC_MIGRATION.md).
The comparison below records the pre-upgrade baseline. Production is unchanged.

Checked on 13 September 2026. This is an assessment; no dependency update was made.

## Installed and available versions

The app uses **4.5.0** in both lockfiles and in `node_modules`. The manifest
allows `^4.5.0`. Git commit `a5938ab` added the dependency on 17 December 2024;
the resolved version has not advanced since then.

The latest stable release is **5.4.2**, published on 1 September 2026. npm also
lists **6.0.0-beta.9** under the beta tag, published on 10 September 2026.
Version 5.4.2 requires Node 20 or later; 4.5.0 requires Node 18 or later.
[Stable release](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.4.2),
[npm package metadata](https://registry.npmjs.org/ts-fsrs).

## Changes relevant to Spaced

| Versions | Change | Effect on this app |
| --- | --- | --- |
| 4.5.1–4.7.1 | Fixes for stability after a lapse, elapsed-day calculation, parameter bounds, and mutation of default parameters. Adds `next_state` and exports the forgetting curve. | A smaller update within the current major version. The calculation fixes still need scheduler regression tests. [4.5.1](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v4.5.1), [4.5.2](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v4.5.2), [4.6.1](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v4.6.1), [4.7.1](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v4.7.1). |
| 5.0 | Switches from the FSRS-5 algorithm to FSRS-6. Adds `learning_steps` to cards and review logs, plus configurable learning and relearning steps. | Changes future scheduling and introduces state that storage and sync must preserve. [Release](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.0.0). |
| 5.1–5.2 | Improves method types, marks old fields and methods as deprecated, corrects default FSRS-6 parameters, and fixes premature graduation from learning. | Relevant because Spaced uses default weights and short-term learning. [5.1](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.1.0), [5.2](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.2.0), [5.2.1](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.2.1). |
| 5.3–5.3.1 | Changes same-day Hard stability behavior, improves performance, and prevents skipped learning steps. | Affects repeated reviews of a learning card. [5.3](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.3.0), [5.3.1](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.3.1). |
| 5.3.3–5.4.2 | Strengthens parameter bounds, rejects NaN, adds typed validation errors, and clips migrated parameters. | Better handling of invalid/custom parameters; the algorithm fixes also cover relearning. [5.3.3](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.3.3), [5.4](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.4.0), [5.4.1](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.4.1), [5.4.2](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.4.2). |

## Compatibility checks

The current scheduler enables fuzz, caps the maximum interval at 100 days, and
otherwise uses package defaults (`src/lib/review/review.ts`). In a temporary
runtime check, 4.5.0 reported FSRS-5 with 19 weights; 5.4.2 reported FSRS-6 with
21 weights. Both default to 90% requested retention and enable short-term
learning. Version 5.4.2 defaults to learning steps of 1 and 10 minutes and a
relearning step of 10 minutes.

A type check with the current 4.5.0 declarations passed. The same app source
checked against the published 5.4.2 declarations failed at
`src/lib/review/review.ts:55`: the reconstructed review log lacks the required
`learning_steps` field. These checks used temporary TypeScript configurations;
the app dependency and lockfiles were not changed.

The migration also has a runtime requirement. Card operations explicitly copy
scheduler fields but omit `learning_steps`. Card reconstruction and Undo do the
same. The review-log sync payload schema also omits the field. Merely adding a
default to satisfy TypeScript would not preserve progress through learning
steps. An upgrade must cover creation, grading, persistence, sync, reload, and
Undo, with a default for older records and compatible backend validation.

Old-record adaptation can run on the client, but the backend cannot remain
unchanged. The production backup taken on 13 September confirms that `cards`
and `review_logs` have fixed columns with no `learning_steps`. Backend commit
`5a403f2` also strips unknown fields during payload validation and explicitly
maps columns on push and pull. It therefore needs storage and API support for
the new field before clients depend on it. Adding that support does not require
recalculating historical schedules. Old clients that omit the field must not
reset learning progress written by newer clients.

For a fixed synthetic new card reviewed at `2026-09-13T04:00:00Z` using our
current fuzz/100-day settings, Easy changed from 17 days in 4.5.0 to 8 days in
5.4.2. This is one fixture, not a general prediction for users. It shows why
the upgrade needs schedule comparisons in addition to a passing build.

## Recommended next step

Use 5.4.2 as the target for a separate, tested migration. Retain stored due dates
unless a bulk reschedule is separately requested. Cover learning-step state
across reload, sync, and Undo; compare representative grade results; and keep
the current retention/fuzz/maximum-interval choices explicit. Treat the 6.x
beta as a separate evaluation. The 4am statistics boundary does not require a
scheduler package update and does not change card due times.

## Migration guidance check — 19 September 2026

The scoped migration is a data-shape conversion and backfill, not a replay of
history or bulk rescheduling. It can share the sync migration's production
cutover while keeping independent conversion tests.

No dedicated v4-to-v5 application/database migration guide was found in the
v5.4.2 repository file list, README, API documentation, or checked release notes.
The tagged source provides compatibility helpers, rather than a complete
application migration procedure:

- `generatorParameters` calls `migrateParameters`. It accepts 17-, 19-, and
  21-weight arrays, converting and clipping older arrays. This converts a
  parameter format; it does not train weights from review history. Spaced does
  not currently supply a custom `w` array, so there are no personalized weights
  to migrate. Subsequent local optimization produced personal FSRS-6 weights;
  use the staged configuration in `FSRS_OPTIMIZATION.md` for future reviews
  after the scheduler migration.
  [Parameter conversion](https://github.com/open-spaced-repetition/ts-fsrs/blob/v5.4.2/packages/fsrs/src/default.ts)
- New cards start with `learning_steps: 0`. The learning scheduler also uses
  zero when that field is missing. Proposed Spaced backfill: preserve an existing
  valid value, otherwise write zero. For cards already Learning/Relearning, this
  means the next review uses step index zero as its starting point; it does not
  reconstruct an unrecorded old step. Keep the stored state and due date.
  [Learning scheduler](https://github.com/open-spaced-repetition/ts-fsrs/blob/v5.4.2/packages/fsrs/src/impl/basic_scheduler.ts)
- Both Card and ReviewLog require `learning_steps` in the new types. Apply a zero
  compatibility default to legacy logs at the conversion boundary, with legacy
  provenance in the migration manifest/schema. Do not label it as observed
  historical progress. `TypeConvert` converts dates/enums but does not backfill
  this field in stored cards/logs. Keep existing elapsed-day fields during the
  5.4.2 migration; they are deprecated, not removed in this release.
  [Types](https://github.com/open-spaced-repetition/ts-fsrs/blob/v5.4.2/packages/fsrs/src/models.ts),
  [Type conversion](https://github.com/open-spaced-repetition/ts-fsrs/blob/v5.4.2/packages/fsrs/src/convert.ts)

Before implementation, test these transforms for all four card states and verify
that due dates, memory state, review IDs, ratings, and timestamps remain unchanged.
Test the next review separately, since FSRS-6 changes future scheduling behavior.

FSRS-6 has 21 weights instead of FSRS-5's 19. It changes same-day stability
updates and makes the forgetting-curve decay parameter trainable. Ordinary
reviews update the card's stability/difficulty using the configured weights;
they do not fit a new personal weight vector. The separate
`@open-spaced-repetition/binding` package exposes `computeParameters` for that
purpose and is marked public beta in the tagged documentation. Adding scheduled
or user-triggered optimization remains a separate feature.
[Algorithm](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm#fsrs-6),
[Optimizer documentation](https://github.com/open-spaced-repetition/ts-fsrs/blob/v5.4.2/packages/binding/README.md)

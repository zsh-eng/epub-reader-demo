# Product audit fixes

This report tracks the fixes from the 41-item product audit against baseline
`e492704`. Work used isolated GPT 6 Astra agents at low reasoning effort, with
at most two active workers. Changes were reviewed and tested together before
integration into `main`.

## Fixed behavior

| Audit IDs | Result |
| --- | --- |
| B-01, B-02, B-03 | Deck descriptions can be empty. Card shortcuts apply to their own form. Forms await storage, retain text on failure, and block repeat saves. Card creation, deck creation, and card text edits commit the operation and sync queue together before updating visible data. |
| B-04, B-05, B-06 | New review history stores the selected grade. Undo remains available after the last card and removes the undone review from statistics. |
| B-07 | Grade estimates use the same scheduler settings as grading and are marked as estimates. |
| B-08 | Due cards, suspension expiry, statistics, and account expiry refresh at time boundaries and when the page resumes. |
| B-10 | Card table actions, import selection, callback sync, and gallery actions support keyboard input. Mobile grade controls, Undo, card action menus, image confirmation/cancellation, and heatmap dates have useful names. |
| B-12, B-13, B-14, B-15, B-16 | Imports lock before the initial scan, retain failed Undo IDs, validate deck targets, reject stale parse results, and retain each image reference's own alternative text. |
| B-17 | Deck names and search text use the same normalization. |
| B-18, B-19 | Review Activity counts all four actual states and labels the selected tooltip series. |
| B-21, B-22 | Initial sync waits for the active pull. Sign-out clears the card draft and image cache as well as the main database. Late sync/cache work cannot restore cleared data. Failed local cleanup can retry offline without another server sign-out. |
| B-24, B-25, B-26, B-27 | Offline account triggers are disabled. System theme follows appearance changes. Verification renews local session expiry. Failed account requests retain input and show recovery feedback. |
| B-29, B-30, B-31, B-32, B-33 | Image batches wait for all tasks and preserve cancellation. The queue stops when empty. The cache walker handles initial images, later images, source replacement, and removal. Image metadata and full content are repaired together. Failed HTTP responses are rejected. Offline counts include usable cached images. |
| B-34, B-40 | Upload and clipboard failures retain input and permit retry. A clipboard retry reuses the successful upload. Gallery, picker, and preview object URLs are released when no longer needed. |
| B-35, B-36, B-37 | Open review actions retain their card target and reject removed targets. Editor drafts survive layout changes. Interrupted grade key presses are cancelled. |
| B-39 | Verification and image confirmation block repeat requests and permit retry. |

All 34 entries marked as fixes in the initial audit are addressed. The user
resolved several of the seven product calls on 13 September 2026. Their status
is recorded below.

## Follow-up decisions, 13 September 2026

| Audit ID | User decision and result |
| --- | --- |
| B-09 | Undo reverses the entire grade action, including automatic sibling suspension. Undo now stores each changed sibling's previous suspension and writes inverse operations to local storage and the sync queue. It preserves a suspension changed by a later action. An absent previous suspension becomes the existing epoch-date value for an unsuspended card, so older clients can read it. |
| B-11 | Exactly 640 pixels uses the mobile review layout. Content, grade controls, and review styles now switch to desktop only above 640 pixels. |
| B-28 | Delete a cancelled upload if possible. The backend has no delete endpoint and reuses a file key for duplicate images. Safe deletion is therefore unavailable. Upload now starts only when the user confirms the preview. Closing the preview before confirmation creates no remote file. See the remaining backend limit below. |
| B-38 | Do not add selective retry for failed imported cards. Existing import results still report failures. No retry feature was added. |
| B-41 | Ask before a footer action discards unsaved card text. Bookmark, bury, unsuspend, and delete now show an action-specific browser confirmation when the text differs from its initial value. Cancel retains the draft; confirm runs the action without saving that text. Unchanged text requires no prompt. |

Delaying upload adds upload time after confirmation. A clipboard retry still
reuses the completed upload.

## UX choices made

- A blank deck description is valid, as the existing form label implies.
- Text and save controls are disabled while a save is pending. Failed saves
  retain the text and show a retry message.
- Review Activity shows New, Learning, Review, and Relearning separately. This
  matches the existing duration chart and avoids hiding a state.
- Grade tooltips say "Estimated". The existing FSRS fuzz and interval policy
  remain in place. FSRS can return 101 days with its configured 100-day maximum.
- A card action stays tied to the card selected when the action opens. A removed
  card produces an error instead of applying the action to the next card.
- Editor footer actions are disabled while a text save is pending, so they
  cannot change or delete the card during that save.
- Verification has a visible retry button. A failed local sign-out wipe has a
  "Retry local cleanup" action that also works offline. Sign-out text lists the
  local data it clears and no longer guarantees that all work can be restored.
- Image cancellation prevents queued downloads from starting. Requests already
  running settle without changing the cancelled status. A clipboard failure
  keeps the preview and description so the user can retry the copy.

## Decisions still needed

| Audit ID | Decision |
| --- | --- |
| B-20 | Which time zone defines a study day? Should a streak remain current if the last review was yesterday? The user first asked what is stored; the storage details are below. No new grouping policy has been selected. |
| B-23 | The user's "Yes" applied to a question with several options, so the sign-out policy needs clarification: sync first and stay signed in on failure; offer explicit discard after failure; or block while pending changes remain. The current policy has not changed. |

### Review time storage (B-20)

The app stores an instant in time, not a time-zone name or the offset at the
time of review. Local review fields such as `review`, `due`, and `createdAt`
are JavaScript `Date` values. Sync serializes these as UTC ISO strings.
Operation timestamps are numeric epoch milliseconds. No `Asia/Singapore` or
other IANA time-zone setting is stored.

Basic statistics, the heatmap, and the review chart currently use UTC dates to
group reviews, while some display labels use the device's local time. Existing
timestamps can be grouped in any selected time zone. They cannot recover the
reviewer's original local day after travel without a recorded time zone.

### Remaining upload limit (B-28)

If the upload succeeds but copying its link fails, closing that preview can
still leave an unused remote file. The frontend cannot safely remove it:
`POST /api/upload` returns the same response for a new file and a deduplicated
existing file, and the backend exposes no file deletion endpoint. Safe cleanup
needs a backend contract that protects files used by existing cards. Existing
remote files were not changed. This is a backend limit, not an unanswered
preference about cancellation.

Backend evidence: `src/upload.ts`, `src/index.ts`, and `test/upload.spec.ts` in
the private `zsh-eng/spaced-backend` repository, inspected on 13 September 2026.

Legacy grade history also needs a repair policy. Existing labels are not
rewritten because valid imported records cannot be distinguished safely from
records written with the old mapping.

## Verification

- Unchanged baseline: 26 tests passed; production build passed; lint had no
  errors and five existing export warnings.
- Forms and review integration: 52 tests, 196 assertions passed; production
  build passed.
- Account, cache, and save-guard integration: 72 tests, 273 assertions passed.
- Final integrated suite: 86 tests, 330 assertions passed. Lint has no errors
  and the same five pre-existing export warnings. The final production build
  passed after correcting the image table's union insert type. Existing bundle
  size and Browserslist age warnings remain.
- Browser, isolated local data: final-card Undo restored the card and removed
  its only review from Stats. Review Activity showed New 1 for the new card.
- Browser: a blank deck description saved. Cmd+Enter in the deck dialog did not
  submit or clear the background card draft.
- Browser: an unsaved editor draft survived desktop-to-mobile and
  mobile-to-desktop transitions, then saved successfully.
- Account and media failures use controlled request/storage fixtures. No live
  account credentials or remote uploads are needed for these regression tests.
- Decision follow-up baseline: 86 tests, 330 assertions passed before changes.
- Decision follow-up integration: 98 tests, 431 assertions passed. Lint has no
  errors and the same five existing export warnings. The production build
  passed using the local `.env.production` file without printing its values.
  Generated CSS includes the strict `(width>640px)` media query. No deployment
  was run. Existing bundle size and Browserslist age warnings remain.

## Suggested review order for the decision follow-up

1. `src/lib/db/memory.ts` and `src/lib/sync/operation.ts`: sibling suspension
   snapshots, guarded restoration, and compatible inverse operations.
2. `src/routes/Review.tsx` and
   `src/components/review/review-carousel.tsx`: mobile review through 640 pixels.
3. `src/components/card-actions/edit-flashcard-responsive.tsx` and
   `edit-flashcard-footer-actions.tsx`: dirty-text confirmation shared by the
   dialog and drawer.
4. `src/routes/CreateFlashcardRoute.tsx`: upload starts at confirmation.
5. `tests/review-decisions.test.tsx`,
   `src/components/card-actions/edit-flashcard-responsive.test.tsx`, and
   `src/routes/CreateFlashcardRoute.media.test.tsx`: regression coverage.

## Suggested review order for the initial audit fixes

1. `src/lib/sync/operation.ts` and `src/lib/sync/form-persistence.test.ts`:
   atomic form writes and storage rollback.
2. `src/components/create-flashcard.tsx`, `create-deck-form.tsx`, and
   `src/components/card-actions/edit-flashcard-responsive.tsx`: save timing and
   draft lifetime.
3. `src/routes/ImportRoute.tsx`, its tests, and `src/lib/import/session.ts`:
   import race guards and partial Undo.
4. `src/lib/card-mapping.ts`, `src/lib/review/review.ts`, and
   `tests/review-regressions.test.tsx`: history correctness and final-card Undo.
5. `src/components/hooks/use-review-action-target.ts`, `use-clock.ts`, and
   `use-pressable-action.tsx`: action identity and time/input boundaries.
6. `src/lib/sync/engine.ts`, `src/lib/auth/privacy.ts`, and
   `tests/account-regressions.test.tsx`: sync completion, sign-out cleanup,
   failure recovery, and expiry.
7. `src/lib/images/db.ts` and its tests: atomic cache repair and terminal
   cleanup after sign-out.
8. `src/lib/images/cache-container.ts`,
   `src/components/images/download-all-images.tsx`,
   `src/routes/CreateFlashcardRoute.tsx`, and `src/image-upload-dialog.tsx`:
   cache references, cancellation, and upload/copy recovery.

The pre-existing local edit in `src/components/stats/time-bar-chart.tsx` is
outside this change. The original audit came from a separate
`product-description` repository, which is not present in this checkout.
This report is the available record of fixes and remaining decisions.

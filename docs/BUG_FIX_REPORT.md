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

All 34 entries marked as fixes in the audit are addressed. The seven entries
marked as product calls remain open below.

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
| B-09 | Should grade Undo also restore the automatic suspension of sibling cards? |
| B-11 | Should the review layout at exactly 640 pixels use the mobile or desktop design? |
| B-20 | Which time zone defines a study day? Should a streak remain current if the last review was yesterday? |
| B-23 | Before sign-out, should unsynced work block sign-out, require an explicit discard, or offer export? |
| B-28 | Should closing an upload preview cancel/delete the early upload, or retain it for reuse? |
| B-38 | Should import retain a per-card failure list and offer retry of only failed cards? |
| B-41 | Should footer actions preserve, save, or explicitly discard unsaved card text? |

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

## Suggested review order

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
outside this change. The separate `product-description` repository remains the
baseline audit; this report records the source fixes.

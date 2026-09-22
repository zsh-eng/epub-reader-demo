# Review latency repair — 22 September 2026

## Cause

The sync run held `spaced-sync-v3` across identity, pull, and push requests.
Local review persistence requested the same lock. A slow response blocked a
local grade until the response or timeout. FSRS did not cause this wait.
Reader commits `a0252dc` and `925b322` address the related principle: local work
must not wait for network readiness. Spaced's specific cause was its shared lock.

## Changes

Network sync runs now use a separate cross-tab lock. Local writes, incoming
record transactions, account changes, and memory reloads use the short local
lock. A sync run holds a private cursor/clock snapshot and publishes it under
the local lock, retaining any newer clock reserved by local reviews. The cursor
can lag the last committed page until the next checkpoint; replay is safe.
Changed account/device identity rejects the old run. Existing outbox conflict
checks protect edits made while requests are in flight.

Plain server acknowledgements no longer rebuild the entire memory database.
The next card still waits for durable local persistence, never for an upload.

Review images are emitted without a network `src` until the local image cache
has been checked. The current card and next 20 cards retain deduplicated object
URLs and decoded images. At most four preloads run at once. Departed images are
released, including downloads that finish after cancellation. Future-card
Markdown parsing runs during idle time, with a bounded HTML cache. Missing
images can still require a download; these requests have a 15-second timeout.

## Evidence

- The three stalled-response tests fail on the prior engine: grades remain
  blocked for the entire 500 ms probe in identity, pull, and push phases.
- With the fix, local grades completed in 1–8 ms while the response stayed
  pending. This is an isolated local-write measurement, not a production frame
  latency guarantee.
- Browser fixture: next-card image decoded from a blob URL, natural width 200,
  and zero image HTTP requests while the image endpoint was unavailable.
- All 135 tests passed. Tests include pending outbox retention, clock merging,
  account identity changes, preload concurrency/refcounts, and cache-first HTML.

Review order: `src/lib/sync/engine.ts`, `src/lib/sync/local-sync-state.ts`,
`tests/review-network-latency.test.ts`, then `src/lib/images/card-images.ts`,
`src/lib/images/preload.ts`, and `src/components/review/preload-images.tsx`.

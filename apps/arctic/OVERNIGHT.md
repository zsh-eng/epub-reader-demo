# Arctic overnight handoff — 20 September 2026

Work in `/Users/admin/workbench`, branch `main`. User authorized overnight
implementation, subagents, focused commits, and sync. Keep existing Reader data
safe. The hourly work phase is complete. The user woke early on 21 September
and requested the summary immediately. `arctic-overnight-development` has been
deleted through the automation tool; no scheduled follow-up remains. Do not
restart implementation without new user input.
Keep routine automation notifications quiet. Do not claim device/deployment checks
that were not run.

## Completed milestones

- `099ce0b`, `2277b1f`: preserve Chrome ADD_DATE, O(n) import merge, bounded
  metadata workers with viewport priority, batched commits and import summary.
  Actual export: 460 links with dates. 10k parse/merge: 0.732s on Mac, not iPhone.
- `8bc97a7`, `33ae1db`: highlights and note cards/editor, native text menu,
  atomic per-annotation files, safe text anchors and explicit independent removal.
  Four browser tests + seven local storage checks passed.
- `7ebad42`, `1fdcd7e`: durable native sync foundation and mounted isolated
  backend. Ten package tests, four isolated server tests, 25 Worker tests passed.
- `b194862`: canonical URL domain repository, account isolation, atomic edits,
  explicit local-to-account import preserving tombstones; seven domain checks.
- `dca518c`: cached library projections, bounded/cancellable image work, off-main
  thumbnail decoding, aggregate import/tag sheet, Xcode annotation wiring.

## Ownership / next run

All overnight agents are idle and their completed changes are committed. The
independent fixes and bounded regression sweep are complete. The user requested
the summary early and the scheduled task was removed. Live sync activation remains blocked
on explicit approval. The separate uncached publisher extraction limitation is
measured below; no speculative early-DOM change was shipped. Do not repeat
passing checks or invent new features merely to keep the automation busy.

## Approval blocker — do not bypass

Automatic approval review rejected the live ArticleStore async rewrite before
execution: changing nearly all persistence paths was judged a data-loss and
app-breakage risk beyond incremental authorization. No rewrite ran. Root removed
only its own premature async callers. ArticleStore still uses its existing local
JSON file and synchronous user mutations. Do not retry that rejected activation
without explicit approval. Finish a concrete, reviewable migration and its fault
and performance checks first, then explain the review block and ask the user.

`e638fbb` adds dormant local-only journal fields and fault checks: a disk failure
publishes neither rows nor receipts; account copies exclude local paths/receipts.
Latest totals: twelve domain tests and twenty package tests pass. `763a0e9`
adds atomic one-article edits and unchanged-write checks. Mac release medians:
1k rows 28.3 ms per edit, 10k rows 320 ms (179 ms with empty outbox). At 10k,
JSON encoding costs 312 ms versus 6.3 ms for the atomic byte write. See
`Sync/PERFORMANCE.md` for measured evidence and the reviewable SQLite proposal.
The JSON journal remains unsuitable for frequent 10k-row edits. No SQLite engine
or live migration was introduced.
The sync package is compiled into the app but no journal or account UI is active.

## Validation and current follow-up

Simulator `54FFC388-03B0-4448-99C7-C16F7ECA99C6`; root owns it. Derived data
`/tmp/articles-onboarding-build`. Standard xcodebuild project/scheme ArticleReader,
CODE_SIGN_IDENTITY=-. Use native tests, not browser tests, for UIKit behaviors.

Passed native: Chrome import/restart (before aggregate assertions); Reader/Website
Copy and Unicode; both annotation tests (light persistence/independent removal,
dark Add note/reveal); 1,000-row scroll/search/restart; Reader layout/disk images.
Artifacts `/tmp/arctic-overnight-library.xcresult`,
`/tmp/arctic-overnight-interactions.xcresult`,
`/tmp/arctic-overnight-import-tags.xcresult` (last may still be running).

Initial long-list failure was a test-only preload debug overlay intercepting
search taps; fixed with allowsHitTesting(false), retest passed. Preload test was
updated to wait for the last card to become visible and query its URL after real
metadata changes the fixture title. Aggregate selectors corrected from Other to StaticText and exact label
`· 2 tagged`; final import count test passed. The final viewport test scrolls the
last card above the search bar before tapping and now passes.

Image work check: compile Sources/PreviewImageWorkLimit.swift and
Checks/PreviewImageWorkChecks.swift together. 80 jobs completed, peak 3;
cancelled saturated queue entry did not block another job. Native note quote
card fits short passages and caps long passages at 170pt; dark native test passed.

## Sync release boundary

Native app bridge/account UI, annotation sync and HTML durable upload intent are
not yet finished. Do not describe sync as shipped. New empty APAC D1 `arctic-db`
id `810925d0-4966-4da9-840b-16e6347e245e` exists; remote migrations NOT applied,
Worker NOT deployed. Read SyncServer/README.md for exact commands and constraints.
Default wrangler config is required (old production env lacks bindings).
Jev key never syncs. Preserve local use and isolate account rows/caches on logout.
Full source lint passes excluding generated Resources/reader.js; raw lint has
known existing generated-bundle violations. Device performance is unverified.

## Later verified milestones

- `654d2ab`, `f447ade`, `024c614`: Reader text does not await decorative images or
  body-image completion; warm redirected URL reuse; requested link identity kept
  through Save/history/offline restart; extraction cancellation guarded.
- `/tmp/arctic-reader-performance.xcresult`: five native checks passed (import
  counts, viewport, dark note editor, held artwork/body resources, warm redirect).
- `/tmp/arctic-final-reader.xcresult`: three native checks passed (extended
  redirected Save/offline restart, Reader/Website Copy, share Save before metadata).
- `a6d6254`: Google PKCE handshake staged; no real Google login or deployment.
- Root reviewed screenshots of import counts, dark note editor and collections.
  Useful morning images: `/tmp/arctic-reader-performance-images/8AA745DE-28AD-4962-B0DD-5854D4CAA167.png`
  (import summary), `9398D0D8-8C3B-4930-B466-8D0A64D56C2C.png` in same folder
  (compact dark note editor). These show fixture content, not the user's data.

## Final verified milestones

- `3797f5a`, `6e1a2f8`: fixed-allowlist bundled font scheme replaces repeated
  base64 fonts in new HTML. Font CSS falls from 1,455,393 to 337 bytes. Actual
  saved test article is 4,888 bytes, with no embedded font payload. Existing
  cached HTML remains readable. Native offline DM Sans and EB Garamond checks
  pass. Font loading never blocks initial text readiness.
- `/tmp/arctic-bundled-fonts.xcresult`: two checks pass (offline fonts and
  highlight/note persistence). Across this session, eleven distinct native UI
  checks pass, including a 1,000-article library and mock-Jev share tagging.
- `d323436`: native exchange rejects cross-site login CSRF and binds encrypted
  codes to their hash, PKCE challenge and expiry. Ten auth Worker checks pass.
- `7a89422`: account transport retirement rejects late credential refresh after
  cancel/account switch. Four in-memory lifetime regressions pass; twenty total
  Swift package tests pass. Integration MUST await remote.cancel() before
  replacing/clearing this server's Keychain entry.
- Final Xcode build passes: `/tmp/arctic-final-overnight-build.log`.
- Raw generated reader.js lint failures reproduced on baseline `0e3a9ef` and
  current source: 883 errors each. Reports `/tmp/arctic-baseline-lint.json` and
  `/tmp/arctic-current-lint.json`. Source lint excluding that generated bundle
  and relevant native formatting checks pass; backend bun build passes.

Morning summary must separate shipped local app changes from dormant sync code.
No production Worker deployment, remote migrations, native account UI, annotation
sync or durable HTML upload bridge yet. No real Google consent or physical-iPhone
performance validation. Do not imply the tests prove iPhone responsiveness.

## 23:40 heartbeat — background preload lifecycle

- Reproduced five retained speculative article browsers after Library entered
  background: `/tmp/arctic-background-before.xcresult` fails with 5 versus 0.
- Library now calls `releaseOffscreen()` only for `.background`, retaining the
  last opened Reader. Transient `.inactive` states keep the warm viewport.
- `/tmp/arctic-background-after.xcresult` passes: no unopened neighbors retained
  after Library background, viewport prepared again on resume, then exactly one
  open Reader retained across a second background/resume with readable text.
  Native build and strict Swift formatting pass. This measures retained document
  ownership, not operating-system memory reclaimed or physical-device latency.
- No storage migration or live sync activation attempted.
- Read-only `viewport_audit` finished. Next profiling candidate: BrowserPool's
  eight-second preparation timeout releases a queue slot without stopping its
  publisher load; ten rows can accumulate ten running loads. Also uncached
  extraction starts from publisher didFinish, so held publisher subresources can
  delay extraction (the DOM-ready bridge is only on generated Reader HTML).
  Use a deterministic held-resource native fixture to measure before changing
  that policy. Avoid clearing prepared HTML or breaking Website mode merely to
  enforce an incidental request count. All agents are idle.

## 00:41 heartbeat — stalled publisher preparation

- Confirmed the separate uncached extraction limitation with a held publisher
  image: Reader remained disabled beyond 20 seconds in
  `/tmp/arctic-publisher-before.xcresult`. No early-DOM extraction was shipped:
  dynamic pages can pass the extractor's minimum length with partial text, and
  wrapper/iframe pages may not yet contain the article. A future change needs
  partial-content, final-load retry and stale-navigation tests before activation.
- Fixed the queue timeout path instead: stop and remove an expired speculative
  browser before opening its preparation slot. The active/last opened Reader
  is exempt; tapping an expired row starts a fresh foreground load. Recheck
  queue version/cancellation inside the suspended loop before retiring anything.
- The native fixture holds a publisher image indefinitely. Its probe uses weak
  live handler owners. A global starts-minus-stop counter was inaccurate:
  WebKit can discard a handler without calling its public stop callback when
  the Cocoa view is gone. No blank-document teardown change was retained.
  Primary evidence: WebKit Source/WebKit/UIProcess/Cocoa/WebURLSchemeHandlerCocoa.mm
  and Source/WebKit/UIProcess/WebURLSchemeHandler.cpp in the WebKit GitHub repo.
- This bounds stalled speculative documents, not all image requests or the
  user's foreground page. The final two requests may stay pending; normal
  viewport eviction/background release still owns their lifetime.
- `/tmp/arctic-publisher-live-owners.xcresult`: three native checks pass:
  held publishers progress to another pair while live held owners stay at two;
  tapping the expired first row starts a cold working Website; cached viewport
  preparation/search still reuses HTML; background/resume preserves Reader.
  Redirect/save/offline identity also passed in the intermediate suite; its
  unrelated held-resource counter failure was fixed as described above.
  Build, strict Swift formatting and diff whitespace checks pass.
- No sync activation, migration, deployment, API credentials or real user
  content were involved. All agents are idle. The remaining uncached extraction
  delay is measured and documented above; do not claim it was fixed by bounding
  the speculative queue or change it without the dynamic-content regressions.

## 01:42 heartbeat — note editing and current documentation

- Bounded notes audit found and reproduced a data-loss bug: Remove highlight,
  edit its note, clear the text, then type a replacement. Clearing the last
  character tombstoned the passage; subsequent edits silently did nothing.
- `40f9660` separates `updateNote` from explicit `deleteNote`. Empty drafts retain
  their UUID through disk reload and rewriting. Delete note is available for an
  empty note-only passage; there is no destructive dismissal cleanup.
- Focused Swift storage checks pass for replacement after restart, explicit
  deletion with/without a highlight, empty-draft deletion, stale merge and
  damaged-record isolation. Agent reviewed the bounded note flow and found no
  other confirmed defect.
- Native validation: both existing annotation tests pass in
  `/tmp/arctic-note-rewrite.xcresult`. The new test initially sent Delete at the
  initial caret position and therefore did not clear text; it was corrected to
  use the actual iOS Select All menu. `/tmp/arctic-note-select-all.xcresult` then
  passed clear/rewrite, offline restart with the same passage UUID/text, and
  explicit deletion. Build and strict formatting pass.
- README corrected stale claims of no highlights and sequential import. It now
  covers dates, batch tags, bounded thumbnails/preloads, bundled fonts, notes,
  test scope and the dormant sync boundary. Local documentation links verified.
- No early publisher extraction change was made; its partial-content and stale
  navigation risks remain documented. No sync activation or deployment.
- Next run: a bounded regression sweep of existing share/import/annotation
  behavior is appropriate. Add production changes only for a confirmed defect;
  do not invent features or retry the blocked storage integration to fill time.

## 02:44 heartbeat — final entry-flow checks and morning follow-up

- `/tmp/arctic-entry-regressions.xcresult`: three native checks pass on the latest
  implementation: cancelling a prepared share saves neither article nor tags
  across restart; pasted query variants preserve the correct Save/Open behavior
  and one saved identity; Open then Save in Reader reuses prepared tagging.
- Sync integration README now explicitly requires awaiting transport retirement
  before clearing/replacing credentials even when remote sign-out fails. This
  documents the existing lifetime-tested behavior; no sync code was activated.
- Independent overnight work is complete. The remaining live sync migration
  needs the specific user approval already requested. Do not infer approval.
- Updated the existing automation to an 08:00 Singapore morning-summary
  follow-up. It must report the implementation/validation boundaries and pause
  after delivering the summary. No further overnight feature work is queued.

## Morning feedback — 21 September

New user input authorized this follow-up after the overnight automation was removed.
Work remains on main; live sync/storage migration stays dormant.

- `669fab4` plus follow-up fixes: default warm yellow and four adaptive highlight
  colours, tap-to-edit controls, medium note editor and independent removal.
- `53d31cb` plus follow-up fixes: library-wide Highlights & notes collection,
  search/filter/edit/offline source jump, floating material/glass controls.
- `78a8ca3`: size-specific off-main image decoding, compact HEIC/JPEG/PNG
  resources, tiny local previews, bounded viewport image preheat, queued visible
  priority, Reader webview preparation deferred during scrolling, ProMotion key.
- Hidden search result rows now unmount; iOS 26 safe-area controls unmount behind
  modal sheets with equal-height placeholders. AccessibilityHidden alone left
  native hosted controls exposed; native regression tests found this.
- Codec checks: one controlled photo 205,494-byte prior JPEG85 -> 57,818-byte HEIC
  at the same 1,200x900 size; alpha/orientation/Reader MIME and priority/cancellation
  checks pass. See PERFORMANCE.md for exact implementation and Telegram sources.
- Native checks: highlight persistence and independent note removal, dark note
  editing, Reader controls/offline images, 1,000-row search and viewport preloads,
  recolour/tap/offline restoration, actual medium detent, and global passages
  search/edit/offline source jump verified. Earlier UI failures were corrected,
  not suppressed by retries or weaker selectors.
- No physical-device 120 Hz claim. The new 1,000-photo scrolling fixture uses one
  bundled image with independent cache identities; no network timing is simulated.

Final focused native suite: `/tmp/arctic-feedback-final.xcresult`, 5/5 passed;
combined with four other distinct initial successes, nine native flows verified.
Simulator scroll metric reports duration only (2.594s average), no FPS/hitch ratio.
The CJK text remains intact in DOM assertions, but screenshots show missing-glyph
boxes in this simulator; physical-device font rendering remains a visual check.
Visual review replaced an unavailable remove-highlight SF Symbol with `eraser`;
`/tmp/arctic-highlight-icon.xcresult` confirms the recolour/medium/offline flow still
passes. Final colour controls, medium sheet and global collection screenshots
were inspected in both light and dark presentations.

## 21 September follow-up: keyboard, import and scrolling

User requested another UI/performance pass after the overnight summary. Main:
`321f6ca` distinct Arctic empty states; `56a55b5` failed-webpage Retry/reopen;
`c084f4e`/`c150114` keyboard dock and light rainbow beam; `f8d166c`/`34e4298`
optional callback diagnostics; `7abf010` persistent thumbnail sizes/legacy blur
previews/native arc; `0221129` import batching, scroll pause and cached derived
values. Root integration adds actual content behind the glass header, stable
pending-card size, diagnostic menu and native replay assertions. See
PERFORMANCE.md for the loopback benchmark and thirteen focused native checks.
No publisher requests in replay tests. Sustained physical 120 Hz remains
unverified. Live storage migration remains dormant; no automation was recreated.


## Physical fast-scroll diagnosis and fix

- Baseline Time Profiler caught 711–928 ms main-thread samples per second during
  the rapid-scroll window, with broad library row/button/context-menu work.
- Isolated visibility observation and preload tasks in LibraryPreloading.swift.
  Image fix `0b2f99e` removes serial codec blocking and blur-before-image waiting.
- Three focused native preload/import/1,000-photo checks passed; signed Release
  build installed on the user's iPhone preserving its data. User reports scrolling
  works great. After trace saved; see PERFORMANCE.md for artifacts and limits.
- Baseline Debug versus updated Release and unmatched gesture windows prevent
  attributing the improvement to one change or claiming measured sustained 120 Hz.
  Live storage migration remains dormant. No automation recreated.

# Arctic library: image and scrolling changes

21 September 2026. Native iOS app only.

## What changed

- **Decode for the display size.** Previously even a small search thumbnail decoded the full cached image (up to 1,200 pixels). Images now use separate decoded variants: 96 px icons, 192 px clipboard previews, 256 px search/history thumbnails and 960 px library cards. ImageIO downsamples compressed bytes off the main thread, with at most two concurrent display decodes, including disk-cache hits.
- **Store compact resources.** New downloads are resized to at most 1,200 px. Opaque images use native HEIC when supported and smaller than JPEG; otherwise JPEG quality 0.8. Images with alpha retain PNG transparency. Existing cache files remain readable. No bulk cache rewrite runs at launch. Display derivatives (96/256/960 px) now persist in the same bounded disk cache. Saved Reader HTML receives JPEG/PNG for WebKit compatibility. Original downloads use temporary files and an ephemeral session, rather than a persistent URL cache.
- **Preheat nearby images.** Visible rows and two neighboring rows feed a bounded preheat task. Two speculative consumers share URL downloads with visible rows. New visible requests go ahead of queued speculative work. Leaving the working set cancels unneeded request leases. Active shared work remains available to other consumers.
- **Show a small preview first.** Each newly cached image has a 24 px local preview. The UI can blur this while decoding the display variant; a growing circular arc appears only after 250 ms. Cached decoded images display immediately. No arrival animation runs repeatedly during fast scrolling. Missing previews from older cached images now regenerate locally, with a separate 1 MiB decoded-preview cache. The tiny preview is available only after the first download: publishers do not supply Telegram-style thumbnail bytes with their URLs.
- **Keep work bounded.** Three download/encode slots, two display-decode slots, a 32 MiB decoded-image cache and a 128 MB disk cache. The existing lazy list and cached sorted projections remain. Inactive search-result rows now unmount, so they do not load images behind the library; the native search field remains ready during normal search transitions. A URL index avoids scanning the whole list for each prefetch request. Images continue loading during scrolling; new speculative Reader webviews wait until scrolling is idle for 150 ms (iOS 18+).
- **Enable ProMotion.** The app opts into high-refresh Core Animation timing. iOS still controls the actual rate; this is not a claim of sustained 120 fps.

## Measured image example

The bundled Glacial Longings photograph was resampled to a 4,000 × 3,000 JPEG to make a repeatable large-input fixture. This is one controlled example, not a survey of publisher images.

| Representation | Result |
| --- | ---: |
| Source JPEG | 1,860,046 bytes |
| Previous 1,200 × 900 JPEG, quality 0.85 | 205,494 bytes |
| New 1,200 × 900 HEIC | 57,818 bytes (72% smaller) |
| Tiny 24 × 18 preview | 1,227 bytes |
| Decoded 96 × 72 icon | 27,648 bytes |
| Decoded 256 × 192 thumbnail | 196,608 bytes |
| Decoded 960 × 720 card | 2,764,800 bytes |

Checks also cover alpha preservation, EXIF orientation, invalid input, Reader MIME conversion, visible-before-prefetch queue order and cancellation. Native HEIC avoids adding a large third-party codec dependency. Encoding availability is checked at runtime; a WebP type identifier alone does not establish encoder support. [Apple ImageIO encoders](https://developer.apple.com/documentation/imageio/cgimagedestinationcopytypeidentifiers()).

## Lessons from Telegram

Telegram separates visible and loaded ranges, performs image transforms in the background, and uses small immediate thumbnails plus cached image representations. Arctic now applies those techniques to its image pipeline, within its existing SwiftUI lazy list. We did not port Telegram's custom list engine or claim that its inactive web-file prefetch branch handles all OG images. Sources: [ListView](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/Display/Source/ListView.swift), [TransformImageNode](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/Display/Source/TransformImageNode.swift), [PhotoResources](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/PhotoResources/Sources/PhotoResources.swift), [InChatPrefetchManager](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/TelegramUI/Sources/InChatPrefetchManager.swift).

## Validation boundary

Codec and scheduler checks pass on the Mac. Simulator interaction and scroll checks are recorded with the change. The scroll fixture has 1,000 independent cache keys backed by one local photograph; it exercises decoding, compressed-resource caching and fast scrolling without publisher network variance. It does not reproduce a mixed live news feed. A simulator cannot establish physical-device 120 Hz performance. At 120 Hz each frame has about 8.33 ms; test fast scroll and deceleration on a physical ProMotion iPhone with animation-hitch instrumentation, including cold network images, memory pressure and Low Power Mode. [Apple hitch measurement](https://developer.apple.com/videos/play/wwdc2020/10077/), [ProMotion guidance](https://developer.apple.com/documentation/QuartzCore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays).


Final native result: `/tmp/arctic-feedback-final.xcresult`, five focused flows passed (recolour/offline/medium notes, note-only rewriting, long-list search, global passages, photo scrolling). Four other distinct native flows passed in the initial regression run. The simulator supplied scroll-duration values of 2.5995 / 2.5831 / 2.5989 seconds; it supplied no FPS or hitch ratio. These are a reproducible diagnostic baseline, not a before/after scrolling improvement claim.

## Follow-up: import churn and local replay

The first seconds of import had three avoidable costs: each response changed
observable scheduler state, the disk-write timer forced preview publication, and
viewport updates recomputed tags/saved IDs across the full library. Scheduler
bookkeeping is now unobserved. Derived values are cached per committed revision.

Metadata uses six requests overall, at most three per host. Visible results batch
for 120 ms; background results batch for 600 ms. Automatic metadata publication
pauses during drag and deceleration; fetching continues until the combined
completed/in-flight buffer reaches 48. Scrolling idle or foreground exit flushes
pending work. User saves retain their existing durability. Pending cards reserve
cover geometry, so arriving covers do not increase their height. Articles without
cover metadata still settle to compact text cards. Images load for the viewport
and nearby rows; finishing metadata import does not download every article body
or every offscreen image.

`Tests/bench-import-replay.py` serves bundled HTML/cover on a loopback HTTP server.
It fetches metadata only and exercises the production queue/commit code with
10,000 temporary records. No publisher requests or user data are involved.
Baseline `d1aab68` has the same ArticleStore bytes as pre-change `03536e7`.

| Controlled host replay: 180 metadata requests | Before | After |
| --- | ---: | ---: |
| Elapsed completion, idle | 7.782 s | 4.024 s |
| Published metadata batches | 52 | 7 |
| JSON snapshots | 15 | 7 |
| Cumulative publication work | 261 ms | 4 ms |
| Cumulative JSON encode/write time | 981 ms | 475 ms |
| Publications during a simulated 1.5 s scroll | 10 | 0 |
| Completion including that scroll pause | 7.821 s | 4.857 s |
| 1,000 repeated tag/saved-ID reads | 7.936 s | 3 ms |

Source dates and restored metadata were checked. A separate 10,000-entry
parse/merge check took 0.781 s. These are controlled Mac results, not iPhone
frame timings. One earlier wall-clock anomaly was excluded and the complete
comparison was repeated with bundled HTML. Raw result:
`/tmp/arctic-import-replay-bundled.log`.

## Thumbnails and loading feedback

96/256/960 px compressed derivatives survive process restart and work offline.
The single fixture produced 2,127 / 7,148 / 61,406 byte derivatives. Source alpha
metadata prevents opaque HEIC images from incorrectly becoming large PNG files;
real transparency remains intact. The original remote download is temporary.

The loading indicator grows from an arc to a circle with Core Animation, without
per-frame SwiftUI state updates. Reduced Motion removes animation. Full cached
images appear immediately; we do not delay them to display a blur. A previously
unseen URL has no blur until its first image bytes arrive.

## Device diagnostic

Open **Sort and filter → Frame diagnostics**. It is off by default. The overlay
reports recent display-link callback FPS, estimated missed callback slots and
maximum callback gap. It requests the attached display's supported upper rate,
updates its own UI twice per second, and stops sampling when disabled or inactive.
It does **not** measure compositor frame delivery or finger latency. Use Instruments
on a physical ProMotion iPhone to verify sustained 120 Hz and animation hitches.

The scroll surface now extends behind the status area and both floating bars.
One continuous material fade avoids an opaque safe-area slab or a seam between
separate header backgrounds. Reduce Transparency retains a solid alternative.

## Follow-up validation

Thirteen distinct native flows passed across the focused simulator runs:
keyboard geometry/error state; onboarding skip/persistence; card/search layout;
empty library/bookmark/archive; dark passage empty states; website Retry; pooled
reopen; downloaded Reader preservation; fixed bar/back swipe; 1,000-row search;
glass header/diagnostic toggle; cold 460-link import; warm 1,000-photo scrolling.
The import probe reported `460/460; dates=true; scrolls=6; during=0; batches=17;
buffered=48; workers=3`. This replay uses one fixture host, so its host limit is
three. The two-host HTTP benchmark separately checks six overall workers.

Results: `/tmp/arctic-feedback-first.xcresult`,
`/tmp/arctic-feedback-layout.xcresult`,
`/tmp/arctic-feedback-performance.xcresult`. The first two runs exposed test
selector errors, which were corrected and passed on rerun. A visual review also
caught and corrected the initial safe-area inset before the final header check.
Codec/disk-cache/scheduler/date checks and the native build passed. The warm
scroll metric still reports gesture duration only (2.566 / 2.599 / 2.584 s), not
FPS. Its test runner had a long wall-clock interruption, so no wall-clock or
frame-rate improvement is claimed from that run.

Remaining device checks: repeated rapid scroll while importing on a physical
ProMotion iPhone, memory pressure, real network loss/recovery, and keyboard
animation timing. The callback overlay helps find stalls but does not replace an
Instruments Animation Hitches trace.

## Physical fast-scroll follow-up, 21 September

A Time Profiler capture on the user's iPhone 15 Pro Max caught the reported
45–70 callback-FPS drops. In the baseline's active scroll window (seconds 27–34),
main-thread sampled work was 711–928 ms per second. Library row construction,
article buttons and context menus were prominent in the stacks. Inclusive stack
times overlap and must not be added together.

The library previously observed its visible-row set. Every viewport entry/exit
could invalidate the parent view and rebuild its row-producing closures.
`LibraryViewportVisibility` now feeds an isolated `LibraryPreloadDriver`; the
parent does not read that set. Metadata, image and Reader preloads still follow
the visible rows and their two nearest neighbors. Heavy Reader preloads remain
paused during scrolling.

The image pipeline also publishes a ready image without waiting for a blur
preview. Codecs run outside the serial disk-cache actor with two bounded workers,
so conversion cannot hold cached reads behind it. Five local fixture rounds
reduced a hot persisted-thumbnail read under conversion load from 511.83 ms to
3.36 ms, and first display conversion from 108.19 ms to 43.52 ms. These are Mac
cache measurements, not iPhone FPS. Image work is committed as `0b2f99e`.

A signed optimized Release build was installed on the same phone without removing
its data. The user reported that scrolling now works great. The comparison trace
contains several activity periods, not a precisely matched gesture interval.
The baseline was Debug and the update is Release, so the effects of the source
changes and compiler optimization are not isolated. Do not infer a precise FPS
gain or sustained 120 Hz from these CPU samples.

Evidence: `/tmp/arctic-device-scroll-live.trace` (baseline),
`/tmp/arctic-device-scroll-after-v2.trace` (updated),
`/tmp/arctic-disk-phase-profile/` (local image benchmark). Three focused native
tests passed in `/tmp/arctic-viewport-isolation.xcresult`: viewport Reader
preparation, import replay with no metadata publication during scrolling, and
warm 1,000-photo library scrolling. Swift formatting, diff checks and the signed
Release build passed. The SwiftUI Instruments template returned empty event
tables on this device/toolchain; Time Profiler supplied the usable evidence.

## Search opening and compact scrolling follow-up

The physical first-Search trace included native keyboard initialization and
speculative Reader WebView construction in the same opening interval. Reader
preloading now waits for keyboard frame transitions to finish; image/metadata
preheating remains active. Keyboard-driven viewport bounds are observed by small
row modifiers rather than LibraryView. The retained library ignores keyboard
insets so its hidden cards keep their layout and scroll position.

Search text uses one native layout with bounded width/configuration caches. The
old ViewThatFits also considered the subtitle's ideal width and hid a long
subtitle even when the title fit one line; the new local-photo replay reproduced
that bug before the fix. Only title width now chooses the subtitle variant.
Two-line truncation, query highlighting, native colours and Dynamic Type remain.
Shared card titles also reuse unchanged attributed text and size measurements.

The user tested the updated Release build on the iPhone and reported that Search
feels good. Both captures used Release builds, but gesture timing differs and
CPU sampling does not establish a compositor FPS improvement. Traces are at
`/tmp/arctic-search-before.trace` and `/tmp/arctic-search-after.trace`.
Four native flows passed in `/tmp/arctic-search-after-ui.xcresult`: first-open/
rapid photo scrolling/filter/reopen, title/subtitle geometry, 1,000-item search,
and viewport Reader preparation. The initial replay failed on the subtitle bug
and passed after the source fix.

Dark accessibility-size title/subtitle bounds passed in
`/tmp/arctic-search-accessibility-final.xcresult`; its first assertion incorrectly
assumed the short fixture title would wrap, and was corrected after inspecting
the captured screen. The final row-identity change also passed viewport Reader
preparation in `/tmp/arctic-search-accessibility-v2.xcresult`. Light and dark
screenshots were inspected. Swift formatting, diff checks and the signed Release
build passed; the final build is installed and launched on the iPhone.

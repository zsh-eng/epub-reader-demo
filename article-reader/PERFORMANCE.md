# Arctic library: image and scrolling changes

21 September 2026. Native iOS app only.

## What changed

- **Decode for the display size.** Previously even a small search thumbnail decoded the full cached image (up to 1,200 pixels). Images now use separate decoded variants: 96 px icons, 192 px clipboard previews, 256 px search/history thumbnails and 960 px library cards. ImageIO downsamples compressed bytes off the main thread, with at most two concurrent display decodes, including disk-cache hits.
- **Store compact resources.** New downloads are resized to at most 1,200 px. Opaque images use native HEIC when supported and smaller than JPEG; otherwise JPEG quality 0.8. Images with alpha retain PNG transparency. Existing cache files remain readable. No bulk cache rewrite runs at launch. Saved Reader HTML receives JPEG/PNG for WebKit compatibility. Original downloads use temporary files and an ephemeral session, rather than a persistent URL cache.
- **Preheat nearby images.** Visible rows and two neighboring rows feed a bounded preheat task. Two speculative consumers share URL downloads with visible rows. New visible requests go ahead of queued speculative work. Leaving the working set cancels unneeded request leases. Active shared work remains available to other consumers.
- **Show a small preview first.** Each newly cached image has a 24 px local preview. The UI can blur this while decoding the display variant; a spinner appears only after 250 ms. Cached decoded images display immediately. No arrival animation runs repeatedly during fast scrolling. The tiny preview is available only after the first download: publishers do not supply Telegram-style thumbnail bytes with their URLs.
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

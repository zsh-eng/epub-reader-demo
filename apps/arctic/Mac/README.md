# Arctic for Mac

A native macOS 14+ workspace for Arctic. Open `../ArcticMac.xcodeproj`, select
**ArcticMac**, and run on **My Mac**. Xcode 26 is used for validation. The Mac
project compiles the existing article, annotation, reading-session, metadata,
tagging, image-codec and WebKit-resource sources directly. These are shared
sources, not copies or a new database implementation.

The local optimized build is at `../.build/mac/Arctic.app`. Build products are
ignored by Git; the Xcode project is the reproducible source. This is a local
development build, not a notarized distribution.

## Interaction

- The left sidebar holds library folders and collections in compact, text-only
  rows. Open articles sit in a horizontal strip above the content. Notes open
  on the right. Selection uses a neutral wash in both system appearances.
- Tabs have fixed widths and reserved close-button space, so hover does not
  move their titles. Overflow scrolls to reveal the selected tab. Close is also
  available through the context menu and keyboard.
- Hover and selection washes use a 140 ms fade; Reduce Motion removes it.
  Article switches mount the retained reader immediately. Opening notes changes
  the reader width once, without a spring resizing WebKit on every frame. The
  notes content enters with a 180 ms fade and 6 pt translation inside its final
  bounds; Reduce Motion removes both.
- **⌘K** finds a library article or opens a URL. Opening does not save it.
  Saved, Favourites, Downloaded, History and Archive keep the iPhone rules.
- **⇧⌘[ / ⇧⌘]** switch articles; **⌘W** closes an article;
  **⇧⌘T** reopens the last closed article. Open tabs restore on next launch,
  without starting their publisher requests.
- **⌘B** toggles the sidebar. **⌘L** returns to the library.
- **⌥⌘B** opens notes beside the article. Text selection supports Highlight
  (**⇧⌘H**) and Quote in note. New annotations on an unsaved article explicitly
  save it; existing annotations remain separate from library status.
- **⌘F** opens Find; **⌘R** refreshes Reader from the original URL.
  Article links open independent tabs. Command-click opens a background tab.
- **?** opens searchable shortcut help outside text fields. **⇧⌘/** also
  opens it while a text input has focus. App-specific bindings come from one
  catalogue shared by the menus and help panel.
- Import accepts Chrome Reading List HTML and preserves its source dates.
  Automatic tags use a user-provided Jev key in the Mac Keychain.

This first port uses one workspace window with multiple article tabs. It does
not replace the iPhone app, migrate its storage, or enable cross-device sync.
Mac data lives in its own sandbox container. Public HTTP-only websites retain
macOS transport-security restrictions; use Open in browser for those sites.
The local-network exception is limited to development replay and LAN URLs.

## Why keep three readers?

A tab is a URL and title. The three most recently used tabs can own live Reader
WebViews. Warm switching mounts the same view; it does not reconstruct HTML or
reset the document. Eviction saves a text checkpoint and preserves the draft
and its quoted context in workspace memory. Cold tabs reload their saved HTML.
Memory pressure drops inactive readers. Website views are created on demand
and released after extraction when the website is not visible. Keeping Website
mode in all three retained tabs can retain three additional website views.

After 300 ms, the adjacent open tabs can prepare **local saved HTML**. This never
visits a publisher, creates history, saves a link or records reading time. There
is no unbounded web-view pool. Unsaved tabs without a local Reader copy need
network access again after eviction. Note drafts survive tab eviction, but are
not durable across quitting the app until sent.

Warm tab switches also avoid rewriting the whole article index. History records
one visit when a tab first becomes visible and another when it is closed and
reopened. This tradeoff keeps the existing JSON storage untouched. Initial opens,
saves and imports retain the shared store's write costs. A future approved
storage migration should address very large library mutations independently.

## Library and image work

`NSCollectionView` reuses visible grid items. Filtering uses a cancellable background
snapshot. Viewport notifications do not invalidate the parent SwiftUI view.
The shared metadata scheduler gets visible items and four neighbors on each side after a short
scroll-idle interval. Only visible cells and that nearby range request images.

ImageIO decodes at 640 px for Retina grid cards. The disk cache stores only these
JPEG/PNG derivatives, not original publisher downloads. It is trimmed to 64 MiB
in batches; decoded memory has a separate 48 MiB limit. Three workers serve
visible requests before queued prefetch work. URL requests are shared by leases;
when the last consumer cancels, queued or active work cancels too. These Mac
adapters reuse Arctic's tested codec and work limiter.

## Reproduce checks

```sh
# From apps/arctic
xcodebuild -project ArcticMac.xcodeproj -scheme ArcticMac \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath /tmp/arctic-mac-build \
  -only-testing:ArcticMacTests test

# In another terminal, enable the local network extraction check:
python3 MacTests/replay-server.py

# Requires an unlocked Mac with Xcode UI automation available:
xcodebuild -project ArcticMac.xcodeproj -scheme ArcticMac \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath /tmp/arctic-mac-build \
  -only-testing:ArcticMacUITests test
```

Core tests use temporary metadata/HTML folders. The optional replay listens only
on loopback and serves invented article text; it sends no publisher or Jev
requests. UI tests use separate test links, annotations and reading-session files.
No test resets the user's real library.

## Evidence and limits — 24 September 2026

- Debug and optimized Release Mac builds and the iOS Simulator regression build passed.
- The shared WebView suite passed all 22 tests. Repository lint and strict
  formatting checks for the Mac Swift sources passed.
- Six native core checks passed: pool bounds/reuse and deallocation; immutable
  link identity and saved HTML; background preparation with no visits/time;
  archived favourites; drafts across eviction; cold versus warm preparation.
- In one Debug host run, three saved documents reached Reader readiness in
  **65.31 / 64.92 / 65.64 ms**. Thirty warm WebKit text queries had a median of
  **0.13 ms**, p95 **0.63 ms**, with no second HTML loads. This measures document
  readiness and WebKit access, **not visible tab-switch latency or frame rate**.
- The initial UI test runner timed out enabling automation. A later computer-use
  attempt confirmed that the Mac was locked. A light-mode empty-library screenshot
  was inspected; article interactions, dark-mode layout and high-refresh frame
  delivery still need the unlocked desktop check. A subsequent core-test launch
  also waited in XCTest’s IDE-session handshake (confirmed with a process sample),
  so the newly added loopback extraction check has not yet completed. The six
  core results above are from the preceding successful run.

The Article menu's **Reader diagnostics** shows retained readers, pool hits and
misses, last readiness time and load count. Readiness also goes to unified logs.
Use Instruments for compositor hitches and physical high-refresh performance;
these counters cannot establish sustained 120 fps. Compare cold extraction,
cold saved HTML and warm tab switches separately, using the replay server rather
than live publisher timing.

## Design reference

The sidebar proportions and restrained hierarchy reference [Search by Office
Commun](https://github.com/driceroland/Search/tree/245a26145cf7a7e7bd5bf47744a334bcaeea5096).
Its `Design.swift` and `Side.swift` use a neutral canvas, soft selection, compact
rows, and a small motion vocabulary. Arctic uses its own native components and
system colours. The reference's sidebar tab layout becomes library navigation
here; articles remain across the top and notes remain on the right. No Search
source or assets are bundled.

Keep frequent keyboard navigation immediate. Apply hover motion to small
backgrounds, not to the document, table, or a whole view hierarchy. Preserve the
bounded reader pool and native reusable library rows when changing this chrome.

### Chrome validation — 24 September 2026

Release Mac build, iOS Simulator regression build, strict Swift formatting, and
code-signature verification passed. Direct computer-use checks on the Mac
confirmed saved-article opening, five top tabs with overflow reveal, keyboard
cycling, close/reopen, sidebar toggling, right-side notes, per-article draft
retention, and shortcut help. The temporary draft was cleared without saving.
The Command-? Help-menu conflict found during these checks was corrected and
rechecked on the packaged Release build.

Screenshots were checked in the Mac's dark appearance. Light appearance and
Reduce Motion use semantic colours and motion guards but were not visually
checked in this pass. XCTest UI startup failed before executing a test with
“Timed out while enabling automation mode” (`/tmp/arctic-chrome-ui.xcresult`).
This pass does not establish a frame-rate or hitch improvement.

## Desktop refinement — 24 September 2026

The 46 pt title row contains the native window controls, sidebar toggle, article
tabs and icon actions. Reader has no permanent bottom toolbar. Selection opens
an AppKit popover with colours and a quote action; existing highlights also offer
an eraser. Native selection and Copy remain intact, while a CSS Highlight paints
only the selected text, avoiding WebKit's full-width selection wash.

[Cursor's article](https://cursor.com/blog/git-at-any-scale) informed the quiet,
narrow text column and restrained heading; [Meta's article](https://research.meta.ai/blog/bringing-your-muse-to-life)
informed the wider media. Arctic uses its own system fonts: 18 px body, 1.6 line
height, a 640 px text measure, and up to 120 px media extension on each side.
The desktop CSS is included before loading cached HTML. Fonts and restored scroll
position settle before the first reveal; network images do not block readiness.

Reading statistics is a workspace page. Its projection warms at launch and stays
in memory; opening the page displays that result while refreshing off the main
actor. The Mac app icon is generated from the existing Arctic iOS artwork.

Validation: Release Mac and iOS Simulator builds, 23 WebView tests, Swift formatting
and JS lint passed. Native computer-use checks covered grid card activation,
sidebar shortcuts, the stats page, bounded text selection and the contextual
popover. Light-mode geometry has browser coverage; the native visual check used
dark mode. Frame-rate and end-to-end tab-switch latency were not measured. The
previous Mac XCTest host signing mismatch remains a separate test-runner issue.

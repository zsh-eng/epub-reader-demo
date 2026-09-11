# Expo Reader handover

Work started 11 September 2026. Branch: `codex/expo-reader`.

Installed on **iPhone 17 / iOS 26.3.1**, with three books from your EPUB folder:
Pride and Prejudice, The Time Machine, and Crime and Punishment. Open **Reader**
in Simulator. This is a release build; no development server is required.
The native presentation pass below replaces the original web Reader controls.
Its manual Simulator checks remain open because computer use reports a locked Mac.

## What changed

- Added an iOS Expo SDK 55 app in `apps/mobile`, compatible with Xcode 26.3.
- Added native system tabs, navigation headers, Library/Highlights search bars,
  the document picker, and a native Settings screen.
- Kept the book grid, book rendering, Highlights, and reading history in WebViews.
- Bundled the full web build, including fonts, worker scripts, and WebAssembly.
  A small Swift Expo module serves it on device loopback at port 18765. The
  release app does not need Metro, Vite, a Mac connection, or internet access.
- Kept domain data in WebView IndexedDB. This is a separate library from Safari
  or the PWA. No sync/storage migration is needed for this version.
- Native import stages EPUBs in private Application Support storage. The web importer
  fetches the bytes locally and uses the existing import transaction. Staging is
  removed only after acknowledgement; an interrupted import can retry on launch.
- Native app/screen lifecycle events flush checkpoints and note drafts and pause
  reading-time accounting. Reading themes also color the native safe areas.
- Native preferences use iOS UserDefaults. The Files picker shows your EPUBs,
  not internal settings or temporary import files.
- Account access and network sync are disabled in the mobile build. The website
  keeps its existing behavior.

## Native presentation decisions

- UIKit owns Reader toolbars, menus, Contents/search, appearance controls, and
  notebook sheets. System toolbars use the iOS 26 Liquid Glass treatment. The
  book page and note rows keep the existing readable theme surfaces.
- The notebook has a content-sized compact detent and a large detent. The compact
  sheet leaves the book interactive. One native text view stays at the bottom;
  notes expand above it. The keyboard layout guide positions the composer, and
  its side margins reduce while typing. Large text and multiline drafts increase
  the compact height. There is no custom sheet-drag animation.
- Notes retain compose/edit drafts, quote targets, save, delete/Undo, ordering by
  time or book, and navigation to resolved pages. Native swipe actions and context
  menus provide edit/delete. Failed Undo retains the action for another attempt.
- A versioned command bridge reuses the existing domain operations. Each Reader
  lifetime has an ID; ordered acknowledgements prevent old messages from replacing
  newer input. The book viewport stays fixed during native sheet/keyboard movement.
- CSS remains the palette source. Native navigation and Settings use its colors;
  a native cache supplies the next launch's initial colors. Warm WebViews refresh
  preferences on activation. New mobile installs default to Flexoki Light;
  existing choices remain intact. No new palette or sync dependency was added.
- Text selection and its highlight/quote actions remain in the WebView. Book
  status and removal use a native menu, with native confirmation before removal.

The implementation uses the existing local Expo module; it adds no native package.
See [native sheets](https://developer.apple.com/design/human-interface-guidelines/sheets),
[keyboard tracking](https://developer.apple.com/documentation/uikit/uiview/keyboardlayoutguide),
and [Liquid Glass materials](https://developer.apple.com/design/human-interface-guidelines/materials).

## Build and run

```sh
bun install
bun run mobile:ios:release
```

The command builds web assets first, then compiles and installs the iOS app.
Use `bun run mobile:ios` for a development build with Metro. After native web
source changes, rebuild the bundled web assets and the app; Metro alone only
updates the native shell. Generated Xcode files and web assets are ignored.

This uses a custom Expo binary because it includes the local Swift server.
WebView itself is included in Expo Go, but Expo Go cannot load our Swift module.
TestFlight is not needed for Simulator builds. A physical iPhone build needs
Apple signing; TestFlight is one distribution option, not a native-library requirement.
See [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/).

Simulator ID: `00467167-67A0-4C89-8C70-C91576052A9E`.
App ID: `app.zsheng.reader.mobile`.

Xcode initially had only the iOS 18.1 Simulator runtime. Its iOS platform support
was missing despite the SDK appearing in `xcodebuild -showsdks`. Installed the
iOS 26.2 runtime, then Xcode's iOS platform-support package with iOS 26.3.1.
The second step made the Simulator destinations available to `xcodebuild`.

## Verification

- Website build and mobile TypeScript check passed.
- Lint passed.
- Full client suite: 566 tests passed.
- Seven mobile browser regressions passed. They cover committed import,
  duplicates, malformed files, origin rejection, native search/navigation,
  checkpoint and draft restoration, highlight save/reopen/search, native note
  create/edit/delete/Undo, command ordering and validation, stable page geometry,
  and theme refresh in a warm Library. Run `bun run test:e2e:mobile`.
- iOS release builds pass and install on the existing Simulator. The **first pass**
  verified native tabs, Files picker, multi-file import,
  native Library search, book covers/images, page turns, notes, Settings, and theme
  changes in Simulator. The new UIKit notebook/toolbar interaction is not yet
  manually verified. The largest test EPUB was 24.8 MB.
- The first pass's cold launch with Metro and Vite stopped retained all three books,
  page 7 of Pride and Prejudice, an unsent draft, and the keep-awake preference.
  The notebook also contains one saved test note.
- The installed Swift server binds only to `127.0.0.1:18765`: HTML returned 200,
  disabled API routes returned 503, and path traversal returned 400.
- Expo Doctor: 19/20 checks passed. It flags the website's React 19.2.5 beside
  native React 19.2.0. `metro.config.js` confines the native bundle to 19.2.0;
  the exported source map contains one React copy and one navigation context.

The browser tests use the existing EPUB fixture and Reader helpers. They do not
claim to test UIKit or WKWebView; the Simulator checks are separate.

Two client tests timed out during a run that overlapped an iOS build. Both passed
on unchanged commit `16b1c73` and on this branch in isolation. A subsequent serial
full run passed all 566 tests without changes to retries or timeouts.
The final release cold-launches and remains running. Simulator WebP initialization
messages also occur in logs from 00:52–01:07, before this presentation pass; they
are not evidence of a new regression. Cover appearance still belongs in visual QA.

## Review order

1. `src/features/reader/native/NativeReaderBridge.tsx` and `commands.ts` — domain
   ownership, command validation, acknowledgements, and saved drafts.
2. `apps/mobile/modules/reader-runtime/ios/ReaderNotebookController.swift` — detents,
   keyboard, native input, and note actions; then `ReaderControlsView.swift` and
   `ReaderToolsController.swift` for the toolbars and other sheets.
3. `apps/mobile/src/NativeTheme.tsx`, `src/features/native/appearance.ts`, and
   `src/hooks/use-reader-settings.ts` — shared colors and warm-tab refresh.
4. `test/e2e/mobile.spec.ts` — bridge/persistence/theme regression checks.

For the original Expo foundation:

1. `apps/mobile/modules/reader-runtime/ios/ReaderWebServer.swift` — offline origin
   and file-access boundary; `ReaderRuntimeModule.swift` — staged imports.
2. `apps/mobile/src/RuntimeProvider.tsx` and `WebScreen.tsx` — app lifetime,
   import acknowledgement, navigation, and lifecycle messages.
3. `src/features/native/` — web-side bridge, native navigation adapter, and
   lifecycle subscription. Then review their small call-site changes.
4. `apps/mobile/app/` — native tabs, search, Settings, and Reader presentation.
5. `vite.mobile.config.ts`, `playwright.mobile.config.ts`, and
   `test/e2e/mobile.spec.ts` — packaging and regression checks.

## Boundaries

- This implementation targets iOS. Android is not configured or tested.
- **Current blocker:** computer use cannot operate Simulator while the Mac is
  locked. Unlock it for the native compact/large detent, keyboard appearance and
  dismissal, long-draft, text-size, swipe/context-menu, and theme visual checks.
  Native compilation and browser checks are complete; they do not prove these
  UIKit interactions. Physical iPhone checks are also still needed.
- Physical-device memory, touch selection, and background behavior still need
  an iPhone check. Simulator taps and keyboard scrolling were verified; the
  available automation did not produce reliable swipe/long-press gestures.
- **Existing Reader issue:** Chapter I in this Pride and Prejudice EPUB's Contents
  jumps to the beginning of its spine file. Reproduced on unchanged website commit
  `4bc5c22`; not caused or fixed by the Expo shell. Page turns still work.
- **Additional test limit:** Playwright WebKit 26.4 failed during app import with
  `Error preparing Blob/File data to be stored in object store`. Standalone Blob
  and File storage probes passed, so the cause is not confirmed. Persistent test
  profiles did not fix it. The installed iOS WKWebView imported and retained the
  real books successfully. The committed browser suite uses Chromium.
- Google sign-in needs a system-browser/native callback flow and session handoff
  before it can be enabled. Do not redirect Google OAuth inside the WebView.
- Removing the app removes its local library. Keep the original EPUB files.
- No user EPUBs are committed or uploaded.

## Commits

- `fdcd75c` — offline Expo shell, native navigation/search, import, lifecycle.
- `c430e3b` — bridge, import, and durable-reopen regression tests.
- `e744167` — native packaging, React resolution, layout, private staging/preferences.
- `16b1c73` — highlight regression and initial Simulator handover.
- `0fa742d` — native Reader toolbars, notebook and tool sheets, shared appearance.
- `e3734aa` — notebook ordering/context menus, recoverable Undo, accessible input
  sizing, and the warm-tab theme regression.

Local investigation logs are in `/private/tmp/reader-*.log`, including
`reader-expo-ios-verified-build.log`, `reader-contents-baseline.log`, and
`reader-webkit-file-probe.log`. Local screenshots are in `diagnostics/expo/`.
Native-pass logs are `/private/tmp/reader-native-{ios-build,web-build,e2e,client-tests}.log`.
No books, screenshots, or build output are committed.

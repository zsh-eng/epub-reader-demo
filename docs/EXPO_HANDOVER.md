# Expo Reader handover

Work started 11 September 2026. Branch: `codex/expo-reader`.

## What changed

- Added an iOS Expo SDK 55 app in `apps/mobile`, compatible with Xcode 26.3.
- Added native system tabs, navigation headers, Library/Highlights search bars,
  the document picker, and a native Settings screen.
- Kept the book grid, Reader, Highlights, and reading history in WebViews.
- Bundled the full web build, including fonts, worker scripts, and WebAssembly.
  A small Swift Expo module serves it on device loopback at port 18765. The
  release app does not need Metro, Vite, a Mac connection, or internet access.
- Kept domain data in WebView IndexedDB. This is a separate library from Safari
  or the PWA. No sync/storage migration is needed for this version.
- Native import stages EPUBs in the app's Documents directory. The web importer
  fetches the bytes locally and uses the existing import transaction. Staging is
  removed only after acknowledgement; an interrupted import can retry on launch.
- Native app/screen lifecycle events flush checkpoints and note drafts and pause
  reading-time accounting. Reading themes also color the native safe areas.
- Account access and network sync are disabled in the mobile build. The website
  keeps its existing behavior.

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
Expo Go cannot load that module. TestFlight is not needed for Simulator builds.

Xcode initially had only the iOS 18.1 Simulator runtime. Its iOS platform support
was missing despite the SDK appearing in `xcodebuild -showsdks`. Installed the
iOS 26.2 runtime, then Xcode's iOS platform-support package with iOS 26.3.1.
The second step made the Simulator destinations available to `xcodebuild`.

## Verification

- Website build and mobile TypeScript check passed.
- Lint passed.
- Full client suite: 566 tests passed.
- `bun run test:e2e:mobile`: 3 browser tests passed. They cover committed import,
  duplicates, malformed files, origin rejection, native search/navigation,
  checkpoint restore, and note-draft save on native background/reopen.
- Native build and Simulator interaction results will be added after testing.

The browser tests use the existing EPUB fixture and Reader helpers. They do not
claim to test UIKit or WKWebView; the Simulator checks are separate.

## Review order

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
- Physical-device memory, touch selection, and background behavior still need
  an iPhone check. Simulator evidence is recorded separately below.
- Google sign-in needs a system-browser/native callback flow and session handoff
  before it can be enabled. Do not redirect Google OAuth inside the WebView.
- Removing the app removes its local library. Keep the original EPUB files.
- No user EPUBs are committed or uploaded.

## Commits

- `fdcd75c` — offline Expo shell, native navigation/search, import, lifecycle.

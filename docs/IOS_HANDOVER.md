# Swift Reader handover

12 September 2026 · branch `codex/expo-reader`.

## Decisions and implementation

- Replaced Expo/React Native with a regular Xcode app in `apps/ios`. The native
  target uses Swift, UIKit, WebKit, and Network, with no third-party native
  dependencies. Bun still builds the shared web assets and invokes Xcode.
- Kept EPUB rendering, pagination, selection, Library, Highlights, Activity,
  and domain storage in the existing web app. Swift owns navigation, search,
  file import, app/scene lifecycle, settings, and Reader controls.
- Kept `app.zsheng.reader.mobile`, `http://127.0.0.1:18765`, and WebKit's default
  persistent data store. The installed app was upgraded in place.
- Native sheets own detents and keyboard behavior. Their content uses Reader's
  CSS colors, DM Sans / EB Garamond, inset note cards, and Type / Layout / Theme
  controls. Theme previews also get their colors from CSS. Plain themed buttons
  replace the glass Reader toolbars; system file pickers and context menus keep
  their standard iOS presentation.
- The notebook has a compact input detent and a large notes detent. One native
  input stays mounted. Focusing expands the sheet; its composer follows the
  keyboard and widens. Compact mode leaves the book interactive. Native note
  actions use the existing ordered, acknowledged web commands and local drafts.
- Native startup coalesces repeated scene activation. Invalid imports have
  Retry and Skip actions; skipping removes only the staged copy. Account access,
  sync, and native database migration remain deferred.
- External book/file opens wait for the current Reader's draft-write
  acknowledgement before releasing its WebView. A failed save keeps that Reader
  available. Ordinary Back already flushes through the web domain.

## Verification

- Website build and lint pass. Full client suite: **566 tests passed**.
- **7 mobile browser tests passed** with the direct WebKit message handler.
  Coverage includes import/errors, origin rejection, search/navigation, theme
  propagation, checkpoints/drafts, highlights, note CRUD/Undo, command ordering,
  and stable page geometry. These tests do not execute UIKit.
- Xcode simulator builds pass. The documented Bun release command builds the
  bundled web resources and the native app, then installs over the current app.
- Before/after IndexedDB record hashes matched for all **3 books, 6 files,
  1 highlight, 3 notes, 1 draft, and 3 checkpoints** at the migration boundary.
- Simulator checks: book reopen at the same page, page turns, compact/large
  notebook, software keyboard, save/edit with a separate compose draft,
  delete/Undo, note-to-page navigation, draft restoration after relaunch, native
  theme cards and warm Library theme refresh, Files picker, duplicate import,
  a mixed valid/invalid import batch, Library search, new-book Start reading,
  and portrait/landscape safe areas and page turns. The staged import queue is
  empty after acknowledgement.
- A native deep link switched from The Time Machine to Alice and back while an
  unsent draft was present; the draft was retained. A focused browser assertion
  also confirms the close acknowledgement follows the committed draft write.
- Fixed a first-layout defect found during relaunch testing: a restored draft
  must be measured from available width before the nested text view has bounds.
  The compact height excludes the bottom safe area, which UIKit adds itself.

The simulator library contains the original three books plus the Alice fixture,
with a saved Swift notebook test note and an unsent test draft in The Time Machine.

## Run and review

```sh
bun run mobile:ios:release --device 00467167-67A0-4C89-8C70-C91576052A9E
```

No Metro, Vite server, TestFlight, or network connection is needed to run the
installed app. See [build instructions](../apps/ios/README.md) for Xcode/device use.

Suggested review order:

1. `apps/ios/Reader/ReaderWebViewController.swift`, `ReaderAppController.swift`,
   and `SceneDelegate.swift`: direct bridge, navigation, storage identity, lifecycle.
2. `ReaderNotebookController.swift`, `ReaderNoteCell.swift`, `ReaderSheetHeader.swift`,
   `ReaderToolsController.swift`, and `ReaderThemeCell.swift`: native sheet content.
3. `src/features/native/runtime.ts`, `src/features/reader/native/NativeReaderBridge.tsx`,
   and `test/e2e/mobile.spec.ts`: the shared web contract and regression checks.
4. `scripts/ios.ts`, `apps/ios/Reader.xcodeproj`, and `vite.mobile.config.ts`: packaging.

Implementation checkpoints: `b0b9860` (Swift host), `58bcdfc` (themed native
content), and `a00d8f5` (draft writes during external navigation).

## Remaining checks

No implementation blocker remains. Physical iPhone signing/distribution, iPad
layout, VoiceOver/Dynamic Type extremes, and extended gesture/memory testing need
device validation. Simulator accessibility actions verified detent changes;
finger-drag feel still needs a physical-device pass. Android is not implemented.
These checks are separate from account/sync work.

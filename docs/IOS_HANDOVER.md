# Swift Reader handover

12 September 2026 · branch `codex/expo-reader`.

## 13 September: UX audit and frame-rate gate

**Implementation is paused at the user's 120 Hz requirement.** This pass tested
the installed Release app in the iPhone 17 simulator and inspected the Swift/web
boundary. No app code was changed. The earlier checks below establish functional
coverage; they do not establish that the native UX is acceptable.

### Frame rate

- No supported WKWebView switch was found for 120 Hz JavaScript rendering.
  [WebKit issue 294338](https://bugs.webkit.org/show_bug.cgi?id=294338) is still
  NEW, last updated 12 August 2026. Its reports distinguish Safari's experimental
  flag from embedded WKWebView. Recent comments report success through private
  preferences; this is not a supported public API.
- The installed iOS SDK's public WebKit headers expose no matching preference.
  Apple's [ProMotion plist option](https://developer.apple.com/documentation/bundleresources/information-property-list/cadisableminimumframedurationonphone)
  is also absent from this app. It permits higher native frame rates but does not
  by itself remove the reported WKWebView JavaScript cap. Native animations and
  accelerated web animations must be measured separately from `requestAnimationFrame`.
- A connected iPhone 15 Pro Max has Reader installed, but Safari remote inspection
  remained at “Connecting…”. No physical-device frame-rate measurement was made.
  Simulator video does not establish the phone's display rate. No private API or
  device setting was changed. A private experiment would also need to account
  for Apple's [public-API requirement, 2.5.1](https://developer.apple.com/app-store/review/guidelines/#software-requirements).

### Findings and proposed corrections

| Area | Evidence | Correction if native work resumes |
| --- | --- | --- |
| Chrome flicker | Reproduced twice on video: header jumps down and footer jumps up over book text before fading. `ReaderControlsView` sets frames on transformed views and starts an animation for every state snapshot, including unchanged visibility. These are candidate causes, not yet isolated by a patch. | Keep layout independent of transforms; animate only when the target visibility changes. Test interrupted and repeated toggles. |
| Scrubber | Source confirms that preview changes only native labels. Navigation crosses the bridge only when dragging/deceleration ends. | Send coalesced live previews through the existing web `previewPage` action; flush `commitPage` when the gesture ends. Do not queue a full jump/write for every tick. |
| Contents | Selecting Chapter I moved Alice from page 2 to 7 and dismissed the sheet. Source configures a custom 520 pt detent plus large. | Use `.medium()` only; keep the sheet, filter, and scroll position when selecting a chapter. |
| Titles/fonts | Contents visibly differs from the small tracked web captions. `readerCaption("")` supplies an empty attributed string; the title is later assigned with plain `.text`, without setting the label's font. DM Sans font files and PostScript names match. | Keep font/tracking when text changes, then compare actual rendered sizes and weights with the web panels. The bundle is not a complete match for all web font weights. |
| Compact notes | Reproduced with and without the software keyboard: a grabber and padded outer sheet surround the input. Composer radius is fixed at 32 pt for a minimum 44 pt height. | Compact mode should show the input alone. Remove its outer sheet/padding and derive curvature from the input height; preserve the same text view through expansion. |
| Dark sheets | No full light flash reproduced during recorded Type/Layout switching and dismissal. All settings changes rebuild the panel's child views; sheet content also disappeared before dismissal finished. | Keep this issue open. Capture the failing device sequence before assigning a cause; investigate rebuilds, button configuration transitions, and trait changes. |
| Loading | One warm reopen of local Alice took **1.74 s** from the first loading frame to the first visible book text (video timestamps 14.887–16.627 s). `openReader` creates a new WKWebView and `closeReader` releases it. | Profile startup, fonts, data readiness, pagination, and first paint separately. Reuse the web runtime/navigation so existing memory caches remain useful; preserve the origin and persistent store. |

[Chrome transition frames](images/ios-chrome-transition.png) show the before,
incorrect intermediate position, and later fade. Temporary recordings are
`/tmp/reader-ux-baseline.mp4` and `/tmp/reader-warm-reopen.mp4`; their timestamps
measure visible transitions, not frame-rate capability.

Alice was returned to page 2 and Flexoki Light, then reopened successfully. No
note text was entered or changed. Existing Xcode signing/project edits remain
untouched. No build or automated suite was run for this documentation-only pass.
Review this audit first, then the linked transition image. App fixes and a
physical-device gesture/performance pass remain open.

## Decisions and changes

- Removed the remaining Expo workspace, generated files, ignore rule, and obsolete
  handover. `apps/ios` is a regular Swift/UIKit/WebKit app. It has no Expo,
  React Native, CocoaPods, or Swift package dependency.
- Used the web app as the visual specification: the original CSS colors, DM Sans,
  reader fonts, Lucide icons, pill search, numbered navigation, circular resume
  card, bookmark ribbon, page ruler, inset note cards, and Type/Layout/Theme
  layouts. Library, Highlights, and Sessions retain their web content.
- Kept native controls custom styled. UIKit supplies keyboard/text editing,
  scrolling, context menus, file pickers, and the outer presentation of tool
  sheets. Reader toolbars do not use Liquid Glass.
- Replaced the modal notebook with an embedded panel. It has input-only, half,
  and full positions. One native text view stays mounted and follows the system
  keyboard guide; focusing the compact input does not expand the notes. The input
  widens while typing. Opening the notebook hides the page footer. The book's
  WebView stays the same size throughout.
- The ruler uses native horizontal scrolling, momentum, interruption, and edge
  bounce. Native previews update the footer; only the settled page crosses the
  bridge. Slow movement gets light page feedback; fast movement gets chapter/end
  feedback. Settings has a haptic switch. Cancellation restores the source page.
- Notes use native horizontal gesture recognition with a 72 pt action threshold,
  circular edit/delete cues, and spring return. Vertical movement belongs to
  scrolling. Long press has native Copy/Edit/Delete actions. Delete retains Undo.
  Detent changes have accessible actions as an alternative to dragging.
- The ribbon creates/removes a durable bookmark through the existing web domain.
  Ordered commands protect drafts, editing, save, navigation, and app background
  writes. Native text composition is committed before save or focus loss; an
  already submitted value is not sent again when closing after a save.
- Kept the app ID `app.zsheng.reader.mobile`, origin `http://127.0.0.1:18765`,
  persistent WebKit store, local imports, and reading data. No storage migration.
  Account access and sync remain deferred.

## Verification and limits

- Website build and lint pass. Full client suite: **566 tests**.
- Xcode **Release** build passed and was installed over the existing app in the
  iPhone 17 simulator (iOS 26.3). The standalone app launched successfully.
- **8 mobile bridge browser tests** cover imports and errors, search/navigation,
  appearance, reading checkpoints, drafts, highlights, note CRUD/Undo, command
  ordering, and bookmark/page recovery across reopen. The Library resume card
  also receives the saved book. These tests do not execute UIKit.
- A browser reference test captures the original Library, Reader, tools, and
  appearance panels using the local EPUB fixture.
- Simulator checks cover the restored navigation and resume card, native Type /
  Layout / Theme controls, theme propagation, compact/expanded notes, software
  keyboard positioning, edit/save with keyboard retained, delete/Undo, and
  reopening at the saved page. The temporary note from this pass was removed;
  the original notes remain. Pride and Prejudice is at page 273 of 772.
- No implementation blocker remains. **Physical gesture and haptic validation is
  still open.** Automated pointer drags behaved as taps; temporary native logging
  showed no pan-recognizer callback for a handle drag. Detent actions were checked
  through accessibility. No claim is made that finger drag, fling interruption,
  or tactile feedback has been validated. Temporary logging was removed.
- The Mac locked during the final pass. Further interactive simulator checks,
  including the compact Library search while scrolling, could not be completed.
- iPad layouts, accessibility text-size extremes, VoiceOver reading order, and
  physical-device signing/distribution need a device pass. Android is not included.

## Run and review

```sh
bun run mobile:ios:release --device 00467167-67A0-4C89-8C70-C91576052A9E
```

The installed app runs from its bundled assets. It needs no development server,
Metro, TestFlight, or network connection. See [iOS setup](../apps/ios/README.md).

Suggested review order:

1. `ReaderChrome.swift`, `ReaderMenuController.swift`, `ReaderToolsController.swift`,
   and `ReaderThemeCell.swift`: visual identity and controls.
2. `ReaderNotebookSurface.swift`, `ReaderNotebookController.swift`, and
   `ReaderNoteCell.swift`: detents, keyboard, draft ordering, and note actions.
3. `ReaderScrubber.swift` and `ReaderUI.swift`: gesture handling and haptics.
4. `ReaderAppController.swift`, `ReaderLibraryHeader.swift`, and
   `src/features/native/NativeLibraryState.tsx`: Library and resume navigation.
5. `src/features/reader/native/NativeReaderBridge.tsx`, `test/e2e/mobile.spec.ts`,
   and `test/e2e/reader-design-reference.spec.ts`: domain boundary and checks.

Swift files above are in `apps/ios/Reader`. Main checkpoints: `d3b33e7`
(Expo cleanup), `fd861f8` (visual identity and native interactions). A final
checkpoint records the validation fixes and this handover. The unrelated
`ROADMAP.md` edit is left untouched.

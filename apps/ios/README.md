# Reader for iOS

A Swift/UIKit app with WKWebView for the existing web Reader. There are no
React Native, Expo, CocoaPods, or Swift package dependencies in the app target.

From the repository root, use Bun:

```sh
bun run mobile:ios --device <simulator-UUID>
bun run mobile:ios:release --device <simulator-UUID>
bun run mobile:ios --build-only
```

Without `--device`, the script uses the first booted simulator. To use Xcode,
run `bun run build:mobile:web`, then open `apps/ios/Reader.xcodeproj`. Select a
development team in Signing & Capabilities for a physical device or archive.
The project supports iOS 16.4 and later. Simulator builds do not need signing.

The app identity remains `app.zsheng.reader.mobile`. Keep the WebView's default
persistent data store and `http://127.0.0.1:18765` origin: they identify the
existing local library. Install over an earlier build to retain its data.

The web app owns EPUB rendering, selection, local domain writes, and reading
settings. Swift owns screen navigation, file access, presentation, and native
input. Small versioned commands cross the `reader` WebKit message handler;
EPUB bytes are read from the app's private import directory through loopback.
Account access and sync remain out of scope for this build.

Native controls use the web app's CSS palette, Lucide artwork, DM Sans, and
reader font previews (Lora, EB Garamond, Inter, and the system Iowan/Mono fonts).
Licenses are included in `Resources/Fonts`. Run `bun scripts/ios-assets.ts` to
regenerate the checked-in icon assets from the installed Lucide package.

Swift recreates the web header, page ruler, navigation, notes, and settings
content. UIKit supplies text editing, keyboard layout, scrolling, context menus,
and file pickers. The notebook is an embedded panel with compact, half, and full
positions; it does not resize the book's WebView. Only settled ruler changes
cross the bridge. Haptic feedback can be disabled in Settings.

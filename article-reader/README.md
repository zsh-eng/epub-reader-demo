# Articles — Swift tracer bullet

Open `ArticleReader.xcodeproj`, select the **ArticleReader** scheme and an iPhone
simulator, then Run. Requires Xcode 26+ and iOS 17+. For a physical iPhone, select
the same signing team for **ArticleReader** and **ArticleShare**, then register/
enable `group.com.zsheng.ArticleReader` in App Groups for both targets. Both use
`ArticleReader.entitlements`. The simulator build can use ad-hoc signing.

- Copy an HTTP(S) link and enter Articles. Choose **Open** or **Save** in the clipboard banner above Search.
- Wide image cards fade into the adaptive card surface, with title, description,
  favicon and domain below the image. Cards load Open Graph metadata, with standard metadata
  fallbacks. A failed preview does not prevent opening the link.
- Tap an article to open a full reading page. Use the native Back button or swipe from the left edge to return.
- The bottom controls provide Back, Forward, the lightning Reader / Website icon,
  a bookmark toggle to save or unsave, and Aa for Reader appearance. Unsave keeps
  history, tags and cached Reader content; Remove link deletes the record and copy.
- The library follows system light/dark mode. Reader defaults to the system font with
  a bold title, optional subtitle/byline/avatar, and lead image before the body.
  Missing metadata is omitted. Reader uses bundled Defuddle and DOMPurify. Website restores
  the live page without reloading it. Tap the **Aa** icon beside Reader to open
  live Reader appearance controls (five fonts, size, side padding, line spacing,
  and System/White/Paper/Ink/Night palettes). The article remains visible and scrollable.
  Aa also enters Reader mode when opened from the publisher's page.
- Search titles, descriptions and domains. Results use compact rows with matched
  text highlighted; clearing or cancelling restores the library.
- **Saved** is the default inbox. The top folder strip switches between Saved,
  article tags, History, Archive, and Downloaded. Swipe horizontally through these folders. The bottom has only the native search control (iOS 26), with a material search field on older iOS.
- **History** records each URL you view, most recently viewed first, including links
  followed inside articles. Opening does not save a link. Preloading does not add history.
- Long-press a saved article to edit **Tags**, archive, or remove it. Archived links
  retain their tags and history. **Move to Saved** restores them to the inbox.
  Select supports bulk archiving and confirmed deletion.
- Reader controls use native safe-area bars and soft scroll-edge blur on iOS 26;
  older systems use translucent material. Library controls and cards move up together while search results crossfade in 180 ms
  (a 100 ms fade with Reduce Motion). Typing does not trigger this transition.
- The first two non-archived links preload their web pages and extracted Reader
  views. The last opened page is also retained (at most three browser models).
  Preloading makes network requests to publishers or Unwall. Saved articles with a
  stored Reader view do not need a speculative publisher request on the next launch.
- **Downloaded** includes saved articles, including archived articles, whose Defuddle
  Reader view has been written to disk. Open them from this folder to read stored text,
  code and embedded header images without loading the website. Appearance controls
  still work. Inline article media can still require a network connection. Deleting
  a link removes its stored Reader view; archiving keeps it.
- Preview images and favicons share a memory cache and a durable 128 MB disk cache.
  Reader lead images and author portraits use the same cache; images are downsampled
  to at most 1200 pixels. Oldest-used files are evicted when the limit is reached.
- Code blocks with supported language labels receive bundled highlight.js colouring.
  Unknown languages remain plain code. No remote script is loaded.
- The page menu provides Archive article, Reload, Open original and Try Unwall.
  A saved, unarchived article also offers **Archive and close** after you scroll near
  its end. Both archive actions return to the library only after storage succeeds.
- Empty folders center a native paper illustration and folder-specific guidance
  in the available space. Artwork adapts to light/dark mode and hides at constrained
  heights to preserve readable text. There is no looping decorative animation.
- Long-press a card to refresh its preview or remove the link.

This app stores link metadata in an atomic JSON file under Application Support,
with separate HTML files for downloaded Reader views. Download status is committed
only after the HTML write succeeds. Preview images are reused from local storage.
No sync, highlights, accounts, or outgoing share controls. Archive is library
status only. Website cookies use WebKit's persistent store.

## Open from another app

The registered URL is `articles://open?url=<percent-encoded HTTP(S) URL>`.
For example: `articles://open?url=https%3A%2F%2Fstephango.com%2Fsaw`.
A Shortcut can URL-encode its input, append it to this prefix, and Open URLs.
This opens a reading page and records History without saving it to the inbox. Invalid schemes
and non-web targets are ignored. It does not intercept ordinary HTTPS links.
The native Share extension saves links through an App Group inbox; default-browser support needs Apple's
entitlement and must render the original destination by default (our automatic
Unwall routing would need to change). Universal Links require the domain owner's
associated-domain file.

## Two quick entry paths

- **Share → Articles → Save article:** the extension writes the URL to its local
  shared inbox. On app entry, Articles imports queued links into the library,
  skips duplicates, and loads previews. An inbox file is removed only after the
  library write succeeds. No publisher request is needed to save from Share.
- **Copy link → open Articles:** on app activation, detect a probable web URL,
  then read it through the normal iOS paste-permission flow. A small Open/Save/Dismiss
  banner appears and the copied page takes the first preload slot. Open uses that
  prepared browser; Open records History; Save writes to the inbox; Dismiss does neither. Each clipboard
  change is checked once, including across launches. Non-link text is ignored.

Automatic clipboard reading can cause iOS to ask **Allow Paste**. If access is
denied, no page can preload; share the link to Articles instead.
Allow Paste in the prompt is not a permanent grant. For ongoing access, choose
**Settings → Apps → Articles → Paste from Other Apps → Allow**.
The app does not bypass the OS permission or change the clipboard. Preloading
visits the copied URL (and Unwall where configured) before Open is tapped.

## Import Chrome's reading list

1. In Google Takeout, select Chrome and its Reading list data, then export.
2. Unzip the download and put its reading-list HTML file in Files on the iPhone.
3. Tap **Sort → Import Chrome reading list** and select the HTML file.

The importer saves HTTP(S) links and their titles, skips duplicates and ignores
non-web links. Preview metadata loads afterwards, one page at a time. It does not
import read/unread state or change Chrome. A bookmark HTML export also works;
choose only the file whose links you want to add. ZIP and JSON are not accepted.
Availability depends on the Chrome data stored in your Google account.

Sources: [Chrome export help](https://support.google.com/chrome/answer/10248834)
and [Google's Reading List HTML schema](https://developers.google.com/data-portability/schema-reference/chrome).

## Build and checks

The Xcode project is independent of the parent web app. Xcode resolves the pinned
SwiftSoup package. The JavaScript bundle is checked in, so Bun is needed only
when changing the extraction code:

```sh
cd article-reader/Web
bun install --frozen-lockfile
bun run build
```

From the repository root, run `bun test article-reader/Web/reader.test.ts` for
metadata extraction, lead-image deduplication and syntax-highlighting checks.
These use the repository’s Playwright Chromium installation and local fixtures.

From the repository root (replace the simulator name if necessary):

```sh
xcodebuild -project article-reader/ArticleReader.xcodeproj \
  -scheme ArticleReader -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/article-reader-build test CODE_SIGN_IDENTITY=-
xcrun swift-format lint --strict article-reader/Sources/*.swift article-reader/Tests/*.swift article-reader/Shared/*.swift article-reader/ShareExtension/*.swift
```

UI tests use local fixtures and a separate `test-links.json`. They cover preview
metadata, saving and removal across launches, Reader bookmark toggles, end-of-article
and menu archiving, browser history, reader switching,
article-frame extraction, disabled navigation controls, folder swipes, stored Reader
views across an offline restart, page back navigation, search and native-file-picker HTML
import, clipboard suggestions, and Share extension saving. Clipboard UI tests use
app-written simulator fixture text, so cross-app Allow Paste prompts still need a
physical-device check. The import test stages a sample HTML file in Documents in debug builds
only. Screenshots are attached to test
results. These checks do not prove publisher or Unwall availability.

For an opt-in live check, prefix the test command with
`TEST_RUNNER_ARTICLE_READER_LIVE_URL=https://stephango.com/saw` and add
`-only-testing:ArticleReaderUITests/ArticleReaderUITests/testLiveArticle`.
On 2026-09-19, this article passed both directly and through
`https://unwall.app/stephango.com/saw` in the iPhone 17 Pro simulator. Preview and
reader screenshots were inspected. Physical-device and paywalled-publisher
checks remain open.

## Integration boundaries

`Resources/unwall-domains.json` is a static snapshot of domains classified as
`full` in Unwall's public frontend on 2026-09-19. Archive-only entries are omitted.
Source: https://unwall.app/assets/index-DwGCjSB1.js. This is a routing hint, not a
guarantee that every article works. There is no background list refresh or API
dependency. Open original disables automatic routing for the current page.

For Unwall, extraction targets `iframe[title="Article content"]` in its current
DOM. That integration may need an update if Unwall changes its page structure.
Source: https://unwall.app/assets/Reader-C69bK8Zs.js.

Reader HTML is sanitized and displayed in a separate WebView with page JavaScript
disabled and a restrictive content policy. The live page stays intact. No
website receives a native message bridge.

Reading themes reuse the parent app’s `src/index.css` neutral and Flexoki palettes.
The library uses native adaptive colours and follows the system appearance.
The reading layout uses editorial typography and optional source metadata; this version does not port the extension runtime. Dependency licenses are
in `THIRD_PARTY_NOTICES.txt`; bundled font licenses are in `Resources/Fonts`.

## Review order

1. `Sources/ReaderTheme.swift` — palette and native/web typography.
2. `Sources/LibraryCards.swift`, `ArticleReaderApp.swift`, `LibrarySearch.swift`, `ArticleTagsSheet.swift` — cards, empty states, library, search and tags.
3. `Sources/ReaderPage.swift` — pushed reading page and live appearance controls.
4. `Sources/ArticleBrowser.swift` — WebView lifetime, routing and reader switching.
5. `Web/reader.js` and `Resources/reader.css` — extraction and reading presentation.
6. `Sources/ArticleStore.swift` — local persistence, HTML import and preview metadata.
7. `Tests/ArticleReaderUITests.swift` — complete user sequences.

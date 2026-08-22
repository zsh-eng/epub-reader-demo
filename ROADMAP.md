# Reader Roadmap

This document tracks upcoming product, platform, and reader-engine work. It is
meant to be a working roadmap, not a promise that every idea below should ship.

## Current Direction

The near-term mobile strategy should be:

1. Make the current PWA feel better on phones.
2. Extract the sync and storage contracts that a native client would need.
3. Create an Expo app as a native shell around the current web reader.
4. Replace shell screens with native screens gradually.
5. Decide later whether the reader itself remains WebView-based or becomes a
   native reader surface.

Slapping the current PWA into an Expo app is a good first mobile spike because
it proves packaging, auth, routing, safe areas, file import, and store-style
constraints quickly. It should not be treated as the final architecture. The
reader depends heavily on browser APIs, DOM layout, CSS, selection behavior,
IndexedDB, and web workers, so a full native reader is a larger project.

## Should Sync Come Before Mobile?

Build the new sync data model/package before serious native app work, but do
not let it block a small Expo WebView spike.

Recommended sequencing:

1. **Expo shell spike**
   Prove that the existing app can run inside an Expo wrapper, authenticate,
   open the library, open a book, and survive basic app background/foreground
   transitions.

2. **Sync package and platform contracts**
   Extract the reusable sync model, HLC handling, remote adapter, storage
   adapter interfaces, file storage interfaces, and device/session identity
   seams. This should happen before implementing native Library, Highlights,
   Sessions, or Settings screens.

3. **Native shell screens**
   Build native Library, Continue Reading, Highlights, Sessions, Settings, and
   file import around the shared sync/domain layer.

4. **Reader decision**
   Keep the web reader in a WebView if the goal is a reliable mobile app soon.
   Rebuild the reader natively only if the project is ready to spend real time
   on native text layout, EPUB rendering, highlight selection, and pagination.

## Platform Architecture Work

- [ ] Create a shared domain package for book, highlight, note, checkpoint,
      reading session, settings, and sync table types.
- [ ] Extract HLC into a platform-neutral module with injected device ID and
      persistence.
- [ ] Extract the sync engine into a reusable package with storage and remote
      adapters.
- [ ] Define browser storage adapters for Dexie, IndexedDB file storage, and
      browser local persistence.
- [ ] Define native storage adapters for SQLite, file system storage, secure
      storage, and app lifecycle events.
- [ ] Decide whether synced records should remain last-write-wins snapshots or
      become an append-style log with IDs as idempotency keys.
- [ ] Revisit the backend sync model and simplify if the server only needs to
      store full history plus latest materialized state.
- [ ] Migrate file sync into the sync architecture or define it as a clearly
      separate content-addressed transfer system.
- [ ] Add incoming sync handling for highlights, reading progress, and other
      records that can change on another device.
- [ ] Fix repeated unauthorized requests by detecting auth state before firing
      sync and file requests.
- [ ] Revisit EPUB file syncing, especially downloaded file availability across
      devices.

## Mobile App Work

- [ ] Build an Expo shell spike that opens the current PWA in a WebView.
- [ ] Add safe-area-aware top and bottom chrome.
- [ ] Prototype a mobile bottom bar, including a liquid-glass style on platforms
      that support it and a simpler fallback elsewhere.
- [ ] Add native app lifecycle handling for foreground, background, resume, and
      network reconnection.
- [ ] Add native file import for EPUBs.
- [ ] Add share sheet and "open in Reader" flows.
- [ ] Add native local file storage for EPUBs and covers.
- [ ] Add secure auth/session storage.
- [ ] Add background download handling where the OS allows it.
- [ ] Add haptics for page turns, tab changes, and important controls.
- [ ] Add orientation, keep-awake, and brightness controls for reading.
- [ ] Decide which shell screens should become native first:
      Library, Continue Reading, Highlights, Sessions, Settings.
- [ ] Decide whether the reader stays WebView-based or moves toward a native
      implementation.

## Current App Product Work

- [ ] OLED reading theme.
- [ ] Improve the Library page design.
- [ ] Explore searchable list-style Library design.
- [ ] Make Continue Reading order by most recently read.
- [ ] Make the front page and Continue Reading screen sleeker.
- [ ] Improve book search.
- [ ] Add sort order for books, with most recently read first.
- [ ] Consider bringing back auto-start-reading behavior.
- [ ] Improve the add-new-EPUB flow.
- [x] Remove unnecessary "loading library" UI.
- [ ] Standardize the UI font, likely around DM Sans.
- [ ] Rename the project/repository from the prototype name when ready.
- [ ] Optional: add a landing page.

## Reader Experience Work

- [ ] Add a better ebook loading screen.
- [ ] Update the reader loading spinner design.
- [ ] Keep chrome hidden during initial reader load.
- [ ] Fade in the first page on mount if it feels better.
- [ ] Add slide gestures for previous and next page.
- [ ] Add jump-back history, similar to Libby-style navigation.
- [ ] Add anchor highlighting after navigation, resizing, or relayout.
- [ ] Add a search interface for the reader.
- [ ] Highlight search results and allow jumping between matches.
- [ ] Improve the Contents sheet:
      scroll active chapter into view, fix chapter row indexing, and hide search
      until it works well.
- [ ] Add a better desktop reader chrome when there is enough width, including
      contents and font buttons instead of hiding everything under a menu.
- [ ] Improve the highlight selection toolbar, especially on desktop.
- [ ] Make selecting a whole paragraph reliably show the toolbar.
- [ ] Build the note-taking flow.
- [ ] Move notes closer to highlights in the product model.
- [ ] Build an initial highlight browser.
- [ ] Improve the highlight browser design.
- [ ] Consider a masonry layout for highlights.
- [ ] Make Sessions show time spent per book.
- [ ] Ignore very short sessions in session totals.
- [ ] Add a reading stats interface.

## Reader Rendering And Pagination Bugs

- [ ] Investigate horizontal navigation and browser back behavior.
- [ ] Fix horizontal overflow.
- [ ] Fix hanging-indent paragraphs when justification is enabled.
- [ ] Fix cases where switching Publisher Book Styling off and on does not
      update justification or related typography correctly.
- [ ] Fix words breaking halfway through a word. Determine whether the cause is
      EPUB content, CSS, or the pagination engine.
- [ ] Prevent descenders from being clipped at the bottom of the page.
- [ ] Fix spreads not rendering correctly on first open.
- [ ] Fix preferred-slot-index navigation bugs if they recur.
- [ ] Fix image flicker on first load.
- [ ] Fix overflow issues reported by screenshots.
- [ ] Fix citation badge weight inconsistencies.
- [ ] Fix highlight margin issues.
- [ ] Fix block quote rendering and compare against the legacy reader.
- [ ] Fix input text truncation for letters like "j".
- [ ] Fix empty UI positioning.
- [ ] Change internal superscript references back from the pill treatment if the
      old rendering reads better.
- [ ] Add syntax highlighting and better code block rendering where feasible.
- [ ] Respect Publisher Book Styling for fonts and layout where it materially
      improves book beauty, such as heading fonts in specific EPUBs.
- [ ] Investigate useful EPUB roles such as `noteref`.
- [ ] Support drop caps.
- [ ] Improve table rendering.
- [ ] Improve header wrapping balance.
- [ ] Add original EPUB design and spacing where appropriate.
- [ ] Ensure text can visually overflow rather than clipping baselines.
- [ ] Clean up style injection so the reader injects as few styles as possible.
- [ ] Reduce lag when theme or typography changes force pagination reflow.
- [ ] Support navigation while only partial pagination is available.
- [ ] Remove or hide debug timers when they are no longer useful.
- [ ] Make worker loading a singleton if it improves font-loading speed.
- [ ] Extract pagination into a separate library when the API stabilizes.
- [ ] Extract Ctrl+F and highlight logic into the same library if it shares
      enough primitives with pagination.
- [ ] Investigate reader highlight placement bug on indented paragraphs.

## Storage And EPUB Processing Ideas

- [ ] Investigate OPFS for book files and extracted EPUB contents.
- [ ] Store normalized HTML strings as files/blobs instead of many small records
      if that improves performance and portability.
- [ ] Compute image maps during EPUB processing.
- [ ] Move EPUB-derived cache work earlier so reader startup reads less from
      blobs at open time.
- [ ] Extract reader data loading behind a cleaner interface.
- [ ] Fix migrations affected by reader processor changes.

## Future Reader Modes

- [ ] Add infinite scrolling mode.
- [ ] Add virtualization for infinite scrolling.
- [ ] Allow switching between paginated and infinite view.
- [ ] Consider a paperback-style reader presentation.
- [ ] Consider a visual relayout indicator for the current anchor text after
      resize or setting changes.

## Design Inspiration

- [ ] Explore the desktop sidebar idea.
- [ ] Explore Kami-inspired interface elements.
- [ ] Explore beautiful sheets round 2.
- [ ] Explore a "scanning in the book" loading animation.
- [ ] Explore book cover effects on the Library page.
- [ ] Explore richer book presentation inspired by visible-shelf style layouts.
- [ ] Revisit popover/context-menu interaction polish:
      anchored clone, fast scale, opacity, shadow, viewport constraints, and
      preventing background scroll while open.

## Research Queue

- [ ] React Native and Expo architecture for a WebView-first app.
- [ ] Expo Router and native navigation.
- [ ] Expo file system, document picker, sharing, secure store, notifications,
      background task, haptics, screen orientation, brightness, and safe areas.
- [ ] React Native WebView bridge design for auth, files, deep links, and reader
      commands.
- [ ] RxDB replication patterns.
- [ ] Merkle trees and whether they help sync reconciliation here.
- [ ] Hybrid Logical Clocks implementation details.
- [ ] Loro, Yjs, Automerge, and the major CRDT papers.
- [ ] Service worker lifecycle and PWA update behavior.
- [ ] Background sync limitations for PWAs.
- [ ] EPUB file format.
- [ ] EPUB CFI.
- [ ] Embedded resources and object URL handling.
- [ ] Highlight storage using tree walking and text offsets.
- [ ] Hook testing strategy.
- [ ] Benchmarking strategy for pagination and reader startup.
- [ ] React performance scanning.

## Not In Scope Yet

- Native reader rewrite before the shared sync/storage layer is understood.
- CRDT rewrite before the simpler HLC/log model has been evaluated.
- Full design-system migration unless it directly supports the mobile shell or
  reader workflows.

## 20260816 Next Tasks

20260822
- [x] Fix performance regressions
- [x] Fix missing images on the library page
- [x] Remove the sidebar icon (or make it part of the header) when in mobile (or maybe even desktop mode)
- [x] New "continue reading" screen
- [x] For mobile, sessions, devices screen etc. should have back button, not the 3 dots for the sidebar
- [x] Sessions screen
	- [x] Recent reading state
		- [x] Still not good enough - it should show book cover - something specific to *you* (we can use the mobile same card)
	- [x] At least 5 minutes of reading time, rather than 10 to show on the "recent reading"
	- [x] Reading space?
	- [x] Spacing between months and "year" is ugly
	- [x] Length of the button should not animate (e.g. switching from "month" to "all"). Also switching from All back to month - (let's say) I already selected an earlier month before I switched to the all - it should just be instant, it shouldn't animate from left to right

- [x] Better long press options
- [x] Continue reading
- [x] Fix theme settings sheet

- [ ] Immediately "start reading" after adding a new book in (some kind of card on mobile?)
- [ ] Carousel / horizontal scroll style for the continue reading on mobile (maybe slightly smaller cards)

- [x] New highlights page: 'bento style'
	- [x] Space at the bottom of the page is only important if the last book's section is too short
	- [x] No matching highlights Should not be scrollable
	- [x]  X button should be more discreet and normal for a searchbar - it looks ugly  - and make the highlight circles bigger
	- [x] "Search all highlights" has too much left padding, and the highlight circles should be a bit more left - too little padding on the right side (optically should be aligned based on roudness)
	
	- [x] Where to put the bookcover - alternate, if low number of highlights (cannot tesselate, then we just put the book cover next to the continue reading - this is column 1, book cover columns 2-3 for example). If enough highlights, can put 1-2, 2-3, etc. columns for varied look, usually nested somewhere between the highlights
	- [x] Long quotes can take up 2 columns as well (though we need to think of a nice way to lay it out)
	- [x] Large search bar, when scroll down shrinks a little as it becomes stickied
	- [x] Mobile design
		- [x] On mobile, clicking a highlight opens a sheet with 2 options - copy or open the book to that page
		- [x] Copy should be animated
	- [x] Right click context menu on desktop should do the same
	- [x] Desktop clicking the highlight should copy (and trigger a toast), should not be jumping straight to book
	- [x] Entry animations
	- [x] Word cloud idea

- [ ] Desktop highlight bar is ugly
	- [ ] Buttons shouldn't have any "dead zone" between them
- [ ] Sessions screen: Fix hover bug again where it looks like there are 2 elements because of the user hovering (update AGENTS.md)

Flicker
"Slow network" messing up the loads
Install Emil animations and figure out if something makes sense for the animation

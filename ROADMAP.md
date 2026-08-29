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

## PWA Product Work

The recent Library, Continue Reading, Sessions, Highlights, mobile navigation,
long-press, and reader-settings redesign is the current baseline. The backlog
below contains only work that still has a clear product or reliability reason.

### Next

- [x] Context menu when right click should keep the book card remained in the pressed state (so we know what we are right clicking)
- [x] Add more "continue reading" in the sidebar
- [x] Fix gradient continue reading
- [x] Reference telegram and simplify / unify the sidebar design
- [x] Add an OLED reading theme with dim reading text and theme values that are
      distinct from the current dark theme.
- [x] Fix overscroll in reader
- [x] Swipe to toggle chrome
- [x] Trace debugging UI
- [x] Fix library search bar cannot type text
- [x] Right click menu also hover UI - do this check for all context menus and add to AGENTS.md for this project

- [x] Keeping the images and the book name in the same column on mobile (since one column only)
- [x] Fix gradient, spacing in highlights page
- [x] Clean up highlights page mobile - spacing, background and stickiness, etc.
- [x] Fix measurement for "in this page" pinned sidebar scroll detection for highlights
- [x] Change book row in highlight masonry mobile
- [x] Fix animations when tapping sheet button
- [x] Highlight button circles should be bigger
- [x] Improve library page search bar
- [x] Swipe to change page (carousel style)
- [x] Perf improvements

- [ ] New simplified sync engine
- [ ] New file storage sync
- [ ] Decomp note-taking flow

- [ ] Decomp Sync limits
- [ ] Decomp Sync progress toast
  - [ ] Also handles downloading a new book
- [ ] Decomp Sync merge behaviour (accidentally or purposefully log into another account)

- [ ] Squircle toast
- [ ] Fix gradient in themes, reorder for the dark theme, and fix background (not full colour in the theme sheet)
- [ ] Fix horizontal scroll passthrough

- [ ] Consider tanstack virtual for highlights page? Slight lag for production (sometimes in the thousands of highlights)

- [ ] Stabilize the Sessions redesign: reproduce and fix the overscroll flicker,
      then verify that the hover state does not create a duplicate visual layer.
- [ ] Diagnose slow-network startup flicker across Library and Reader. Keep the
      atomic reveal, and fix the first real blocking boundary that the evidence
      identifies.
- [ ] Improve the EPUB import handoff. After a successful import, offer a clear
      mobile-friendly path to open the new book, while preserving multi-file,
      duplicate, and failure outcomes.
- [ ] Decide the mobile Continue Reading entry point. Wire the existing
      `ContinueReadingCarousel` only if it is the chosen surface; otherwise
      remove the unused component and keep the current card design.
- [ ] Fix long press
- [ ] "Jump back" ideas for reference (need to start storing jump history though)
- [ ] History tab for total time read

- [ ] Handle sync states
- [ ] Proper animations for "downloading" and "processing" of book - popup from below on mobile, when done tap to open

### Later

- [ ] Choose the product name and rename the project/repository from the
      prototype name.

## Reader Experience Work

### Next

- [ ] Ship reader search end to end. Connect the existing local text index to
      the Reader tools, show match context, highlight matches, and support
      moving between results without losing the reading anchor.
- [ ] Finish the note-taking flow. Wire the existing note composer to create,
      edit, and delete notes attached to highlights.
- [ ] Make whole-paragraph selection reliably open the highlight toolbar on
      desktop and touch devices.

### Later

- [ ] Add direct swipe navigation for previous and next spreads if the current
      touch tap zones are not sufficient.
- [ ] Add jump-back history for meaningful reader navigation points.
- [ ] Add a visible anchor cue after navigation, resize, or typography reflow
      when users need help finding their place.

## Reader Engine And Reliability

Keep this list evidence-led. Add a task only after a Reader Page Debug Dump or
repeatable device report identifies a real failure.

- [ ] Fix horizontal overflow and baseline clipping in affected EPUBs.
- [ ] Investigate first-open spread and image-flicker regressions.
- [ ] Reduce lag when theme or typography changes trigger pagination reflow.
- [ ] Improve table, code-block, and publisher-specific layout only when a
      reproducible book exposes a gap.
- [ ] Investigate highlight placement on indented paragraphs.
- [ ] Extract pagination or search into a separate library only after the
      relevant APIs stop changing.

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

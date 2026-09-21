import SwiftUI
import UIKit
import UniformTypeIdentifiers

@main
struct ArticleReaderApp: App {
  @State private var store = ArticleStore()
  init() {
    #if DEBUG
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-reset-appearance") {
        for key in [
          "reader-size", "reader-font", "reader-padding", "reader-leading", "reader-palette",
        ] {
          UserDefaults.standard.removeObject(forKey: key)
        }
      }
      if ProcessInfo.processInfo.arguments.contains("-ui-testing"),
        let text = ProcessInfo.processInfo.environment["TEST_CLIPBOARD"]
      {
        UIPasteboard.general.string = text
        UserDefaults.standard.removeObject(forKey: "test-clipboard-change")
      }
    #endif
  }
  var body: some Scene {
    WindowGroup {
      Group {
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-dark-ui") {
          ArticleRootView(store: store).preferredColorScheme(.dark)
        } else {
          ArticleRootView(store: store)
        }
      }
      .font(ReaderTheme.sans(16))
      .transformEnvironment(\.dynamicTypeSize) { value in
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-large-type") {
          value = .accessibility2
        }
      }
      .transformEnvironment(\.articleReduceMotion) { value in
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-reduce-motion") {
          value = true
        }
      }
    }
  }
}

/// Do not read the clipboard or preload pages behind first-run onboarding.
private struct ArticleRootView: View {
  let store: ArticleStore
  @State private var completed: Bool

  private static var completionKey: String {
    TestMode.enabled ? "test-onboarding-completed" : "onboarding-completed"
  }

  init(store: ArticleStore) {
    self.store = store
    if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-reset-onboarding") {
      UserDefaults.standard.removeObject(forKey: Self.completionKey)
    }
    _completed = State(initialValue: UserDefaults.standard.bool(forKey: Self.completionKey))
  }

  private var needsOnboarding: Bool {
    !completed
      && (!TestMode.enabled || ProcessInfo.processInfo.arguments.contains("-test-onboarding"))
  }

  var body: some View {
    if needsOnboarding {
      OnboardingView {
        UserDefaults.standard.set(true, forKey: Self.completionKey)
        completed = true
        store.resumeTagging()
      }
    } else {
      LibraryView(store: store)
    }
  }
}

struct LibraryView: View {
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.colorScheme) private var systemScheme
  @State private var clipboard = ClipboardSuggestion()
  #if DEBUG
    @State private var testSharing = false
  #endif
  @Bindable var store: ArticleStore
  @State private var selected: ArticleBrowser?
  @State private var choosingImport = false
  @State private var showingTaggingSettings = false
  @State private var showingAnnotations = false
  @State private var passageToOpen: ReaderAnnotation?
  @State private var showingOnboarding = false
  @State private var editingTags: SavedArticle?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var query = ""
  @State private var searching = false
  @State private var isLibraryScrolling = false
  @State private var importReport: String?
  @State private var showingImportSummary = false
  @State private var folder = ArticleFolder.saved
  @State private var selecting = false
  @State private var selection: Set<UUID> = []
  @State private var sort = "Newest first"
  @State private var confirmDelete = false
  @State private var browsers = BrowserPool()
  #if DEBUG
    @State private var backgroundBrowserCount = -1
  #endif
  @State private var projection = LibraryProjection()
  @State private var headerHeight: CGFloat = 48
  @State private var libraryViewport: CGRect = .zero
  @State private var searchViewport: CGRect = .zero
  @State private var visibleRows: Set<PreloadRow> = []
  @AppStorage("reader-palette") private var paletteName = "System"
  private let navigationBarHeight: CGFloat = 44

  private var matches: [SavedArticle] { matches(in: folder, query: query) }

  private func matches(in folder: ArticleFolder, query: String = "") -> [SavedArticle] {
    projection.rows(
      articles: store.articles, revision: store.libraryRevision, folder: folder,
      query: query, sort: sort
    ).articles
  }

  private var searchTransition: Animation {
    .timingCurve(0.23, 1, 0.32, 1, duration: reduceMotion ? 0.1 : 0.18)
  }

  var body: some View {
    NavigationStack {
      page
        .padding(.top, searching ? 0 : 8)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationDestination(
          isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } })
        ) {
          if let selected {
            ReaderPage(browser: selected, store: store).id(ObjectIdentifier(selected))
          }
        }
    }
    .overlay(alignment: .top) { navigationControls.accessibilityHidden(showingAnnotations) }
    #if DEBUG
      .overlay(alignment: .top) {
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-share-fixture") {
          Button("Share fixture") { testSharing = true }.accessibilityIdentifier("share-fixture")
        }
      }
      .overlay(alignment: .bottomTrailing) {
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-tagging") {
          HStack {
            Text(store.isTagging ? "tagging" : "idle")
            .accessibilityIdentifier("tagging-test-state")
            Text(String(store.taggingRequestCount)).accessibilityIdentifier("tagging-request-count")
            Text(String(store.preparedTaggingCount)).accessibilityIdentifier(
              "tagging-prepared-count")
            if ProcessInfo.processInfo.arguments.contains("-test-tagging-held") {
              Button("Finish tagging") { store.finishFixtureTagging() }
              .disabled(!store.isFixtureTaggingHeld)
              .accessibilityIdentifier("finish-test-tagging")
            }
          }.font(.caption2).padding(4).background(.thinMaterial)
        }
      }
      .overlay(alignment: .bottomLeading) {
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-preloading") {
          VStack(alignment: .leading) {
            Text(preloadURLs.map(\.lastPathComponent).joined(separator: ","))
            .accessibilityIdentifier("preload-requested")
            Text(browsers.readyReaderURLs.map(\.lastPathComponent).joined(separator: ","))
            .accessibilityIdentifier("preload-ready")
            if ProcessInfo.processInfo.arguments.contains("-hold-publisher-image") {
              Text(String(PublisherLoadProbe.shared.started))
              .accessibilityIdentifier("publisher-loads-started")
              // WebKit can retire a handler without a final stop callback.
              // Poll weak owners, rather than treating missing callbacks as leaks.
              TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                Text(String(PublisherLoadProbe.shared.active))
                .accessibilityIdentifier("publisher-loads-active")
              }
            }
            Text(String(backgroundBrowserCount))
            .accessibilityIdentifier("background-browser-count")
            Text(browsers.lastOpenState)
            .accessibilityIdentifier("reader-open-state")
          }.font(.system(size: 8)).lineLimit(1).padding(4).background(.thinMaterial)
          .allowsHitTesting(false)
        }
      }
      .sheet(isPresented: $testSharing) {
        FixtureShareSheet {
          testSharing = false
          store.importSharedLinks()
        }
      }
    #endif
    .background(ReaderTheme.background)
    .foregroundStyle(ReaderTheme.foreground).tint(ArcticBrand.accent)
    .onOpenURL { url in
      guard url.scheme == "articles", url.host == "open",
        let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(
          where: { $0.name == "url" })?.value,
        let target = URL(string: value),
        ["https", "http"].contains(target.scheme?.lowercased() ?? ""),
        let host = target.host, host.contains(".")
      else { return }
      selected = browsers.open(target, store: store)
    }
    .task(id: scenePhase) {
      guard scenePhase == .active else {
        store.flushPendingWrites()
        if scenePhase == .background {
          // Keep the last opened Reader, but stop speculative documents while
          // the app is hidden. Transient inactive states keep the warm viewport.
          browsers.releaseOffscreen()
          #if DEBUG
            backgroundBrowserCount = browsers.retainedBrowserCount
          #endif
        }
        return
      }
      store.importSharedLinks()
      store.resumeTagging()
      await clipboard.check()
    }
    .onChange(of: store.allTags) { _, tags in
      if case .tag(let name) = folder, !tags.contains(name) { folder = .saved }
    }
    .task(id: clipboard.url) {
      await clipboard.preparePreview()
      guard !Task.isCancelled, let url = clipboard.url, let preview = clipboard.preview else {
        return
      }
      store.prepareTagging(url: url, preview: preview)
    }
    .task(id: preloadURLs) {
      store.prioritizePreviews(preloadURLs)
      await browsers.preload(preloadURLs, store: store)
    }
    .onReceive(
      NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)
    ) { _ in
      browsers.releaseOffscreen()
      ThumbnailCache.shared.releaseMemory()
    }
    .onChange(of: store.articles.filter(\.saved).map(\.id)) { _, _ in
      browsers.persistExtractions(in: store)
    }
    .overlay(alignment: .top) {
      if let notice = store.taggingNotice {
        TaggingFeedback(title: notice.title, tags: notice.tags) {
          editingTags = store.articles.first { $0.id == notice.articleID && $0.saved }
          store.dismissTaggingNotice()
        } dismiss: {
          store.dismissTaggingNotice()
        }
        .id(notice.id).padding(.horizontal, 16).padding(.top, 60)
        .transition(.opacity)
      }
    }
    .sheet(
      isPresented: $showingAnnotations,
      onDismiss: {
        guard let passage = passageToOpen else { return }
        passageToOpen = nil
        let browser = browsers.open(passage.articleURL, store: store)
        browser.revealAnnotation(passage.id)
        selected = browser
      }
    ) {
      LibraryAnnotations(articles: store.articles) { passage in
        passageToOpen = passage
        showingAnnotations = false
      }
    }
    .sheet(isPresented: $showingTaggingSettings) {
      TaggingSettingsView { store.resumeTagging() }
    }
    .fullScreenCover(isPresented: $showingOnboarding) {
      OnboardingView {
        showingOnboarding = false
        store.resumeTagging()
      }
    }
    .sheet(item: $editingTags) { article in
      ArticleTagsSheet(article: article, store: store)
    }
    .fileImporter(isPresented: $choosingImport, allowedContentTypes: [.html]) { result in
      Task {
        do {
          let report = try await store.importReadingList(from: result.get())
          if store.importSummary != nil {
            showingImportSummary = true
          } else {
            importReport = report
          }
        } catch {
          store.errorMessage = error.localizedDescription
        }
      }
    }
    .sheet(isPresented: $showingImportSummary) {
      ImportSummarySheet(store: store)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
    .alert(
      "Reading list imported",
      isPresented: Binding(
        get: { importReport != nil }, set: { if !$0 { importReport = nil } }
      )
    ) {
      Button("Done") { importReport = nil }
    } message: {
      Text(importReport ?? "")
    }
    .alert(
      "Storage error",
      isPresented: Binding(
        get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } }
      )
    ) {
      Button("OK") { store.errorMessage = nil }
    } message: {
      Text(store.errorMessage ?? "")
    }
  }

  /// Preload the rows the user can see, then their nearest two neighbors. Lazy
  /// stack appearance is not visibility: it includes rows outside the viewport.
  private var preloadURLs: [URL] {
    #if DEBUG
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-disable-preloading") {
        return []
      }
    #endif
    guard scenePhase == .active, selected == nil, !showingOnboarding,
      !showingTaggingSettings, !showingAnnotations, !choosingImport, editingTags == nil
    else { return [] }
    let rows = projection.rows(
      articles: store.articles, revision: store.libraryRevision, folder: folder,
      query: searching ? query : "", sort: sort)
    let articles = rows.articles
    let visibleIndices = visibleRows.compactMap { row -> Int? in
      guard row.folder == folder, row.search == searching else { return nil }
      return rows.indices[row.articleID]
    }.sorted()
    var urls = visibleIndices.map { articles[$0].url }
    // The paste suggestion has its own URL and may not exist in the library.
    if let copied = clipboard.url, !searching, !urls.contains(copied) { urls.append(copied) }
    for distance in 1...2 {
      for index in visibleIndices {
        for neighbor in [index - distance, index + distance]
        where articles.indices.contains(neighbor) {
          let url = articles[neighbor].url
          if !urls.contains(url) { urls.append(url) }
        }
      }
    }
    return Array(urls.prefix(10))
  }

  private struct PreloadRow: Hashable {
    let articleID: UUID
    let folder: ArticleFolder
    let search: Bool
  }

  private struct RowVisibility: Equatable {
    let row: PreloadRow
    let visible: Bool
  }

  private func visibility(
    _ geometry: GeometryProxy, article: SavedArticle, in item: ArticleFolder, search: Bool
  ) -> RowVisibility {
    let row = PreloadRow(articleID: article.id, folder: item, search: search)
    let viewport = search ? searchViewport : libraryViewport
    let overlap = geometry.frame(in: .global).intersection(viewport)
    let visible =
      folder == item && searching == search && !viewport.isEmpty
      && !overlap.isNull && overlap.width > 1 && overlap.height > 1
    return RowVisibility(row: row, visible: visible)
  }

  private func recordVisibility(_ value: RowVisibility) {
    if value.visible { visibleRows.insert(value.row) } else { visibleRows.remove(value.row) }
  }

  private var folderItems: [ArticleFolder] {
    [.saved, .downloaded] + store.allTags.map(ArticleFolder.tag) + [.history, .archive]
  }

  /// This bar belongs to the stack, not either sliding page. Only its contents
  /// crossfade; the native push/pop transition remains responsible for the page.
  private var navigationControls: some View {
    let palette = ReadingPalette(rawValue: paletteName) ?? .system
    return ZStack {
      // Remove inactive glass controls from the hierarchy. Native glass can
      // retain accessibility children even when its SwiftUI parent is transparent.
      if selected == nil && !searching {
        libraryControls.transition(.opacity)
      }
      if searching && selected == nil {
        HStack {
          searchSummary
          Spacer()
        }
        .padding(.horizontal, 24)
        .transition(.opacity)
      }
      if let selected {
        ReaderNavigationBar(browser: selected, store: store) { self.selected = nil }
          .foregroundStyle(palette.foreground).tint(palette.foreground)
          .transition(.opacity)
      }
    }
    .frame(height: navigationBarHeight)
    .background {
      if selected == nil { LibraryScrollEdge().padding(.bottom, -16).ignoresSafeArea(edges: .top) }
    }
    .environment(\.colorScheme, selected == nil ? systemScheme : (palette.scheme ?? systemScheme))
    .animation(searchTransition, value: selected != nil)
    .animation(searchTransition, value: searching)
  }

  private var libraryControls: some View {
    HStack {
      Button(selecting ? "Done" : "Select") {
        selecting.toggle()
        selection.removeAll()
      }
      .font(.subheadline.weight(.medium)).padding(.horizontal, 16).frame(height: 44)
      .modifier(LibraryGlass()).accessibilityIdentifier("select-articles")
      .accessibilityHidden(searching)
      Spacer()
      HStack(spacing: 0) {
        Button {
          showingAnnotations = true
        } label: {
          Image(systemName: "highlighter").frame(width: 44, height: 44)
        }
        .accessibilityLabel("Highlights and notes")
        .accessibilityIdentifier("library-annotations")
        Menu {
          Picker("Sort", selection: $sort) {
            ForEach(["Newest first", "Oldest first", "Title"], id: \.self) { Text($0) }
          }
          Divider()
          Button("Import Chrome reading list", systemImage: "square.and.arrow.down") {
            choosingImport = true
          }.accessibilityIdentifier("import-reading-list")
          Divider()
          Button("Automatic tags", systemImage: "sparkles") { showingTaggingSettings = true }
            .accessibilityIdentifier("automatic-tag-settings")
          Button("Tag existing articles", systemImage: "tag") { store.retagSavedArticles() }
            .disabled(!TaggingPreferences.enabled)
            .accessibilityIdentifier("tag-existing-articles")
          Button("Getting started", systemImage: "book.closed") { showingOnboarding = true }
            .accessibilityIdentifier("show-onboarding")
        } label: {
          Image(systemName: "line.3.horizontal.decrease").frame(width: 44, height: 44)
        }
        .accessibilityLabel("Sort and filter")
      }
      .modifier(LibraryGlass())
      .accessibilityHidden(searching)
    }
    .overlay {
      HStack(spacing: 6) {
        ArcticMark().frame(width: 22, height: 22)
        Text("Arctic").font(.system(.headline, design: .rounded, weight: .semibold))
      }.allowsHitTesting(false)
    }
    .padding(.horizontal, 16)
  }

  private var folders: some View {
    ScrollViewReader { proxy in
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 2) {
          ForEach(folderItems, id: \.self) { item in
            Button {
              // Content is immediately available; motion only tracks the folder selection.
              withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { folder = item }
            } label: {
              Text(item.title).font(.subheadline.weight(.semibold))
                .foregroundStyle(folder == item ? ReaderTheme.foreground : ReaderTheme.muted)
                .padding(.horizontal, 16).frame(minHeight: 44)
                .background {
                  if folder == item {
                    Capsule().fill(ReaderTheme.foreground.opacity(0.08))
                  }
                }
                .contentShape(Capsule())
            }.buttonStyle(.plain).id(item)
              .accessibilityIdentifier(item.identifier)
              .accessibilityAddTraits(folder == item ? .isSelected : [])
          }
        }.padding(4)
      }
      .clipShape(Capsule())
      .modifier(LibraryGlass())
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .onChange(of: folder) { _, value in
        selection.removeAll()
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) {
          proxy.scrollTo(value, anchor: .center)
        }
      }
    }
  }

  /// Keep both layers mounted and crossfade in place. Search must not translate
  /// the folder strip, article list or navigation controls.
  private var page: some View {
    ZStack(alignment: .top) {
      pagedLibrary
        .opacity(searching ? 0 : 1)
        .allowsHitTesting(!searching).accessibilityHidden(searching)
      ScrollViewReader { proxy in
        ScrollView {
          VStack(spacing: 0) {
            Color.clear.frame(height: 0).id("search-top")
            searchResults
          }
        }
        .onGeometryChange(for: CGRect.self) {
          $0.frame(in: .global)
        } action: {
          searchViewport = $0
        }
        .modifier(LibraryScrollActivity { if searching { isLibraryScrolling = $0 } })
        .onChange(of: query) { _, _ in proxy.scrollTo("search-top", anchor: .top) }
      }
      .opacity(searching ? 1 : 0)
      .allowsHitTesting(searching).accessibilityHidden(!searching)
    }
    .animation(searchTransition, value: searching)
    .scrollDismissesKeyboard(.interactively)
    .safeAreaInset(edge: .bottom, spacing: 0) {
      VStack(spacing: 0) {
        if let summary = store.importSummary, !searching, !selecting {
          HStack(spacing: 10) {
            Button {
              showingImportSummary = true
            } label: {
              HStack(spacing: 10) {
                Image(systemName: store.isImportWorking ? "sparkles" : "checkmark.circle")
                  .foregroundStyle(ArcticBrand.accent)
                Text("\(summary.total) articles added").font(.subheadline.weight(.medium))
                Spacer()
                Image(systemName: "chevron.up").font(.caption.weight(.semibold))
              }.frame(minHeight: 44)
            }.accessibilityIdentifier("import-summary-open")
            Button("Dismiss", systemImage: "xmark") { store.dismissImportSummary() }
              .labelStyle(.iconOnly).frame(width: 36, height: 44)
              .accessibilityIdentifier("import-summary-dismiss")
          }.padding(.horizontal, 16).readerGlass().padding(.horizontal, 20).padding(.bottom, 8)
        }
        if let url = clipboard.url, !searching, !selecting {
          ClipboardBanner(
            url: url, preview: clipboard.preview,
            isSaved: store.articles.contains { $0.url == url && $0.saved }
          ) {
            do {
              try store.add(url.absoluteString, preview: clipboard.preview)
              clipboard.dismiss()
            } catch {
              store.errorMessage = error.localizedDescription
            }
          } open: {
            // Opening dismisses the banner and cancels its task. Finish preparing
            // this explicit pasted link so a later Reader Save reuses the result.
            Task {
              guard let preview = try? await ArticlePreviewCache.shared.load(url) else { return }
              store.prepareTagging(url: url, preview: preview)
            }
            selected = browsers.open(url, store: store)
            clipboard.dismiss()
          } dismiss: {
            clipboard.dismiss()
          }
        }
      }
    }
    .modifier(LibrarySearchChrome(query: $query, active: $searching, obscured: showingAnnotations))
    .accessibilityHidden(showingAnnotations)
    .confirmationDialog(
      "Delete \(selection.count) links?", isPresented: $confirmDelete, titleVisibility: .visible
    ) {
      Button("Delete links", role: .destructive) {
        store.update(selection, delete: true)
        selection.removeAll()
      }
    }
  }

  private var pagedLibrary: some View {
    GeometryReader { viewport in
      ZStack(alignment: .top) {
        TabView(selection: $folder) {
          ForEach(folderItems, id: \.self) { item in
            GeometryReader { geometry in
              Group {
                if matches(in: item).isEmpty {
                  LibraryEmptyState(folder: item)
                    .frame(height: max(0, viewport.size.height - headerHeight))
                    .padding(.top, headerHeight)
                } else {
                  ScrollView { library(in: item) }
                    .modifier(
                      LibraryScrollActivity {
                        if folder == item && !searching { isLibraryScrolling = $0 }
                      }
                    )
                    .contentMargins(.top, headerHeight + 8, for: .scrollContent)
                    .contentMargins(.top, headerHeight, for: .scrollIndicators)
                    .contentMargins(
                      .bottom, max(0, geometry.size.height - viewport.size.height),
                      for: .scrollContent)
                }
              }.accessibilityHidden(searching || folder != item)
            }
            .tag(item)
            .accessibilityIdentifier("library-page-" + item.identifier)
          }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .ignoresSafeArea(.container, edges: .bottom)
        libraryHeader.background { LibraryScrollEdge() }
          .onGeometryChange(for: CGFloat.self) {
            $0.size.height
          } action: {
            headerHeight = $0
          }
      }
      .onGeometryChange(for: CGRect.self) { geometry in
        let frame = geometry.frame(in: .global)
        return CGRect(
          x: frame.minX, y: frame.minY + headerHeight,
          width: frame.width, height: max(0, frame.height - headerHeight))
      } action: {
        libraryViewport = $0
      }
    }
  }

  private var libraryHeader: some View {
    VStack(spacing: 0) {
      folders.accessibilityHidden(searching)
      if selecting {
        HStack {
          Text("\(selection.count) selected").font(.caption)
          Spacer()
          Menu {
            Button("Archive") {
              store.update(selection, archived: true)
              selection.removeAll()
            }.accessibilityIdentifier("archive-selected")
            Button("Unarchive") {
              store.update(selection, archived: false)
              selection.removeAll()
            }
          } label: {
            Image(systemName: "archivebox")
          }
          .accessibilityLabel("Archive options")
          .disabled(!store.articles.contains { selection.contains($0.id) && $0.saved })
          Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
            .labelStyle(.iconOnly).disabled(selection.isEmpty)
        }.padding(.horizontal, 16).padding(.vertical, 10)
          .modifier(LibraryGlass()).padding(.horizontal, 16).padding(.bottom, 8)
      }
    }
  }

  private func library(in item: ArticleFolder) -> some View {
    let compact = item == .history || item == .archive
    return LazyVStack(alignment: .leading, spacing: compact ? 0 : 18) {
      ForEach(matches(in: item)) { article in
        articleButton(article) {
          if compact {
            ArticleSearchRow(article: article, query: "")
          } else {
            ArticleCard(article: article)
          }
        }
        .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: compact ? 16 : 24))
        .onGeometryChange(for: RowVisibility.self) {
          visibility($0, article: article, in: item, search: false)
        } action: {
          recordVisibility($0)
        }
        .onDisappear {
          visibleRows.remove(PreloadRow(articleID: article.id, folder: item, search: false))
        }
        if compact {
          Rectangle().fill(ReaderTheme.border).frame(height: 0.5)
            .padding(.leading, 88).padding(.trailing, 16)
        }
      }
    }.padding(.horizontal, compact ? 8 : 16).padding(.bottom, 20)
  }

  private var searchSummary: some View {
    Text(
      query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? "SEARCH \(folder.title.uppercased())"
        : "\(matches.count) \(matches.count == 1 ? "RESULT" : "RESULTS")"
    )
    .font(.footnote.weight(.medium)).foregroundStyle(ReaderTheme.muted)
    .accessibilityIdentifier("search-summary")
  }

  private var searchResults: some View {
    let item = folder
    return LazyVStack(alignment: .leading, spacing: 0) {
      if matches.isEmpty {
        VStack(spacing: 10) {
          Image(systemName: "magnifyingglass").font(.system(size: 26, weight: .light))
            .foregroundStyle(ReaderTheme.muted)
          Text("No articles found").font(.title2.weight(.semibold))
          Text("Try a title, a topic, or a website.")
            .font(ReaderTheme.sans(14)).foregroundStyle(ReaderTheme.muted)
        }.frame(maxWidth: .infinity).padding(.top, 70)
      }
      ForEach(matches) { article in
        articleButton(article) { ArticleSearchRow(article: article, query: query) }
          .onGeometryChange(for: RowVisibility.self) {
            visibility($0, article: article, in: item, search: true)
          } action: {
            recordVisibility($0)
          }
          .onDisappear {
            visibleRows.remove(PreloadRow(articleID: article.id, folder: item, search: true))
          }
        Rectangle().fill(ReaderTheme.border).frame(height: 0.5)
          .padding(.leading, 88).padding(.trailing, 16)
      }
    }.padding(.horizontal, 8).padding(.bottom, 24)
  }

  private func articleButton<Content: View>(
    _ article: SavedArticle, @ViewBuilder content: () -> Content
  ) -> some View {
    Button {
      if selecting {
        if selection.contains(article.id) {
          selection.remove(article.id)
        } else {
          selection.insert(article.id)
        }
      } else {
        selected = browsers.open(article.url, store: store)
      }
    } label: {
      content()
    }
    .buttonStyle(.plain)
    .overlay(alignment: .topTrailing) {
      if selecting {
        Image(systemName: selection.contains(article.id) ? "checkmark.circle.fill" : "circle")
          .font(.title2).padding(8).background(.regularMaterial, in: Circle())
      }
    }
    .accessibilityIdentifier("article-\(article.url.lastPathComponent)")
    .contextMenu {
      if article.saved {
        Button("Tags", systemImage: "tag") { editingTags = article }
        Button(article.isArchived == true ? "Move to Saved" : "Archive", systemImage: "archivebox")
        {
          store.update([article.id], archived: article.isArchived != true)
        }.accessibilityIdentifier("archive-article")
      } else {
        Button("Save to inbox", systemImage: "tray.and.arrow.down") {
          do { try store.add(article.url.absoluteString) } catch {
            store.errorMessage = error.localizedDescription
          }
        }
      }
      Button("Refresh preview", systemImage: "arrow.clockwise") {
        Task { await store.refreshPreview(article) }
      }
      Button("Remove link", systemImage: "trash", role: .destructive) { store.remove(article) }
    }
  }
}

#if DEBUG
  /// Exercises the real Share extension with a local fixture URL in UI tests.
  private struct FixtureShareSheet: UIViewControllerRepresentable {
    var onComplete: () -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
      let controller = UIActivityViewController(
        activityItems: [
          URL(
            string: "https://fixture.example/story"
              + (ProcessInfo.processInfo.arguments.contains("-share-wait-context")
                ? "?wait_for_save" : ""))!
        ],
        applicationActivities: nil)
      // UIKit can finish the activity without updating the SwiftUI sheet binding.
      controller.completionWithItemsHandler = { _, _, _, _ in onComplete() }
      return controller
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
  }
#endif

/// SwiftUI reevaluates the library while rows cross the viewport. Reuse sorted
/// projections and ID indexes until domain data or the filter actually changes.
@MainActor private final class LibraryProjection {
  struct Rows {
    let articles: [SavedArticle]
    let indices: [UUID: Int]
  }
  private struct Key: Hashable {
    let folder: ArticleFolder
    let query: String
  }
  private var revision = -1
  private var sort = ""
  private var savedOrder: [SavedArticle] = []
  private var historyOrder: [SavedArticle] = []
  private var cache: [Key: Rows] = [:]

  func rows(
    articles: [SavedArticle], revision: Int, folder: ArticleFolder, query: String, sort: String
  ) -> Rows {
    if self.revision != revision || self.sort != sort {
      self.revision = revision
      self.sort = sort
      cache.removeAll(keepingCapacity: true)
      if sort == "Title" {
        savedOrder = articles.sorted {
          $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }
        historyOrder = savedOrder
      } else {
        let oldest = sort == "Oldest first"
        savedOrder = articles.sorted {
          let left = $0.savedAt ?? .distantPast
          let right = $1.savedAt ?? .distantPast
          return oldest ? left < right : left > right
        }
        historyOrder = articles.sorted {
          let left = $0.lastVisitedAt ?? .distantPast
          let right = $1.lastVisitedAt ?? .distantPast
          return oldest ? left < right : left > right
        }
      }
    }
    let key = Key(folder: folder, query: query)
    if let rows = cache[key] { return rows }
    let words = query.split(whereSeparator: \.isWhitespace).map(String.init)
    let rows = (folder == .history ? historyOrder : savedOrder).filter { article in
      guard folder.contains(article) else { return false }
      guard !words.isEmpty else { return true }
      let text =
        "\(article.title) \(article.subtitle) \(article.url.absoluteString) \(article.tagNames.joined(separator: " "))"
      return words.allSatisfy { text.localizedStandardContains($0) }
    }
    let result = Rows(
      articles: rows,
      indices: Dictionary(
        uniqueKeysWithValues: rows.enumerated().map { ($0.element.id, $0.offset) }))
    if cache.count >= 24 { cache.removeAll(keepingCapacity: true) }
    cache[key] = result
    return result
  }
}

/// One batch-level result keeps a large import from producing a stream of toasts.
private struct ImportSummarySheet: View {
  let store: ArticleStore
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    NavigationStack {
      if let summary = store.importSummary {
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            ConnectedTagReveal(isProcessing: store.isImportWorking, tags: []) {
              VStack(alignment: .leading, spacing: 8) {
                Text(summary.total, format: .number)
                  .font(.system(size: 56, weight: .semibold, design: .rounded))
                Text("Articles added").font(.title3.weight(.medium))
                HStack(spacing: 6) {
                  Text("\(summary.previewsReady) checked")
                  if summary.tagged > 0 { Text("· \(summary.tagged) tagged") }
                }.font(.subheadline).foregroundStyle(.secondary)
              }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
                .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 24))
            }
            if !summary.tagCounts.isEmpty {
              LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 150), alignment: .leading)], spacing: 10
              ) {
                ForEach(summary.tagCounts.keys.sorted(), id: \.self) { tag in
                  HStack(spacing: 10) {
                    Text(tag).font(.subheadline.weight(.medium))
                    Spacer(minLength: 4)
                    Text(summary.tagCounts[tag]!, format: .number)
                      .font(.system(.subheadline, design: .rounded).weight(.semibold))
                      .foregroundStyle(ArcticBrand.accent)
                      .contentTransition(.numericText())
                  }.padding(14).frame(maxWidth: .infinity, minHeight: 52)
                    .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 16))
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("import-tag-" + tag)
                }
              }
            }
            if summary.duplicates > 0 {
              Text("\(summary.duplicates) already in your library").font(.footnote).foregroundStyle(
                .secondary)
            }
            if summary.previewFailures > 0 {
              Text("\(summary.previewFailures) previews unavailable. Your links are saved.")
                .font(.footnote).foregroundStyle(.secondary)
            }
          }.padding(24)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: summary.tagged)
        }
        .accessibilityIdentifier("import-summary")
        .navigationTitle("Your reading list").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { dismiss() }.accessibilityIdentifier("import-summary-done")
          }
        }
      }
    }
    .tint(ArcticBrand.accent)
  }
}

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
  @State private var clipboard = ClipboardSuggestion()
  #if DEBUG
    @State private var testSharing = false
  #endif
  @Bindable var store: ArticleStore
  @State private var selected: ArticleBrowser?
  @State private var choosingImport = false
  @State private var showingTaggingSettings = false
  @State private var showingOnboarding = false
  @State private var editingTags: SavedArticle?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var query = ""
  @State private var searching = false
  @State private var importReport: String?
  @State private var folder = ArticleFolder.saved
  @State private var selecting = false
  @State private var selection: Set<UUID> = []
  @State private var sort = "Newest first"
  @State private var confirmDelete = false
  @State private var browsers = BrowserPool()
  @State private var headerHeight: CGFloat = 96

  private var matches: [SavedArticle] { matches(in: folder, query: query) }

  private func matches(in folder: ArticleFolder, query: String = "") -> [SavedArticle] {
    let words = query.split(whereSeparator: \.isWhitespace).map(String.init)
    let filtered = store.articles.filter { article in
      let text =
        "\(article.title) \(article.subtitle) \(article.url.absoluteString) \(article.tagNames.joined(separator: " "))"
      return folder.contains(article) && words.allSatisfy { text.localizedStandardContains($0) }
    }
    if sort == "Title" {
      return filtered.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
    let ordered = filtered.sorted {
      let left = folder == .history ? $0.lastVisitedAt : $0.savedAt
      let right = folder == .history ? $1.lastVisitedAt : $1.savedAt
      return (left ?? .distantPast) > (right ?? .distantPast)
    }
    return sort == "Oldest first" ? ordered.reversed() : ordered
  }

  private var searchTransition: Animation {
    .timingCurve(0.23, 1, 0.32, 1, duration: reduceMotion ? 0.1 : 0.18)
  }

  var body: some View {
    NavigationStack {
      page
        .navigationTitle("Articles")
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(
          isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } })
        ) {
          if let selected {
            ReaderPage(browser: selected, store: store).id(ObjectIdentifier(selected))
          }
        }
    }
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
            if ProcessInfo.processInfo.arguments.contains("-test-tagging-held") {
              Button("Finish tagging") { store.finishFixtureTagging() }
              .disabled(!store.isFixtureTaggingHeld)
              .accessibilityIdentifier("finish-test-tagging")
            }
          }.font(.caption2).padding(4).background(.thinMaterial)
        }
      }
      .sheet(isPresented: $testSharing, onDismiss: { store.importSharedLinks() }) {
        FixtureShareSheet()
      }
    #endif
    .background(ReaderTheme.background)
    .foregroundStyle(ReaderTheme.foreground).tint(ReaderTheme.foreground)
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
      guard scenePhase == .active else { return }
      store.importSharedLinks()
      store.resumeTagging()
      await clipboard.check()
    }
    .onChange(of: store.allTags) { _, tags in
      if case .tag(let name) = folder, !tags.contains(name) { folder = .saved }
    }
    .task(id: preloadURLs) { browsers.preload(preloadURLs, store: store) }
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
        do { importReport = try await store.importReadingList(from: result.get()) } catch {
          store.errorMessage = error.localizedDescription
        }
      }
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

  private var preloadURLs: [URL] {
    let copied = clipboard.url.map { [$0] } ?? []
    let saved = store.articles.filter { $0.saved && $0.isArchived != true }.map(\.url)
    return Array((copied + saved.filter { !copied.contains($0) }).prefix(2))
  }

  private var folderItems: [ArticleFolder] {
    [.saved] + store.allTags.map(ArticleFolder.tag) + [.history, .archive, .downloaded]
  }

  private var libraryControls: some View {
    HStack {
      Button(selecting ? "Done" : "Select") {
        selecting.toggle()
        selection.removeAll()
      }
      .font(.subheadline.weight(.medium)).padding(.horizontal, 16).frame(height: 44)
      .readerGlass().accessibilityIdentifier("select-articles")
      .accessibilityHidden(searching)
      Spacer()
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
      .readerGlass().accessibilityLabel("Sort and filter")
      .accessibilityHidden(searching)
    }.overlay { Text("Articles").font(.headline) }
      .padding(.horizontal, 16).padding(.top, 4)
  }

  private var folders: some View {
    ScrollViewReader { proxy in
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 24) {
          ForEach(folderItems, id: \.self) { item in
            Button {
              withAnimation(reduceMotion ? nil : .smooth(duration: 0.25)) { folder = item }
            } label: {
              VStack(spacing: 10) {
                Text(item.title).font(.subheadline.weight(.semibold))
                  .foregroundStyle(folder == item ? ReaderTheme.foreground : ReaderTheme.muted)
                Capsule().fill(folder == item ? ReaderTheme.foreground : .clear).frame(height: 3)
              }.padding(.top, 12)
            }.buttonStyle(.plain).id(item)
              .accessibilityIdentifier(item.identifier)
              .accessibilityAddTraits(folder == item ? .isSelected : [])
          }
        }.padding(.horizontal, 20)
      }
      .onChange(of: folder) { _, value in
        selection.removeAll()
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.25)) {
          proxy.scrollTo(value, anchor: .center)
        }
      }
    }
  }

  /// Keep both layers mounted. A single transition moves the header and inbox
  /// together; native search owns only the bottom control and keyboard.
  private var page: some View {
    ZStack(alignment: .top) {
      pagedLibrary
        .offset(y: searching && !reduceMotion ? -120 : 0)
        .opacity(searching ? 0 : 1)
        .allowsHitTesting(!searching).accessibilityHidden(searching)
      ScrollViewReader { proxy in
        ScrollView {
          VStack(spacing: 0) {
            Color.clear.frame(height: 0).id("search-top")
            searchResults.padding(.top, 18)
          }
        }
        .onChange(of: query) { _, _ in proxy.scrollTo("search-top", anchor: .top) }
      }
      .opacity(searching ? 1 : 0)
      .allowsHitTesting(searching).accessibilityHidden(!searching)
    }
    .animation(searchTransition, value: searching)
    .scrollDismissesKeyboard(.interactively)
    .safeAreaInset(edge: .bottom, spacing: 0) {
      if let url = clipboard.url, !searching, !selecting {
        ClipboardBanner(url: url) {
          selected = browsers.open(url, store: store)
          clipboard.dismiss()
        } save: {
          do {
            try store.add(url.absoluteString)
            clipboard.dismiss()
            query = ""
            searching = false
            folder = .saved
          } catch { store.errorMessage = error.localizedDescription }
        } dismiss: {
          clipboard.dismiss()
        }
      }
    }
    .modifier(LibrarySearchChrome(query: $query, active: $searching))
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
    ZStack(alignment: .top) {
      TabView(selection: $folder) {
        ForEach(folderItems, id: \.self) { item in
          GeometryReader { geometry in
            Group {
              if matches(in: item).isEmpty {
                LibraryEmptyState(folder: item)
                  .frame(height: max(0, geometry.size.height - headerHeight))
                  .padding(.top, headerHeight)
              } else {
                ScrollView { library(in: item) }
                  .contentMargins(.top, headerHeight + 8, for: .scrollContent)
                  .contentMargins(.top, headerHeight, for: .scrollIndicators)
              }
            }.accessibilityHidden(searching || folder != item)
          }
          .tag(item)
          .accessibilityIdentifier("library-page-" + item.identifier)
        }
      }
      .tabViewStyle(.page(indexDisplayMode: .never))
      libraryHeader.background(.regularMaterial)
        .onGeometryChange(for: CGFloat.self) {
          $0.size.height
        } action: {
          headerHeight = $0
        }
    }
  }

  private var libraryHeader: some View {
    VStack(spacing: 0) {
      libraryControls.accessibilityHidden(searching)
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
        }.padding().background(.regularMaterial)
      }
    }
  }

  private func library(in item: ArticleFolder) -> some View {
    LazyVStack(alignment: .leading, spacing: 18) {
      ForEach(matches(in: item)) { article in
        articleButton(article) { ArticleCard(article: article) }
          .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 24))
      }
    }.padding(.horizontal, 16).padding(.bottom, 20)
  }

  private var searchResults: some View {
    LazyVStack(alignment: .leading, spacing: 0) {
      Text(
        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          ? "SEARCH \(folder.title.uppercased())"
          : "\(matches.count) \(matches.count == 1 ? "RESULT" : "RESULTS")"
      )
      .font(.footnote.weight(.medium)).foregroundStyle(ReaderTheme.muted)
      .padding(.horizontal, 16).padding(.bottom, 6)
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
        selected = browsers.open(article.url, store: store, downloaded: folder == .downloaded)
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
    func makeUIViewController(context: Context) -> UIActivityViewController {
      UIActivityViewController(
        activityItems: [URL(string: "https://fixture.example/story")!], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
  }
#endif

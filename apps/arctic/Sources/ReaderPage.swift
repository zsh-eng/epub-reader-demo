import SwiftUI

/// A pushed reading page. The compact controls leave the actual article visible
/// and scrollable while appearance changes are applied without a reload.
struct ReaderPage: View {
  let store: ArticleStore
  @State private var browser: ArticleBrowser
  @Environment(\.colorScheme) private var systemScheme
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var appearance = false
  @State private var readingVisible = false
  @State private var nearEnd = false
  @State private var actionError: String?
  @State private var controlsHeight: CGFloat = 60
  @AppStorage("reader-size") private var fontSize = 20.0
  @AppStorage("reader-font") private var font = "System"
  @AppStorage("reader-padding") private var padding = 18.0
  @AppStorage("reader-leading") private var leading = 1.55
  @AppStorage("reader-palette") private var paletteName = "System"
  private var palette: ReadingPalette { ReadingPalette(rawValue: paletteName) ?? .system }
  private var article: SavedArticle? {
    store.articles.first { $0.url == browser.libraryURL }
      ?? store.articles.first { $0.url == browser.sourceURL }
  }
  private var isSaved: Bool { article?.saved == true }
  private var canArchive: Bool { isSaved && article?.isArchived != true }
  init(browser: ArticleBrowser, store: ArticleStore) {
    _browser = State(initialValue: browser)
    self.store = store
  }

  var body: some View {
    readingPage
      .sheet(item: $browser.annotationPresentation) { presentation in
        ReaderAnnotations(browser: browser, presentation: presentation)
      }
      #if DEBUG
        .overlay(alignment: .topLeading) {
          if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-reading-time") {
            Text(readingContext.eligible ? "Tracking" : "Paused")
            .font(.system(size: 7)).accessibilityIdentifier("reading-time-state")
            .allowsHitTesting(false)
          }
          if TestMode.enabled
            && ProcessInfo.processInfo.arguments.contains("-test-annotation-render")
          {
            Text(browser.annotationRenderState).font(.system(size: 7))
            .accessibilityIdentifier("annotation-render-state").allowsHitTesting(false)
          }
        }
      #endif
      .onAppear {
        updateAppearance()
        browser.refreshAnnotations()
        store.visit(browser.libraryURL)
        browser.readingActivity = { [weak browser] in
          guard let browser else { return }
          ReadingSessions.shared.activity(for: browser.libraryURL)
        }
        browser.readingDocumentEnded = { ReadingSessions.shared.end() }
        readingVisible = true
        updateReadingSession()
      }
      .onDisappear {
        readingVisible = false
        browser.showingReadingTime = false
        browser.readingActivity = nil
        browser.readingDocumentEnded = nil
        ReadingSessions.shared.end()
        browser.captureReaderPosition()
        if browser.selectedAnnotationID != nil { browser.selectedAnnotationID = nil }
      }
      .onChange(of: scenePhase) { _, phase in
        if phase != .active {
          browser.captureReaderPosition()
          if browser.selectedAnnotationID != nil { browser.selectedAnnotationID = nil }
        }
      }
      .onChange(of: browser.committedURL) { _, url in
        nearEnd = false
        if url != nil { store.visit(browser.libraryURL) }
      }
      .onChange(of: browser.isReader) { _, reader in
        if !reader { browser.captureReaderPosition() }
        nearEnd = false
        if browser.selectedAnnotationID != nil { browser.selectedAnnotationID = nil }
      }
      .onChange(of: readingContext) { _, _ in updateReadingSession() }
      .task {
        while !Task.isCancelled {
          do { try await Task.sleep(for: .seconds(5)) } catch { return }
          ReadingSessions.shared.flush()
        }
      }
      .onChange(of: fontSize, updateAppearance)
      .onChange(of: font, updateAppearance)
      .onChange(of: padding, updateAppearance)
      .onChange(of: leading, updateAppearance)
      .onChange(of: paletteName, updateAppearance)
      .onChange(of: systemScheme, updateAppearance)
      .alert(
        "Could not update article",
        isPresented: Binding(
          get: { actionError != nil }, set: { if !$0 { actionError = nil } }
        )
      ) {
        Button("OK") { actionError = nil }
      } message: {
        Text(actionError ?? "")
      }
      .alert(
        "Could not open article",
        isPresented: Binding(
          get: { browser.errorMessage != nil }, set: { if !$0 { browser.errorMessage = nil } })
      ) {
        Button("OK", role: .cancel) { browser.errorMessage = nil }
      } message: {
        Text(browser.errorMessage ?? "")
      }
  }

  private struct ReadingContext: Equatable {
    let url: URL
    let saved: Bool
    let eligible: Bool
  }

  private var readingContext: ReadingContext {
    ReadingContext(
      url: browser.libraryURL, saved: isSaved,
      eligible: readingVisible && scenePhase == .active && isSaved && browser.isReader
        && browser.readerReady && browser.positionReady && !appearance
        && browser.noteDraft == nil && browser.annotationPresentation == nil
        && !browser.showingReadingTime
        && browser.errorMessage == nil && actionError == nil)
  }

  private func updateReadingSession() {
    let context = readingContext
    if !context.saved { ReadingSessions.shared.end(); return }
    if context.eligible {
      ReadingSessions.shared.begin(url: context.url)
    } else {
      ReadingSessions.shared.pause()
    }
  }

  private var readingPage: some View {
    pageContent
      .background(palette.background)
      .navigationTitle("")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar(.visible, for: .navigationBar)
      .toolbarBackground(.hidden, for: .navigationBar)
      .readerBar(edge: .bottom) { bottomControls }
      .foregroundStyle(palette.foreground).tint(palette.foreground)
      .preferredColorScheme(palette.scheme)
  }

  private var pageContent: some View {
    ZStack(alignment: .top) {
      GeometryReader { geometry in
        // SwiftUI retains the outgoing surface only for the crossfade. WebKit's
        // remote accessibility tree must leave the hierarchy once it is hidden.
        // The browser still owns both documents and their scroll/history state.
        ZStack {
          if browser.isReader {
            WebSurface(
              webView: browser.readerView, insets: geometry.safeAreaInsets,
              isActive: { browser.isReader && browser.readerReady }, nearEnd: $nearEnd,
              onScrollEnd: browser.captureReaderPosition,
              onReadingActivity: { browser.readingActivity?() },
              onTap: browser.noteDraft == nil ? nil : { browser.noteDismissRequest += 1 }
            )
            .opacity(browser.readerReady && browser.positionReady ? 1 : 0)
            .allowsHitTesting(browser.readerReady)
            .accessibilityHidden(!browser.readerReady)
            .transition(.opacity)
          } else {
            WebSurface(
              webView: browser.webView, insets: geometry.safeAreaInsets,
              isActive: { !browser.isReader }, nearEnd: $nearEnd,
              onTap: browser.noteDraft == nil ? nil : { browser.noteDismissRequest += 1 }
            )
            .transition(.opacity)
          }
        }
        .animation(
          .timingCurve(0.23, 1, 0.32, 1, duration: reduceMotion ? 0.1 : 0.22),
          value: browser.isReader
        )
        .accessibilityIdentifier("reader-document")
        .accessibilityValue(
          browser.isReader ? (browser.readerReady ? "Reader" : "Preparing Reader") : "Website"
        )
        .ignoresSafeArea(.container, edges: .vertical)
      }
      if (browser.isLoading && !browser.isReader) || browser.isOpeningWebsite {
        ProgressView().padding(8).background(.regularMaterial, in: Capsule()).padding(8)
      }
      if let failed = browser.annotations.first(where: { AnnotationStore.shared.failedNotes[$0.id] != nil }) {
        Button("Note not saved · Retry") { AnnotationStore.shared.retryNote(failed.id) }
          .font(.subheadline).padding(12).readerGlass().padding(.top, 8)
          .accessibilityIdentifier("reader-note-retry")
      }
      if let failure = browser.websiteFailure {
        if browser.readerReady {
          HStack(spacing: 12) {
            Text("Website unavailable").font(.subheadline)
            Button("Retry", action: browser.retryFailedWebsite).font(.subheadline.weight(.semibold))
              .accessibilityIdentifier("reader-retry")
          }
          .padding(.horizontal, 16).padding(.vertical, 10)
          .background(.regularMaterial, in: Capsule()).padding(.top, 8)
        } else {
          ContentUnavailableView {
            Label("Page unavailable", systemImage: "wifi.slash")
          } description: {
            Text(failure)
          } actions: {
            Button("Retry", action: browser.retryFailedWebsite)
              .buttonStyle(.borderedProminent).accessibilityIdentifier("reader-retry")
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(palette.background)
        }
      }
    }
  }

  @ViewBuilder private var bottomControls: some View {
    if browser.annotationPresentation != nil {
      // safeAreaBar has a separate native host. Remove its controls during a
      // modal sheet; an accessibilityHidden modifier alone does not hide them.
      Color.clear.frame(height: controlsHeight).allowsHitTesting(false).accessibilityHidden(true)
    } else {
      interactiveBottomControls
        .onGeometryChange(for: CGFloat.self) {
          $0.size.height
        } action: {
          controlsHeight = $0
        }
    }
  }

  private var interactiveBottomControls: some View {
    VStack(spacing: 10) {
      if browser.selectedAnnotationID == nil, !appearance, nearEnd, canArchive {
        Button(action: archive) {
          Label("Archive and close", systemImage: "archivebox")
            .font(.subheadline.weight(.semibold)).padding(.horizontal, 20).frame(height: 44)
        }
        .readerGlass().accessibilityIdentifier("reader-archive-prompt")
        .transition(reduceMotion ? .opacity : .offset(y: 8).combined(with: .opacity))
      }
      if let draft = browser.noteDraft {
        ReaderNoteComposer(browser: browser, draft: draft).id(draft.id)
          .transition(.opacity)
      } else if let id = browser.selectedAnnotationID,
        let annotation = browser.annotations.first(where: { $0.id == id }), browser.isReader
      {
        HighlightToolbar(annotation: annotation, browser: browser)
          .padding(.bottom, 6)
          .transition(reduceMotion ? .opacity : .offset(y: 8).combined(with: .opacity))
      } else if appearance {
        appearanceControls
      } else {
        HStack(alignment: .bottom, spacing: 10) {
          navigationControls
          Button {
            browser.beginNote()
          } label: {
            Image(systemName: "square.and.pencil").font(.system(size: 21))
              .offset(y: -1).frame(width: 54, height: 54)
          }
          .readerGlass().accessibilityLabel("Add note").accessibilityIdentifier("reader-add-note")
        }.padding(.horizontal, 12).padding(.bottom, 6)
      }
    }
    .animation(
      .timingCurve(0.23, 1, 0.32, 1, duration: reduceMotion ? 0.1 : 0.18), value: nearEnd
    )
    .animation(.easeOut(duration: reduceMotion ? 0.1 : 0.18), value: browser.selectedAnnotationID)
    .animation(.easeOut(duration: reduceMotion ? 0.1 : 0.18), value: browser.noteDraft?.id)
  }

  private var navigationControls: some View {
    HStack(spacing: 0) {
      Button("Back", systemImage: "chevron.left", action: browser.back)
        .labelStyle(.iconOnly).frame(width: 44, height: 44).disabled(!browser.canGoBack)
        .accessibilityIdentifier("browser-back")
        .opacity(browser.canGoBack ? 1 : 0.28).frame(maxWidth: .infinity)
      Button("Forward", systemImage: "chevron.right", action: browser.forward)
        .labelStyle(.iconOnly).frame(width: 44, height: 44).disabled(!browser.canGoForward)
        .accessibilityIdentifier("browser-forward")
        .opacity(browser.canGoForward ? 1 : 0.28).frame(maxWidth: .infinity)
      Button {
        if !browser.isReader { browser.toggleReader() }
        appearance = true
      } label: {
        Image(systemName: "textformat.size").frame(width: 44, height: 44)
      }
      .accessibilityLabel("Reader appearance").accessibilityIdentifier("reader-appearance")
      .accessibilityValue(browser.appearanceDescription).disabled(!browser.hasLoaded)
      .frame(maxWidth: .infinity)
      Button(action: toggleSaved) {
        Image(systemName: isSaved ? "bookmark.fill" : "bookmark").frame(width: 44, height: 44)
          .contentTransition(.symbolEffect(.replace))
          .animation(.easeOut(duration: reduceMotion ? 0.1 : 0.2), value: isSaved)
      }
      .accessibilityLabel(isSaved ? "Unsave article" : "Save article")
      .accessibilityValue(isSaved ? "Saved" : "Not saved")
      .accessibilityIdentifier("reader-save").frame(maxWidth: .infinity)
      Button(action: browser.toggleReader) {
        Image(systemName: browser.isReader ? "globe" : "bolt.fill")
          .font(.system(size: 22, weight: .medium, design: .rounded)).frame(width: 44, height: 44)
      }
      .accessibilityLabel(browser.isReader ? "Website" : "Reader")
      .accessibilityIdentifier("reader-toggle")
      .accessibilityValue(browser.readerReady ? "Ready" : "Preparing")
      .disabled(!browser.hasLoaded || browser.isOpeningWebsite)
      .frame(maxWidth: .infinity)
    }
    .font(.title3).padding(.horizontal, 12).padding(.vertical, 5)
    .frame(maxWidth: 360).readerGlass()
  }

  private func toggleSaved() {
    do {
      try store.setSaved(!isSaved, url: article?.url ?? browser.libraryURL)
      if isSaved { browser.persistExtraction(in: store) }
    } catch { actionError = error.localizedDescription }
  }

  private func archive() {
    guard canArchive, let article else { return }
    do {
      try store.archive(article.id)
      dismiss()
    } catch { actionError = error.localizedDescription }
  }

  private var appearanceControls: some View {
    VStack(spacing: 12) {
      HStack {
        Text("Reader appearance").font(.headline)
        Spacer()
        Button("Done") { appearance = false }.font(.subheadline.weight(.semibold))
      }
      HStack {
        Picker("Typeface", selection: $font) {
          ForEach(["System", "DM Sans", "EB Garamond", "Georgia", "Palatino"], id: \.self) {
            Text($0)
          }
        }.pickerStyle(.menu).accessibilityIdentifier("reader-font")
        Spacer()
        Picker("Theme", selection: $paletteName) {
          ForEach(ReadingPalette.allCases, id: \.rawValue) { Text($0.rawValue).tag($0.rawValue) }
        }.pickerStyle(.menu).accessibilityIdentifier("reader-theme")
      }
      adjustment(
        "Text size", value: $fontSize, range: 16...30, step: 1, display: "\(Int(fontSize))")
      adjustment(
        "Side padding", value: $padding, range: 8...36, step: 2, display: "\(Int(padding))")
      adjustment(
        "Line spacing", value: $leading, range: 1.25...1.95, step: 0.05,
        display: String(format: "%.2f", leading))
    }
    .padding(18).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 26))
    .padding(.horizontal, 12).padding(.bottom, 6)
    .accessibilityElement(children: .contain)
  }

  private func adjustment(
    _ name: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double,
    display: String
  ) -> some View {
    HStack(spacing: 12) {
      Text(name).font(.subheadline)
      Spacer(minLength: 8)
      HStack(spacing: 0) {
        Button {
          value.wrappedValue = max(
            range.lowerBound, ((value.wrappedValue - step) / step).rounded() * step)
        } label: {
          Image(systemName: "minus").frame(width: 44, height: 44)
        }
        .disabled(value.wrappedValue <= range.lowerBound + 0.001)
        .accessibilityLabel("Decrease " + name.lowercased())
        .accessibilityIdentifier(
          "reader-decrease-" + name.lowercased().replacingOccurrences(of: " ", with: "-"))
        Text(display).font(.subheadline.monospacedDigit()).frame(width: 44)
          .accessibilityLabel(name).accessibilityValue(display)
        Button {
          value.wrappedValue = min(
            range.upperBound, ((value.wrappedValue + step) / step).rounded() * step)
        } label: {
          Image(systemName: "plus").frame(width: 44, height: 44)
        }
        .disabled(value.wrappedValue >= range.upperBound - 0.001)
        .accessibilityLabel("Increase " + name.lowercased())
        .accessibilityIdentifier(
          "reader-increase-" + name.lowercased().replacingOccurrences(of: " ", with: "-"))
      }
      .font(.subheadline.weight(.semibold))
      .background(palette.foreground.opacity(0.06), in: Capsule())
    }
  }

  private func updateAppearance() {
    browser.darkAppearance = systemScheme == .dark
    if browser.readerReady { browser.applyAppearance() }
  }
}

/// Shared stack chrome stays stationary while the Reader page slides beneath it.
struct ReaderNavigationBar: View {
  let browser: ArticleBrowser
  let store: ArticleStore
  let close: () -> Void
  @Environment(\.openURL) private var openURL

  private var article: SavedArticle? {
    store.articles.first { $0.url == browser.libraryURL }
      ?? store.articles.first { $0.url == browser.sourceURL }
  }

  var body: some View {
    HStack {
      // UIKit owns the Back button and its interactive pop gesture.
      Color.clear.frame(width: 44, height: 44).allowsHitTesting(false)
      Spacer()
      Button {
        browser.annotationPresentation = AnnotationPresentation()
      } label: {
        Image(systemName: "text.bubble").frame(width: 44, height: 44)
      }
      .readerGlass()
      .accessibilityLabel("Notes")
      .accessibilityIdentifier("reader-notes")
      .accessibilityValue(
        "\(browser.annotations.count) \(browser.annotations.count == 1 ? "passage" : "passages")"
      )
      // Article notes are local and remain available when the page cannot load.
      Menu {
        Button("Copy link", systemImage: "link") {
          UIPasteboard.general.url = browser.libraryURL
        }.accessibilityIdentifier("reader-copy-link")
        ShareLink(item: browser.libraryURL) {
          Label("Share", systemImage: "square.and.arrow.up")
        }.accessibilityIdentifier("reader-share-link")
        Button("Find in page", systemImage: "doc.text.magnifyingglass", action: browser.findInPage)
          .disabled(!browser.hasLoaded || browser.noteDraft != nil)
          .accessibilityIdentifier("reader-find")
        Button("Reading time", systemImage: "clock") {
          ReadingSessions.shared.pause()
          browser.showingReadingTime = true
        }.accessibilityIdentifier("reader-reading-time")
        Divider()
        if let article, article.saved {
          Button(
            article.favourite ? "Unfavourite" : "Favourite",
            systemImage: article.favourite ? "star.slash" : "star"
          ) {
            store.setFavourite(!article.favourite, for: article.id)
          }.accessibilityIdentifier("reader-favourite")
        }
        Button("Archive article", systemImage: "archivebox") {
          guard let article else { return }
          do {
            try store.archive(article.id)
            close()
          } catch { store.errorMessage = error.localizedDescription }
        }
        .disabled(article?.saved != true || article?.isArchived == true)
        .accessibilityIdentifier("reader-archive-menu")
        Button("Refresh Reader", systemImage: "arrow.clockwise.document", action: browser.refreshReader)
          .disabled(browser.isExtracting || browser.isOpeningWebsite)
          .accessibilityIdentifier("reader-refresh")
        Button("Reload", systemImage: "arrow.clockwise", action: browser.reload)
        Button("Open in browser", systemImage: "safari") { openURL(browser.libraryURL) }
          .accessibilityIdentifier("reader-open-browser")
        Button("Try Unwall", systemImage: "doc.text", action: browser.openUnwall)
      } label: {
        Image(systemName: "ellipsis").frame(width: 44, height: 44)
      }.readerGlass().accessibilityLabel("Page options")
    }
    .overlay {
      Text(browser.sourceURL.host ?? "Article").font(.headline).lineLimit(1)
        .padding(.horizontal, 108).allowsHitTesting(false)
    }
    .padding(.horizontal, 16)
    .sheet(isPresented: Binding(
      get: { browser.showingReadingTime },
      set: { browser.showingReadingTime = $0 }
    )) {
      ReadingStatsView(articleURL: browser.libraryURL, articleTitle: article?.title)
    }
  }
}

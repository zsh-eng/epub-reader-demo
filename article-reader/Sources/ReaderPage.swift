import SwiftUI

/// A pushed reading page. The compact controls leave the actual article visible
/// and scrollable while appearance changes are applied without a reload.
struct ReaderPage: View {
  let store: ArticleStore
  @State private var browser: ArticleBrowser
  @Environment(\.colorScheme) private var systemScheme
  @State private var appearance = false
  @AppStorage("reader-size") private var fontSize = 20.0
  @AppStorage("reader-font") private var font = "System"
  @AppStorage("reader-padding") private var padding = 18.0
  @AppStorage("reader-leading") private var leading = 1.55
  @AppStorage("reader-palette") private var paletteName = "System"
  private var palette: ReadingPalette { ReadingPalette(rawValue: paletteName) ?? .system }
  init(browser: ArticleBrowser, store: ArticleStore) {
    _browser = State(initialValue: browser)
    self.store = store
  }

  var body: some View {
    ZStack(alignment: .top) {
      GeometryReader { geometry in
        WebSurface(
          webView: browser.isReader ? browser.readerView : browser.webView,
          insets: geometry.safeAreaInsets
        )
        .id(browser.isReader)
        .ignoresSafeArea(.container, edges: .vertical)
      }
      if browser.isLoading && !browser.isReader {
        ProgressView().padding(8).background(.regularMaterial, in: Capsule()).padding(8)
      }
    }
    .background(palette.background)
    .navigationTitle(browser.sourceURL.host ?? "Article")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar(.visible, for: .navigationBar)
    .toolbarBackground(.automatic, for: .navigationBar)
    .toolbarColorScheme(palette.scheme ?? systemScheme, for: .navigationBar)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button("Save to inbox", systemImage: "tray.and.arrow.down") {
            do {
              try store.add(browser.sourceURL.absoluteString)
              browser.persistExtraction(in: store)
            } catch {
              store.errorMessage = error.localizedDescription
            }
          }
          .disabled(
            store.articles.contains {
              $0.url == browser.sourceURL && $0.saved && $0.isArchived != true
            })
          Button("Reload", systemImage: "arrow.clockwise", action: browser.reload)
          Button("Open original", systemImage: "globe", action: browser.openOriginal)
          Button("Try Unwall", systemImage: "doc.text", action: browser.openUnwall)
        } label: {
          Image(systemName: "ellipsis")
        }
        .accessibilityLabel("Page options")
      }
    }
    .readerBar(edge: .bottom) {
      if appearance { appearanceControls } else { navigationControls.padding(.bottom, 6) }
    }
    .foregroundStyle(palette.foreground).tint(palette.foreground)
    .preferredColorScheme(palette.scheme)
    .onAppear {
      updateAppearance()
      store.visit(browser.sourceURL)
    }
    .onChange(of: browser.committedURL) { _, url in
      if let url { store.visit(url) }
    }
    .onChange(of: fontSize, updateAppearance)
    .onChange(of: font, updateAppearance)
    .onChange(of: padding, updateAppearance)
    .onChange(of: leading, updateAppearance)
    .onChange(of: paletteName, updateAppearance)
    .onChange(of: systemScheme, updateAppearance)
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

  private var navigationControls: some View {
    HStack(spacing: 20) {
      Button("Back", systemImage: "chevron.left", action: browser.back)
        .labelStyle(.iconOnly).frame(width: 44, height: 44).disabled(!browser.canGoBack)
        .opacity(browser.canGoBack ? 1 : 0.28)
      Button("Forward", systemImage: "chevron.right", action: browser.forward)
        .labelStyle(.iconOnly).frame(width: 44, height: 44).disabled(!browser.canGoForward)
        .opacity(browser.canGoForward ? 1 : 0.28)
      Button(action: browser.toggleReader) {
        Image(systemName: browser.isReader ? "globe" : "bolt.fill")
          .font(.system(size: 22, weight: .medium, design: .rounded)).frame(width: 44, height: 44)
      }
      .accessibilityLabel(browser.isReader ? "Website" : "Reader")
      .accessibilityIdentifier("reader-toggle")
      .accessibilityValue(browser.readerReady ? "Ready" : "Preparing").disabled(!browser.hasLoaded)
      Button {
        if !browser.isReader { browser.toggleReader() }
        appearance = true
      } label: {
        Image(systemName: "textformat.size").frame(width: 44, height: 44)
      }
      .accessibilityLabel("Reader appearance").accessibilityIdentifier("reader-appearance")
      .accessibilityValue(browser.appearanceDescription).disabled(!browser.hasLoaded)
    }.font(.title3).padding(.horizontal, 16).padding(.vertical, 5).readerGlass()
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
      Text(name).font(.subheadline).frame(width: 95, alignment: .leading)
      Slider(value: value, in: range, step: step).accessibilityLabel(name)
      Text(display).font(.caption.monospacedDigit()).frame(width: 34, alignment: .trailing)
    }
  }

  private func updateAppearance() {
    browser.darkAppearance = systemScheme == .dark
    if browser.readerReady { browser.applyAppearance() }
  }
}

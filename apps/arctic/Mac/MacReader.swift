import AppKit
import OSLog
import Observation
import SwiftUI
import WebKit

private let readerLog = Logger(subsystem: "com.zsheng.ArcticMac", category: "Reader")

/// Strong ownership ends at the pool. WebKit retains only this weak message bridge.
@MainActor private final class MacScriptBridge: NSObject, WKScriptMessageHandler {
  weak var reader: MacReader?
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    reader?.receive(message)
  }
}

@MainActor @Observable final class MacReader: NSObject, WKNavigationDelegate {
  let url: URL
  let readerView: WKWebView
  private(set) var websiteView: WKWebView?
  private(set) var ready = false
  private(set) var loading = false
  var websiteVisible = false { didSet { onChange?() } }
  var error: String?
  var showFind = false { didSet { onChange?() } }
  var onShortcuts: (() -> Void)?
  var isSaved: Bool { store.article(for: url)?.saved == true }
  var focusedAnnotation: UUID?
  var onQuote: (() -> Void)?
  @ObservationIgnored private var selectionPopover: MacSelectionTooltip?
  @ObservationIgnored private var dismissSelectionTask: Task<Void, Never>?
  @ObservationIgnored private var appearanceObserver: NSObjectProtocol?
  private(set) var measuredFPS: Int?
  private(set) var highRefreshAvailable = false
  @ObservationIgnored private var selectedQuote: ReaderQuote?
  @ObservationIgnored private var selectionTask: Task<Void, Never>?
  var draft = ""
  var quotedDraft: ReaderQuote?
  private(set) var readyMilliseconds = 0.0
  private(set) var loadCount = 0
  var onLink: ((URL, Bool) -> Void)?
  var onTitle: ((String) -> Void)?
  var onChange: (() -> Void)?
  @ObservationIgnored private let store: ArticleStore
  @ObservationIgnored private let bridge: MacScriptBridge
  @ObservationIgnored private var loadTask: Task<Void, Never>?
  @ObservationIgnored private var extracting = false
  @ObservationIgnored private var html: String?
  @ObservationIgnored private var began = ContinuousClock.now
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var renderedRecords: [ReaderAnnotation]?
  @ObservationIgnored private var attemptedDOM = false
  @ObservationIgnored private var discarded = false

  init(url: URL, store: ArticleStore) {
    self.url = url
    self.store = store
    bridge = MacScriptBridge()
    let config = WKWebViewConfiguration()
    config.mediaTypesRequiringUserActionForPlayback = .all
    _ = MacWebRefresh.configure(config.preferences)
    config.setURLSchemeHandler(ReaderFontScheme(), forURLScheme: "arctic-font")
    config.userContentController.add(bridge, contentWorld: .defaultClient, name: "arcticMac")
    config.userContentController.add(
      bridge, contentWorld: .defaultClient, name: "arcticAnnotationTap")
    config.userContentController.add(
      bridge, contentWorld: .defaultClient, name: "arcticReadingActivity")
    config.userContentController.addUserScript(
      WKUserScript(
        source: """
          webkit.messageHandlers.arcticMac.postMessage('readerReady');
          let positionTimer;
          addEventListener('scroll', () => {
            clearTimeout(positionTimer);
            positionTimer = setTimeout(() => {
              if (globalThis.arcticPosition) webkit.messageHandlers.arcticMac.postMessage({position: arcticPosition.capture(20)});
            }, 300);
          }, {passive: true});
          let last = 0;
          addEventListener('keydown', e => {
            if (e.key === '?' && !e.target.closest('input,textarea,[contenteditable]')) {
              e.preventDefault(); webkit.messageHandlers.arcticMac.postMessage('shortcuts');
            }
          });
          addEventListener('wheel', e => {
            if (!e.isTrusted || performance.now() - last < 1000) return;
            last = performance.now(); webkit.messageHandlers.arcticMac.postMessage('activity');
          }, {passive: true});
          """, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
    readerView = WKWebView(
      frame: NSRect(x: 0, y: 0, width: 900, height: 800), configuration: config)
    super.init()
    bridge.reader = self
    highRefreshAvailable = MacWebRefresh.configure(readerView.configuration.preferences)
    appearanceObserver = NotificationCenter.default.addObserver(
      forName: MacAppearance.changed, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.applyAppearance() }
    }
    readerView.navigationDelegate = self
    readerView.isInspectable = TestMode.enabled
    readerView.setValue(false, forKey: "drawsBackground")
  }

  func start(localOnly: Bool = false) {
    guard !discarded, !ready, !loading else { return }
    error = nil
    began = .now
    loading = true
    loadCount += 1
    let token = generation
    if let file = store.downloadedFile(for: url) {
      loadTask = Task { [weak self] in
        do {
          let html = try await Task.detached(priority: .userInitiated) {
            try String(contentsOf: file, encoding: .utf8)
          }.value
          guard let self, !Task.isCancelled, token == generation else { return }
          self.html = html
          let assets = try await MacReaderAssets.shared.load()
          guard !Task.isCancelled, token == generation else { return }
          readerView.loadHTMLString(
            MacReaderAssets.prepare(html, css: assets.desktopCSS + MacAppearance.shared.css),
            baseURL: url)
        } catch {
          guard let self, !Task.isCancelled, token == generation else { return }
          loading = false
          self.error = "The saved copy could not be opened. Refresh Reader to try the website."
        }
      }
    } else if !localOnly {
      loadWebsite()
    } else {
      loading = false
    }
  }

  private func loadWebsite() {
    error = nil
    let web = makeWebsite()
    if let fixture = TestMode.fixture(for: url) {
      web.loadFileURL(fixture, allowingReadAccessTo: fixture.deletingLastPathComponent())
    } else {
      web.load(URLRequest(url: url, timeoutInterval: 25))
    }
  }

  private func makeWebsite() -> WKWebView {
    if let websiteView { return websiteView }
    let config = WKWebViewConfiguration()
    config.mediaTypesRequiringUserActionForPlayback = .all
    _ = MacWebRefresh.configure(config.preferences)
    config.userContentController.add(bridge, contentWorld: .defaultClient, name: "arcticMac")
    config.userContentController.addUserScript(
      WKUserScript(
        source: "webkit.messageHandlers.arcticMac.postMessage('sourceReady')",
        injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
    let view = WKWebView(frame: readerView.frame, configuration: config)
    view.navigationDelegate = self
    websiteView = view
    return view
  }

  func toggleWebsite() {
    checkpoint()
    websiteVisible.toggle()
    if websiteVisible, websiteView == nil { loadWebsite() }
  }

  /// Refresh always uses this tab's immutable URL. Links create independent tabs.
  func refresh() {
    generation = UUID()
    loadTask?.cancel()
    extracting = false
    attemptedDOM = false
    loading = true
    error = nil
    began = .now
    loadWebsite()
  }

  func extract() {
    guard let source = websiteView, !extracting, !discarded else { return }
    extracting = true
    let token = generation
    loadTask = Task { [weak self] in
      guard let self else { return }
      do {
        let assets = try await MacReaderAssets.shared.load()
        _ = try await source.evaluateJavaScript(
          assets.script, in: nil, contentWorld: .defaultClient)
        let raw = try await source.evaluateJavaScript(
          "extractArticle()", in: nil, contentWorld: .defaultClient)
        guard !Task.isCancelled, token == generation,
          let article = raw as? [String: String], article["content"] != nil
        else { return }
        let rendered = MacReaderAssets.document(
          article, css: assets.css + assets.desktopCSS, source: url)
        html = rendered
        onTitle?(article["title"] ?? url.host ?? "Article")
        readerView.loadHTMLString(
          MacReaderAssets.prepare(rendered, css: MacAppearance.shared.css), baseURL: url)
        persistReader()
        if !websiteVisible {
          source.stopLoading()
          source.navigationDelegate = nil
          source.configuration.userContentController.removeAllScriptMessageHandlers()
          websiteView = nil
        }
      } catch {
        guard !Task.isCancelled, token == generation else { return }
        // DOM readiness can precede a client-rendered article. didFinish gets one
        // more attempt; Refresh Reader remains available at any point.
        if !source.isLoading {
          loading = false
          self.error = "Reader is not ready. Try Refresh Reader, or view the website."
        }
      }
      if token == generation { extracting = false }
    }
  }

  func persistReader() {
    guard let html else { return }
    Task { await store.saveReader(html, for: url) }
  }

  func receive(_ message: WKScriptMessage) {
    guard !discarded, message.frameInfo.isMainFrame else { return }
    if message.name == "arcticAnnotationTap", let body = message.body as? [String: String] {
      selectionTask?.cancel()
      dismissSelectionTask?.cancel()
      focusedAnnotation = body["id"].flatMap(UUID.init(uuidString:))
      if focusedAnnotation != nil {
        selectedQuote = nil
        presentSelection()
      } else {
        scheduleSelectionDismissal()
      }
      return
    }
    if message.name == "arcticReadingActivity" || message.body as? String == "activity" {
      ReadingSessions.shared.activity(for: url)
      return
    }
    if let value = message.body as? [String: String], let position = value["position"] {
      ReaderPosition.save(position, for: url)
      return
    }
    if let body = message.body as? [String: Any] {
      if body["selection"] as? [String: Double] != nil {
        selectionTask?.cancel()
        dismissSelectionTask?.cancel()
        selectionTask = Task {
          let quote = await selection()
          guard !Task.isCancelled, let quote else { return }
          selectedQuote = quote
          focusedAnnotation = nil
          presentSelection()
        }
      } else if body["dismissSelection"] as? Bool == true {
        scheduleSelectionDismissal()
      }
      return
    }
    switch message.body as? String {
    case "shortcuts": onShortcuts?()
    case "sourceReady":
      if !attemptedDOM && !websiteVisible {
        attemptedDOM = true
        extract()
      }
    case "readerReady":
      loadTask = Task { [weak self] in
        guard let self else { return }
        let assets = try? await MacReaderAssets.shared.load()
        guard !Task.isCancelled, !discarded, let assets else { return }
        _ = try? await readerView.evaluateJavaScript(
          assets.annotations + "\n" + ReaderPosition.script + "\n" + assets.selection,
          in: nil, contentWorld: .defaultClient)
        if let position = ReaderPosition.load(url) {
          _ = try? await readerView.callAsyncJavaScript(
            "arcticPosition.restore(JSON.parse(position), 20)", arguments: ["position": position],
            in: nil, contentWorld: .defaultClient)
        }
        // Fonts, restored position and the final layout settle behind the
        // placeholder. Network images are deliberately not part of readiness.
        _ = try? await readerView.callAsyncJavaScript(
          "await document.fonts.ready; if (visible) await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          arguments: ["visible": readerView.window != nil], in: nil, contentWorld: .defaultClient)
        guard !Task.isCancelled, !discarded else { return }
        applyAppearance()
        renderedRecords = nil
        ready = true
        loading = false
        error = nil
        readyMilliseconds =
          Double(began.duration(to: .now).components.attoseconds) / 1e15
          + Double(began.duration(to: .now).components.seconds) * 1000
        readerLog.info(
          "Reader ready in \(self.readyMilliseconds) ms; cached=\(self.store.downloadedFile(for: self.url) != nil)"
        )
        renderAnnotations()
        onChange?()
      }
    default: break
    }
  }

  func checkpoint() {
    dismissSelectionTask?.cancel()
    selectionTask?.cancel()
    selectionPopover?.close()
    selectedQuote = nil
    guard ready else { return }
    let identity = url
    readerView.evaluateJavaScript("arcticPosition.capture(20)", in: nil, in: .defaultClient) {
      result in
      if case .success(let json as String) = result { ReaderPosition.save(json, for: identity) }
    }
  }

  func renderAnnotations() {
    guard ready else { return }
    let records = AnnotationStore.shared.annotations(for: url)
    guard records != renderedRecords else { return }
    renderedRecords = records
    guard let bytes = try? JSONEncoder().encode(records),
      let json = String(data: bytes, encoding: .utf8)
    else { return }
    readerView.callAsyncJavaScript(
      "arcticAnnotations.render(JSON.parse(records), token)",
      arguments: ["records": json, "token": url.absoluteString], in: nil, in: .defaultClient
    ) { _ in }
  }

  func selection() async -> ReaderQuote? {
    guard ready, !websiteVisible,
      let result = try? await readerView.evaluateJavaScript(
        "arcticAnnotations.selection()", in: nil, contentWorld: .defaultClient),
      let value = result as? [String: Any],
      let data = try? JSONSerialization.data(withJSONObject: value)
    else { return nil }
    return try? JSONDecoder().decode(ReaderQuote.self, from: data)
  }

  func highlight(_ colour: HighlightColour = .yellow) {
    Task {
      guard let quote = await currentQuote() else { return }
      do {
        if store.article(for: url)?.saved != true {
          try store.setSaved(true, url: url)
          persistReader()
        }
        let record = try AnnotationStore.shared.highlight(quote, in: url)
        if colour != .yellow { try AnnotationStore.shared.recolour(record.id, colour: colour) }
        focusedAnnotation = record.id
        selectedQuote = nil
        readerView.evaluateJavaScript(
          "window.getSelection()?.removeAllRanges()", in: nil, in: .defaultClient
        ) { _ in }
        renderAnnotations()
        onChange?()
      } catch { self.error = error.localizedDescription }
    }
  }

  func currentQuote() async -> ReaderQuote? {
    if selectionPopover?.isShown == true, let selectedQuote { return selectedQuote }
    return await selection()
  }

  private func scheduleSelectionDismissal() {
    dismissSelectionTask?.cancel()
    dismissSelectionTask = Task { [weak self] in
      // Mouse-up and the annotation click are separate messages. Keep the same
      // surface alive until we know this is an outside click, not a new target.
      do { try await Task.sleep(for: .milliseconds(90)) } catch { return }
      guard let self else { return }
      selectionTask?.cancel()
      selectedQuote = nil
      focusedAnnotation = nil
      selectionPopover?.close()
    }
  }

  private func presentSelection() {
    guard ready, !websiteVisible, let window = readerView.window else { return }
    dismissSelectionTask?.cancel()
    if selectionPopover == nil { selectionPopover = MacSelectionTooltip(reader: self) }
    selectionPopover?.show(in: window, near: NSEvent.mouseLocation)
  }

  func colourSelection(_ colour: HighlightColour) {
    guard let id = focusedAnnotation else {
      highlight(colour)
      return
    }
    do {
      try AnnotationStore.shared.recolour(id, colour: colour)
      renderAnnotations()
    } catch { self.error = error.localizedDescription }
  }

  func removeFocusedHighlight() {
    guard let id = focusedAnnotation else { return }
    do {
      try AnnotationStore.shared.removeHighlight(id)
      renderAnnotations()
    } catch { self.error = error.localizedDescription }
    focusedAnnotation = nil
    selectionPopover?.close()
  }

  func quoteSelection() {
    Task {
      if let id = focusedAnnotation {
        quotedDraft = AnnotationStore.shared.annotations(for: url).first { $0.id == id }?.quote
      } else {
        quotedDraft = await currentQuote()
      }
      selectionPopover?.close()
      onQuote?()
    }
  }

  func find(_ text: String, backwards: Bool = false) {
    let configuration = WKFindConfiguration()
    configuration.backwards = backwards
    configuration.wraps = true
    (websiteVisible ? websiteView : readerView)?.find(text, configuration: configuration) { _ in }
  }

  private func applyAppearance() {
    highRefreshAvailable = MacWebRefresh.configure(readerView.configuration.preferences)
    if let websiteView { _ = MacWebRefresh.configure(websiteView.configuration.preferences) }
    readerView.callAsyncJavaScript(
      """
      let style = document.getElementById('arctic-appearance');
      if (!style) { style = document.createElement('style'); style.id = 'arctic-appearance'; document.head.appendChild(style); }
      document.documentElement.removeAttribute('data-theme');
      style.textContent = css;
      """, arguments: ["css": MacAppearance.shared.css], in: nil, in: .defaultClient
    ) { _ in }
  }

  func measureRefresh() {
    let view = websiteVisible ? websiteView : readerView
    view?.callAsyncJavaScript(
      """
      return await new Promise(resolve => {
        let samples = [], last;
        function tick(now) {
          if (last !== undefined) samples.push(now - last);
          last = now;
          if (samples.length < 90) requestAnimationFrame(tick);
          else { samples.sort((a,b)=>a-b); resolve(Math.round(1000 / samples[Math.floor(samples.length/2)])); }
        }
        requestAnimationFrame(tick);
      });
      """, arguments: [:], in: nil, in: .defaultClient
    ) { [weak self] result in
      if case .success(let fps as Int) = result { self?.measuredFPS = fps }
    }
  }

  func discard() {
    checkpoint()
    dismissSelectionTask?.cancel()
    selectionPopover?.close()
    selectionPopover = nil
    if let appearanceObserver { NotificationCenter.default.removeObserver(appearanceObserver) }
    appearanceObserver = nil
    onQuote = nil
    discarded = true
    generation = UUID()
    loadTask?.cancel()
    for web in [readerView, websiteView].compactMap({ $0 }) {
      web.stopLoading()
      web.navigationDelegate = nil
      web.configuration.userContentController.removeAllScriptMessageHandlers()
      web.removeFromSuperview()
    }
    onChange = nil
    onLink = nil
    onTitle = nil
    websiteView = nil
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if webView === websiteView, !websiteVisible, loading { extract() }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failed(error)
  }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) { failed(error) }
  private func failed(_ error: Error) {
    guard (error as NSError).code != NSURLErrorCancelled else { return }
    loading = false
    self.error =
      (error as NSError).code == NSURLErrorAppTransportSecurityRequiresSecureConnection
      ? "This site requires insecure HTTP. Open it in your browser instead."
      : "Could not open this article. Check your connection and retry."
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    if webView === readerView {
      ready = false
      loading = false
    }
    error = "The reader was released to free memory. Reload to continue."
    onChange?()
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard action.navigationType == .linkActivated, let destination = action.request.url else {
      decisionHandler(.allow)
      return
    }
    if destination.fragment != nil,
      destination.absoluteString.components(separatedBy: "#").first
        == url.absoluteString.components(separatedBy: "#").first
    {
      decisionHandler(.allow)
      return
    }
    decisionHandler(.cancel)
    if SharedInbox.webURL(destination.absoluteString) != nil {
      onLink?(destination, action.modifierFlags.contains(.command))
    } else if ["mailto", "tel"].contains(destination.scheme ?? "") {
      NSWorkspace.shared.open(destination)
    }
  }
}

/// LRU eviction keeps the active tab. Cold tabs retain metadata and disk HTML.
@MainActor @Observable final class MacReaderPool {
  static let capacity = 3
  private(set) var count = 0
  private(set) var hits = 0
  private(set) var misses = 0
  @ObservationIgnored private var entries: [URL: MacReader] = [:]
  @ObservationIgnored private var order: [URL] = []
  @ObservationIgnored private var pressure: DispatchSourceMemoryPressure?
  private var protectedURL: URL?
  @ObservationIgnored private var drafts: [URL: (String, ReaderQuote?)] = [:]

  init() {
    let pressure = DispatchSource.makeMemoryPressureSource(
      eventMask: [.warning, .critical], queue: .main)
    pressure.setEventHandler { [weak self] in
      Task { @MainActor in self?.trim() }
    }
    pressure.resume()
    self.pressure = pressure
  }
  deinit { pressure?.cancel() }
  func existing(_ url: URL) -> MacReader? { entries[url] }
  func acquire(_ url: URL, store: ArticleStore, protecting: URL? = nil) -> MacReader {
    protectedURL = protecting ?? url
    order.removeAll { $0 == url }
    order.append(url)
    if let entry = entries[url] {
      hits += 1
      return entry
    }
    misses += 1
    while entries.count >= Self.capacity,
      let victim = order.first(where: { $0 != protectedURL && $0 != url })
    { remove(victim) }
    let entry = MacReader(url: url, store: store)
    if let draft = drafts[url] {
      entry.draft = draft.0
      entry.quotedDraft = draft.1
    }
    entries[url] = entry
    count = entries.count
    return entry
  }
  func remove(_ url: URL) {
    if let entry = entries.removeValue(forKey: url) {
      if !entry.draft.isEmpty || entry.quotedDraft != nil {
        drafts[url] = (entry.draft, entry.quotedDraft)
      } else {
        drafts[url] = nil
      }
      entry.discard()
    }
    order.removeAll { $0 == url }
    count = entries.count
  }
  func trim() {
    for url in Array(entries.keys) where url != protectedURL { remove(url) }
  }
}

private actor MacReaderAssets {
  static let shared = MacReaderAssets()
  struct Assets {
    let script: String
    let css: String
    let annotations: String
    let desktopCSS: String
    let selection: String
  }
  private var cached: Assets?
  func load() throws -> Assets {
    if let cached { return cached }
    func read(_ name: String, _ ext: String) throws -> String {
      try String(
        contentsOf: Bundle.main.url(forResource: name, withExtension: ext)!, encoding: .utf8)
    }
    let assets = try Assets(
      script: read("reader", "js"),
      css: ReaderFontAsset.allCases.map(\.css).joined() + read("reader", "css"),
      annotations: read("annotations", "js"), desktopCSS: read("reader-mac", "css"),
      selection: read("reader-selection", "js"))
    cached = assets
    return assets
  }
  static func prepare(_ html: String, css: String) -> String {
    let style = "<style data-arctic-desktop>\(css)</style>"
    guard let head = html.range(of: "</head>", options: .caseInsensitive) else {
      return style + html
    }
    var prepared = html
    prepared.insert(contentsOf: style, at: head.lowerBound)
    return prepared
  }
  static func document(_ article: [String: String], css: String, source: URL) -> String {
    func escape(_ s: String) -> String {
      s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&#39;")
    }
    let title = escape(article["title"] ?? source.host ?? "Article")
    let image = article["image"] ?? ""
    let hero =
      image.isEmpty ? "" : "<figure class='hero'><img src='\(escape(image))' alt=''></figure>"
    return """
      <!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src arctic-font: data:;">
      <title>\(title)</title><style>\(css)</style></head><body><main>
      <header><div class='source'>\(escape(source.host ?? ""))</div><h1>\(title)</h1>
      <p class='subtitle'>\(escape(article["description"] ?? ""))</p>
      <div class='byline'>\(escape(article["author"] ?? ""))</div></header>\(hero)
      <article id='reader-content'>\(article["content"] ?? "")</article></main></body></html>
      """
  }
}

struct MacWebSurface: NSViewRepresentable {
  let webView: WKWebView
  func makeNSView(context: Context) -> NSView { MacWebContainer() }
  func updateNSView(_ container: NSView, context: Context) {
    guard webView.superview !== container else { return }
    for view in container.subviews { view.removeFromSuperview() }
    webView.removeFromSuperview()
    webView.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(webView)
    NSLayoutConstraint.activate([
      webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      webView.topAnchor.constraint(equalTo: container.topAnchor),
      webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
  }
}

extension ArticleStore {
  func article(for url: URL) -> SavedArticle? { articles.first { $0.url == url } }
}

private final class MacWebContainer: NSView {
  override var isFlipped: Bool { true }
}

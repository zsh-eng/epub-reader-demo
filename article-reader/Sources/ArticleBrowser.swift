import SwiftUI
import WebKit

enum ArticleRouting {
  static let domains: Set<String> = {
    guard let file = Bundle.main.url(forResource: "unwall-domains", withExtension: "json"),
      let data = try? Data(contentsOf: file),
      let domains = try? JSONDecoder().decode([String].self, from: data)
    else { return [] }
    return Set(domains)
  }()

  static func isUnwall(_ url: URL) -> Bool {
    let host = url.host?.lowercased() ?? ""
    return host == "unwall.app" || host.hasSuffix(".unwall.app")
  }

  static func original(_ url: URL) -> URL {
    guard isUnwall(url) else { return url }
    let path = String(url.path.dropFirst())
    guard path.contains(".") else { return url }
    let value = path.hasPrefix("http") ? path : "https://" + path
    let query = url.query.map { "?" + $0 } ?? ""
    return URL(string: value + query) ?? url
  }

  static func unwall(_ url: URL) -> URL {
    guard !isUnwall(url), ["https", "http"].contains(url.scheme ?? "") else { return url }
    return URL(string: "https://unwall.app/" + url.absoluteString) ?? url
  }

  static func automatic(_ url: URL) -> URL {
    guard !isUnwall(url), let host = url.host?.lowercased() else { return url }
    // Match hostname boundaries, never substrings such as nytimes.com.evil.test.
    let supported = domains.contains(host) || domains.contains(where: { host.hasSuffix("." + $0) })
    return supported ? unwall(url) : url
  }
}

/// Owns both WebViews for one cached article. Reader mode never replaces the live page,
/// so returning to the website preserves its history, scroll position and forms.
@MainActor @Observable final class ArticleBrowser: NSObject, WKNavigationDelegate, WKUIDelegate {
  let webView: WKWebView
  let readerView: WKWebView
  var isReader = false
  var readerReady = false
  var appearanceDescription = ""
  var darkAppearance = false
  private var wantsReader = false
  var isExtracting = false
  var isLoading = true
  var canGoBack = false
  var canGoForward = false
  var hasLoaded = false
  var errorMessage: String?
  var committedURL: URL?
  var currentURL: URL
  @ObservationIgnored private var observations: [NSKeyValueObservation] = []
  @ObservationIgnored private var pageVersion = 0
  @ObservationIgnored private var bypassRouting = false
  private(set) var isOpeningWebsite = false
  @ObservationIgnored private var extraction: (url: URL, html: String)?
  @ObservationIgnored private weak var store: ArticleStore?
  @ObservationIgnored private var downloadURL: URL

  init(url: URL, store: ArticleStore, downloadedFile: URL? = nil) {
    currentURL = url
    downloadURL = url
    self.store = store
    webView = WKWebView(frame: .zero)
    let configuration = WKWebViewConfiguration()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = false
    configuration.websiteDataStore = .nonPersistent()
    readerView = WKWebView(frame: .zero, configuration: configuration)
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    readerView.navigationDelegate = self
    for view in [webView, readerView] {
      view.isOpaque = false
      view.backgroundColor = .systemBackground
      view.scrollView.contentInsetAdjustmentBehavior = .never
      if #available(iOS 26.0, *) {
        view.scrollView.topEdgeEffect.style = .soft
        view.scrollView.bottomEdgeEffect.style = .soft
      }
    }
    observations = [
      webView.observe(\.canGoBack, options: [.new]) { [weak self] view, _ in
        Task { @MainActor in self?.canGoBack = view.canGoBack }
      },
      webView.observe(\.canGoForward, options: [.new]) { [weak self] view, _ in
        Task { @MainActor in self?.canGoForward = view.canGoForward }
      },
      webView.observe(\.isLoading, options: [.new]) { [weak self] view, _ in
        Task { @MainActor in self?.isLoading = view.isLoading }
      },
      webView.observe(\.url, options: [.new]) { [weak self] view, _ in
        Task { @MainActor in
          if let url = view.url, url.scheme != "file" { self?.currentURL = url }
        }
      },
    ]
    if let downloadedFile {
      isLoading = false
      hasLoaded = true
      wantsReader = true
      isReader = true
      readerView.loadFileURL(downloadedFile, allowingReadAccessTo: downloadedFile)
    } else {
      loadWebsite(url)
    }
  }

  private func loadWebsite(_ url: URL) {
    if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-articles-offline") {
      isOpeningWebsite = false
      errorMessage = "Offline test: website loading is disabled."
      return
    }
    if let fixture = TestMode.fixture(for: url) {
      webView.loadFileURL(fixture, allowingReadAccessTo: fixture.deletingLastPathComponent())
    } else {
      webView.load(URLRequest(url: ArticleRouting.automatic(url)))
    }
  }

  var sourceURL: URL { ArticleRouting.original(currentURL) }
  var libraryURL: URL { downloadURL }

  func back() {
    guard webView.canGoBack else { return }
    isReader = false
    webView.goBack()
  }
  func forward() {
    guard webView.canGoForward else { return }
    isReader = false
    webView.goForward()
  }
  func reload() {
    isReader = false
    if webView.url == nil { loadWebsite(sourceURL) } else { webView.reload() }
  }

  func openOriginal() {
    isReader = false
    bypassRouting = true
    webView.load(URLRequest(url: sourceURL))
  }

  func openUnwall() {
    isReader = false
    bypassRouting = false
    webView.load(URLRequest(url: ArticleRouting.unwall(sourceURL)))
  }

  func toggleReader() {
    if isReader {
      wantsReader = false
      if webView.url == nil {
        // A downloaded article opens without a publisher request. Keep its
        // rendered HTML visible until the user-requested website has loaded.
        isOpeningWebsite = true
        loadWebsite(sourceURL)
      } else if !isOpeningWebsite {
        isReader = false
      }
      return
    }
    wantsReader = true
    if readerReady {
      isReader = true
      return
    }
    prepareReader()
  }

  /// Prepare the cleaned page before a tap, without changing the visible mode.
  func prepareReader() {
    guard hasLoaded, !isExtracting, !readerReady else { return }
    isExtracting = true
    let version = pageVersion
    Task {
      do {
        let scriptURL = Bundle.main.url(forResource: "reader", withExtension: "js")!
        let script = try String(contentsOf: scriptURL, encoding: .utf8)
        // An isolated content world keeps our extraction API out of publisher scripts.
        _ = try await webView.evaluateJavaScript(script, in: nil, contentWorld: .defaultClient)
        let result = try await webView.evaluateJavaScript(
          "extractArticle()", in: nil, contentWorld: .defaultClient)
        guard version == pageVersion else { return }
        guard let article = result as? [String: String], let content = article["content"] else {
          throw ArticleError.message("This page could not be converted to Reader mode.")
        }
        let cssURL = Bundle.main.url(forResource: "reader", withExtension: "css")!
        let css = ReaderTheme.webFonts + (try String(contentsOf: cssURL, encoding: .utf8))
        let title = Self.escape(article["title"] ?? "Article")
        let author = Self.escape(article["author"] ?? "")
        let host = Self.escape(sourceURL.host ?? "")
        let subtitle = Self.escape(article["description"] ?? "")
        async let heroData = PreviewImageDisk.shared.dataURL(for: article["image"] ?? "")
        async let iconData = PreviewImageDisk.shared.dataURL(for: article["favicon"] ?? "")
        async let authorData = PreviewImageDisk.shared.dataURL(for: article["authorImage"] ?? "")
        let (hero, icon, portrait) = await (heroData, iconData, authorData)
        guard version == pageVersion else { return }
        let bodyContent = hero.isEmpty ? (article["originalContent"] ?? content) : content
        let identityImage = portrait.isEmpty ? icon : portrait
        let identity =
          identityImage.isEmpty ? "" : "<img class='avatar' src='\(identityImage)' alt=''>"
        let byline =
          author.isEmpty && identity.isEmpty
          ? "" : "<div class='byline'>\(identity)<span>\(author)</span></div>"
        let description = subtitle.isEmpty ? "" : "<p class='subtitle'>\(subtitle)</p>"
        let caption = Self.escape(article["heroCaption"] ?? "")
        let heroHTML =
          hero.isEmpty
          ? ""
          : "<figure class='hero'><img src='\(hero)' alt=''>\(caption.isEmpty ? "" : "<figcaption>\(caption)</figcaption>")</figure>"
        let html = """
          <!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src data:;">
          <title>\(title)</title><style>\(css)</style></head><body><main>
          <header><div class="source">\(host)</div><h1>\(title)</h1>\(description)\(byline)</header>\(heroHTML)
          <article id="reader-content">\(bodyContent)</article></main></body></html>
          """
        extraction = (downloadURL, html)
        persistExtraction(in: store)
        readerView.loadHTMLString(html, baseURL: nil)
      } catch {
        guard version == pageVersion else { return }
        isExtracting = false
        guard wantsReader else { return }
        wantsReader = false
        let detail = (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String
        errorMessage = detail ?? "Reader could not extract this page. Try Open original."
      }
    }
  }

  func persistExtraction(in store: ArticleStore?) {
    guard let store, let extraction else { return }
    Task { await store.saveReader(extraction.html, for: extraction.url) }
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    guard webView === self.webView else { return }
    // This initial website load belongs to the same downloaded article. Its
    // cached document remains valid and visible while the website prepares.
    if isOpeningWebsite { return }
    pageVersion += 1
    extraction = nil
    readerView.stopLoading()
    hasLoaded = false
    readerReady = false
    wantsReader = false
    isExtracting = false
    isReader = false
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    guard webView === self.webView, let url = webView.url else { return }
    if TestMode.enabled && url.isFileURL {
      currentURL = URL(
        string: "https://fixture.example/" + url.deletingPathExtension().lastPathComponent)!
    } else {
      currentURL = url
    }
    // Keep the saved URL for the initial document, even after a publisher
    // redirect. Later navigation belongs to the newly viewed article.
    if committedURL != nil { downloadURL = sourceURL }
    committedURL = sourceURL
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if webView === readerView {
      let version = pageVersion
      applyAppearance { [weak self] in
        guard let self, version == self.pageVersion else { return }
        self.readerReady = true
        self.isExtracting = false
        if self.wantsReader { self.isReader = true }
      }
      return
    }
    hasLoaded = true
    if isOpeningWebsite {
      isOpeningWebsite = false
      if !wantsReader { isReader = false }
      return
    }
    prepareReader()
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    report(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    report(error)
  }

  private func report(_ error: Error) {
    guard (error as NSError).code != NSURLErrorCancelled else { return }
    isOpeningWebsite = false
    errorMessage = error.localizedDescription
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }
    guard navigationAction.navigationType == .linkActivated else {
      decisionHandler(.allow)
      return
    }
    guard ["https", "http", "file", "about"].contains(url.scheme ?? "") else {
      decisionHandler(.cancel)
      return
    }
    if webView === readerView, ["https", "http"].contains(url.scheme ?? "") {
      decisionHandler(.cancel)
      isReader = false
      if bypassRouting { self.webView.load(URLRequest(url: url)) } else { loadWebsite(url) }
      return
    }
    if navigationAction.targetFrame?.isMainFrame == true, !bypassRouting {
      let routed = ArticleRouting.automatic(url)
      if routed != url {
        decisionHandler(.cancel)
        webView.load(URLRequest(url: routed))
        return
      }
    }
    decisionHandler(.allow)
  }

  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme ?? "") {
      webView.load(URLRequest(url: bypassRouting ? url : ArticleRouting.automatic(url)))
    }
    return nil
  }

  func applyAppearance(completion: (() -> Void)? = nil) {
    let defaults = UserDefaults.standard
    func setting(_ key: String, fallback: Double, range: ClosedRange<Double>) -> Double {
      let value = defaults.object(forKey: key) == nil ? fallback : defaults.double(forKey: key)
      return min(range.upperBound, max(range.lowerBound, value))
    }
    let size = setting("reader-size", fallback: 20, range: 16...30)
    let padding = setting("reader-padding", fallback: 18, range: 8...36)
    let leading = setting("reader-leading", fallback: 1.55, range: 1.25...1.95)
    let fonts = [
      "DM Sans": "'DM Sans', sans-serif", "System": "-apple-system, sans-serif",
      "EB Garamond": "'EB Garamond', serif", "Georgia": "Georgia, serif",
      "Palatino": "Palatino, serif",
    ]
    let family = fonts[defaults.string(forKey: "reader-font") ?? "System"] ?? fonts["System"]!
    let palette =
      ReadingPalette(rawValue: defaults.string(forKey: "reader-palette") ?? "System") ?? .system
    let theme = palette == .system ? (darkAppearance ? "Ink" : "White") : palette.rawValue
    // Serialize strings as JSON; never interpolate page-supplied values into script.
    let options: [String: Any] = [
      "size": size, "padding": padding, "leading": leading, "family": family, "theme": theme,
    ]
    let json = String(data: try! JSONSerialization.data(withJSONObject: options), encoding: .utf8)!
    let script = """
        const o = \(json), root = document.documentElement;
        root.dataset.theme = o.theme;
        root.style.setProperty('--reader-size', o.size + 'px');
        root.style.setProperty('--reader-padding', o.padding + 'px');
        root.style.setProperty('--reader-leading', o.leading);
        root.style.setProperty('--reader-font', o.family);
        await document.fonts.ready;
        const text = document.querySelector('#reader-content p') || document.getElementById('reader-content');
        const style = getComputedStyle(text);
        return style.fontFamily + ', ' + style.fontSize + ', ' + o.padding + 'px padding, ' + o.leading + ' spacing, ' + o.theme;
      """
    readerView.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .defaultClient) {
      [weak self] result in
      switch result {
      case .success(let value): self?.appearanceDescription = value as? String ?? ""
      case .failure(let error): self?.appearanceDescription = error.localizedDescription
      }
      completion?()
    }
  }

  func stop() {
    pageVersion += 1
    webView.stopLoading()
    readerView.stopLoading()
  }

  private static func escape(_ text: String) -> String {
    text.replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
  }
}

/// The web view fills the screen behind native bars. Content insets keep the
/// first and last lines reachable while the scroll edge can blur behind controls.
struct WebSurface: UIViewRepresentable {
  let webView: WKWebView
  let insets: EdgeInsets
  var isActive = true
  @Binding var nearEnd: Bool
  func makeCoordinator() -> Coordinator { Coordinator(nearEnd: $nearEnd, isActive: isActive) }
  func makeUIView(context: Context) -> WKWebView {
    webView.scrollView.delegate = context.coordinator
    updateInsets(webView)
    return webView
  }
  func updateUIView(_ uiView: WKWebView, context: Context) {
    context.coordinator.nearEnd = $nearEnd
    context.coordinator.isActive = isActive
    uiView.accessibilityElementsHidden = !isActive
    updateInsets(uiView)
  }

  /// Different enter/leave distances prevent the prompt's own height from
  /// repeatedly hiding and showing it. Loading a page alone never triggers it.
  final class Coordinator: NSObject, UIScrollViewDelegate {
    var nearEnd: Binding<Bool>
    var isActive: Bool
    init(nearEnd: Binding<Bool>, isActive: Bool) {
      self.nearEnd = nearEnd
      self.isActive = isActive
    }
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
      guard isActive else { return }
      guard scrollView.isDragging || scrollView.isDecelerating else { return }
      let bottom =
        scrollView.contentOffset.y + scrollView.bounds.height
        - scrollView.adjustedContentInset.bottom
      let remaining = scrollView.contentSize.height - bottom
      let next = remaining < (nearEnd.wrappedValue ? 280 : 140)
      guard next != nearEnd.wrappedValue else { return }
      nearEnd.wrappedValue = next
    }
  }

  private func updateInsets(_ view: WKWebView) {
    let scroll = view.scrollView
    let next = UIEdgeInsets(top: insets.top, left: 0, bottom: insets.bottom, right: 0)
    guard scroll.contentInset != next else { return }
    let atTop = scroll.contentOffset.y <= -scroll.contentInset.top + 1
    scroll.contentInset = next
    scroll.verticalScrollIndicatorInsets = next
    if atTop { scroll.contentOffset.y = -next.top }
  }
}

/// Keep two speculative pages plus the last opened page. Cache identity is the
/// requested URL; pages navigated elsewhere are not reused for the old link.
@MainActor @Observable final class BrowserPool {
  private var browsers: [URL: ArticleBrowser] = [:]
  private var active: URL?
  private var warmURLs: [URL] = []
  func open(_ url: URL, store: ArticleStore) -> ArticleBrowser {
    active = url
    trim()
    if let file = store.downloadedFile(for: url) {
      let browser = ArticleBrowser(url: url, store: store, downloadedFile: file)
      browsers[url]?.stop()
      browsers[url] = browser
      return browser
    }
    if let browser = browsers[url],
      browser.sourceURL == ArticleRouting.original(url)
    {
      return browser
    }
    let browser = ArticleBrowser(url: url, store: store)
    browsers[url] = browser
    return browser
  }
  func preload(_ urls: [URL], store: ArticleStore) async {
    warmURLs = Array(urls.prefix(2))
    trim()
    for url in warmURLs where browsers[url] == nil && store.downloadedFile(for: url) == nil {
      // Preview metadata and decoded cover take priority over speculative WebKit work.
      if let preview = try? await ArticlePreviewCache.shared.load(url) {
        for image in [preview.imageURL, preview.faviconURL].compactMap({ $0 }) {
          await ThumbnailCache.shared.load(image)
        }
      }
      guard !Task.isCancelled else { return }
      // Open may have created the browser while the preview was loading.
      guard browsers[url] == nil else { continue }
      // A durable Reader view needs no speculative publisher request.
      browsers[url] = ArticleBrowser(url: url, store: store)
    }
  }
  func persistExtractions(in store: ArticleStore) {
    for browser in browsers.values { browser.persistExtraction(in: store) }
  }
  private func trim() {
    let keep = Set(warmURLs + (active.map { [$0] } ?? []))
    for key in Array(browsers.keys) where !keep.contains(key) {
      browsers.removeValue(forKey: key)?.stop()
    }
  }
}

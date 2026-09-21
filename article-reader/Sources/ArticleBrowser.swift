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

/// Keep WebKit's selection and edit menu, but write Reader text through UIKit.
/// Copy uses the selected plain text directly, including on cached documents.
@MainActor private final class ReaderWebView: WKWebView {
  private var copyRequest = 0
  var annotate: ((Bool) -> Void)?

  override func buildMenu(with builder: UIMenuBuilder) {
    super.buildMenu(with: builder)
    let actions = UIMenu(
      options: .displayInline,
      children: [
        UIAction(title: "Highlight", image: UIImage(systemName: "highlighter")) { [weak self] _ in
          self?.annotate?(false)
        },
        UIAction(title: "Add note", image: UIImage(systemName: "square.and.pencil")) {
          [weak self] _ in
          self?.annotate?(true)
        },
      ])
    builder.insertSibling(actions, afterMenu: .standardEdit)
  }

  override func target(forAction action: Selector, withSender sender: Any?) -> Any? {
    if action == #selector(copy(_:)) { return self }
    return super.target(forAction: action, withSender: sender)
  }

  override func copy(_ sender: Any?) {
    copyRequest += 1
    let request = copyRequest
    let clipboardVersion = UIPasteboard.general.changeCount
    // The app's isolated world remains available with publisher scripts disabled.
    evaluateJavaScript("window.getSelection().toString()", in: nil, in: .defaultClient) {
      [weak self] result in
      guard let self, request == self.copyRequest,
        UIPasteboard.general.changeCount == clipboardVersion
      else { return }
      guard case .success(let value) = result, let text = value as? String, !text.isEmpty else {
        self.copyUsingWebKit(sender)
        return
      }
      UIPasteboard.general.string = text
    }
  }

  private func copyUsingWebKit(_ sender: Any?) { super.copy(sender) }
}

/// Avoid a content-controller retain cycle while accepting only app-world readiness.
@MainActor private final class ReaderReadyBridge: NSObject, WKScriptMessageHandler {
  weak var browser: ArticleBrowser?
  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard message.frameInfo.isMainFrame, let token = message.body as? String else { return }
    browser?.readerDocumentBecameReady(token, from: message.webView)
  }
}

/// Messages come only from the cleaned Reader's isolated content world.
@MainActor private final class ReaderAnnotationBridge: NSObject, WKScriptMessageHandler {
  weak var browser: ArticleBrowser?
  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard message.frameInfo.isMainFrame, let body = message.body as? [String: String],
      let token = body["token"]
    else { return }
    browser?.annotationTapped(body["id"], token: token, from: message.webView)
  }
}

#if DEBUG
  @MainActor @Observable final class PublisherLoadProbe {
    static let shared = PublisherLoadProbe()
    var started = 0
    private final class WeakHandler {
      weak var value: ReaderHeldImage?
      init(_ value: ReaderHeldImage) { self.value = value }
    }
    private var handlers: [WeakHandler] = []
    var active: Int { handlers.reduce(0) { $0 + ($1.value?.publisherTaskCount ?? 0) } }

    fileprivate func register(_ handler: ReaderHeldImage) {
      handlers.removeAll { $0.value == nil }
      if !handlers.contains(where: { $0.value === handler }) {
        handlers.append(WeakHandler(handler))
      }
      started += 1
    }
  }

  /// The first request fails through WebKit's real navigation delegate; retry
  /// serves bundled HTML. No publisher request or device network toggle is used.
  @MainActor private final class ReaderRecoveryFixture: NSObject, WKURLSchemeHandler {
    private var hasFailed = false
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
      guard hasFailed else {
        hasFailed = true
        task.didFailWithError(URLError(.notConnectedToInternet))
        return
      }
      guard let url = task.request.url,
        let original = URL(string: "https://fixture.example" + url.path),
        let fixture = TestMode.fixture(for: original), let data = try? Data(contentsOf: fixture)
      else {
        task.didFailWithError(URLError(.fileDoesNotExist))
        return
      }
      task.didReceive(
        URLResponse(
          url: url, mimeType: "text/html", expectedContentLength: data.count,
          textEncodingName: "UTF-8"))
      task.didReceive(data)
      task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
  }

  /// A held subresource lets UI tests distinguish DOM readiness from the load event.
  @MainActor private final class ReaderHeldImage: NSObject, WKURLSchemeHandler {
    private var publisherTasks = Set<ObjectIdentifier>()
    var publisherTaskCount: Int { publisherTasks.count }
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
      if urlSchemeTask.request.url?.host == "publisher-held" {
        publisherTasks.insert(ObjectIdentifier(urlSchemeTask))
        PublisherLoadProbe.shared.register(self)
      }
      urlSchemeTask.didReceive(
        URLResponse(
          url: urlSchemeTask.request.url!, mimeType: "image/png", expectedContentLength: -1,
          textEncodingName: nil))
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
      publisherTasks.remove(ObjectIdentifier(urlSchemeTask))
    }
  }
#endif

/// Owns both WebViews for one cached article. Reader mode never replaces the live page,
/// so returning to the website preserves its history, scroll position and forms.
@MainActor @Observable final class ArticleBrowser: NSObject, WKNavigationDelegate, WKUIDelegate {
  let webView: WKWebView
  let readerView: WKWebView
  var annotationPresentation: AnnotationPresentation?
  var noteDraft: ReaderNoteDraft?
  var selectedAnnotationID: UUID?
  @ObservationIgnored private var pendingAnnotationReveal: UUID?
  var unmatchedAnnotations: Set<String> = []
  #if DEBUG
    var annotationRenderState = "pending"
  #endif
  var annotations: [ReaderAnnotation] { AnnotationStore.shared.annotations(for: libraryURL) }
  var isReader = false
  var readerReady = false
  private var renderedAppearance = ""
  var appearanceDescription: String {
    get {
      #if DEBUG
        if TestMode.enabled {
          return renderedAppearance
            + (testArtworkHeld ? ", artwork held" : "")
            + (ProcessInfo.processInfo.arguments.contains("-hold-publisher-image")
              && webView.isLoading ? ", publisher resource pending" : "")
            + (ProcessInfo.processInfo.arguments.contains("-hold-reader-body-image")
              && readerView.isLoading ? ", resource load pending" : "")
        }
      #endif
      return renderedAppearance
    }
    set { renderedAppearance = newValue }
  }
  #if DEBUG
    private var testArtworkHeld = false
  #endif
  var darkAppearance = false
  private var wantsReader = false
  var isExtracting = false
  var isLoading = true
  var canGoBack = false
  var canGoForward = false
  var hasLoaded = false
  var errorMessage: String?
  private(set) var websiteFailure: String?
  @ObservationIgnored private var requestedWebsiteURL: URL?
  @ObservationIgnored private var failedWebsiteURL: URL?
  var committedURL: URL?
  var currentURL: URL
  @ObservationIgnored private var observations: [NSKeyValueObservation] = []
  @ObservationIgnored private var pageVersion = 0
  @ObservationIgnored private var readerNavigation: WKNavigation?
  @ObservationIgnored private var websiteNavigation: WKNavigation?
  @ObservationIgnored private var websiteReady = false
  @ObservationIgnored private var bypassRouting = false
  private(set) var isOpeningWebsite = false
  /// The URL requested by the library is stable across initial publisher redirects.
  /// Following another article clears it, so the pool cannot reuse the wrong page.
  private(set) var cacheIdentity: URL?
  @ObservationIgnored private var extractionTask: Task<Void, Never>?
  @ObservationIgnored private var decorationTask: Task<Void, Never>?
  @ObservationIgnored private var persistenceTask: Task<Void, Never>?
  @ObservationIgnored private var readerDocumentToken = ""
  @ObservationIgnored private var preparingReaderAppearance = false
  @ObservationIgnored private var appearanceVersion = 0
  @ObservationIgnored private var extraction: (url: URL, html: String)?
  @ObservationIgnored private weak var store: ArticleStore?
  @ObservationIgnored private var downloadURL: URL
  @ObservationIgnored private var cachedLoadTask: Task<Void, Never>?

  init(url: URL, store: ArticleStore, downloadedFile: URL? = nil) {
    currentURL = url
    cacheIdentity = url
    downloadURL = url
    self.store = store
    let websiteConfiguration = WKWebViewConfiguration()
    #if DEBUG
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-website-recovery") {
        websiteConfiguration.setURLSchemeHandler(
          ReaderRecoveryFixture(), forURLScheme: "arctic-recovery")
      }
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-hold-publisher-image") {
        websiteConfiguration.setURLSchemeHandler(ReaderHeldImage(), forURLScheme: "arctic-test")
      }
    #endif
    webView = WKWebView(frame: .zero, configuration: websiteConfiguration)
    let configuration = WKWebViewConfiguration()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = false
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(ReaderFontScheme(), forURLScheme: "arctic-font")
    #if DEBUG
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-hold-reader-body-image") {
        configuration.setURLSchemeHandler(ReaderHeldImage(), forURLScheme: "arctic-test")
      }
    #endif
    readerView = ReaderWebView(frame: .zero, configuration: configuration)
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    readerView.navigationDelegate = self
    let readyBridge = ReaderReadyBridge()
    readyBridge.browser = self
    readerView.configuration.userContentController.add(
      readyBridge, contentWorld: .defaultClient, name: "arcticReaderReady")
    let annotationBridge = ReaderAnnotationBridge()
    annotationBridge.browser = self
    readerView.configuration.userContentController.add(
      annotationBridge, contentWorld: .defaultClient, name: "arcticAnnotationTap")
    (readerView as? ReaderWebView)?.annotate = { [weak self] withNote in
      self?.annotateSelection(withNote: withNote)
    }
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
          if let url = view.url, !["file", "arctic-recovery"].contains(url.scheme ?? "") {
            self?.currentURL = url
          }
        }
      },
    ]
    if let downloadedFile {
      isExtracting = true
      isLoading = false
      hasLoaded = true
      wantsReader = true
      isReader = true
      let version = pageVersion
      cachedLoadTask = Task { [weak self] in
        do {
          // Existing saved documents predate the charset declaration. Declare
          // their known encoding at load time instead of letting WebKit guess.
          var bytes = try await Task.detached {
            try Data(contentsOf: downloadedFile)
          }.value
          #if DEBUG
            if TestMode.enabled
              && ProcessInfo.processInfo.arguments.contains("-hold-reader-body-image")
            {
              let html = String(decoding: bytes, as: UTF8.self)
                .replacingOccurrences(
                  of: "img-src https: http: data:;",
                  with: "img-src https: http: data: arctic-test:;"
                )
                .replacingOccurrences(
                  of: "</article>",
                  with: "<img src='arctic-test://held' width='1' height='1' alt=''></article>")
              bytes = Data(html.utf8)
            }
          #endif
          guard let self, !Task.isCancelled, version == self.pageVersion else { return }
          self.prepareReaderReadiness()
          self.readerNavigation = self.readerView.load(
            bytes, mimeType: "text/html", characterEncodingName: "UTF-8",
            baseURL: downloadedFile.deletingLastPathComponent())
        } catch {
          guard let self, !Task.isCancelled, version == self.pageVersion else { return }
          self.isExtracting = false
          self.errorMessage = "Could not open the downloaded article: " + error.localizedDescription
        }
      }
    } else {
      loadWebsite(url)
    }
  }

  private func loadWebsite(_ url: URL) {
    requestedWebsiteURL = ArticleRouting.original(url)
    websiteFailure = nil
    failedWebsiteURL = nil
    errorMessage = nil
    isLoading = true
    if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-articles-offline") {
      failWebsite(URLError(.notConnectedToInternet))
      return
    }
    if let fixture = TestMode.fixture(for: url) {
      #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-test-website-recovery") {
          let recovery = URL(string: "arctic-recovery://fixture.example" + url.path)!
          webView.load(URLRequest(url: recovery))
          return
        }
        if ProcessInfo.processInfo.arguments.contains("-hold-publisher-image"),
          let html = try? String(contentsOf: fixture, encoding: .utf8)
        {
          // A never-finishing image outside the article distinguishes publisher
          // DOM readiness from didFinish without delaying Reader's own resources.
          webView.loadHTMLString(
            html.replacingOccurrences(
              of: "</body>",
              with: "<img src='arctic-test://publisher-held' width='1' height='1' alt=''></body>"),
            baseURL: fixture)
          return
        }
      #endif
      webView.loadFileURL(fixture, allowingReadAccessTo: fixture.deletingLastPathComponent())
    } else {
      webView.load(URLRequest(url: bypassRouting ? url : ArticleRouting.automatic(url)))
    }
  }

  var sourceURL: URL { ArticleRouting.original(currentURL) }
  var libraryURL: URL { downloadURL }

  func back() {
    guard webView.canGoBack else { return }
    cacheIdentity = nil
    selectWebsite()
    webView.goBack()
  }
  func forward() {
    guard webView.canGoForward else { return }
    cacheIdentity = nil
    selectWebsite()
    webView.goForward()
  }
  func reload() {
    let url = failedWebsiteURL ?? requestedWebsiteURL ?? sourceURL
    if readerReady {
      // Keep a valid Reader visible while a requested website refresh runs.
      wantsReader = false
      isOpeningWebsite = true
    } else {
      selectWebsite()
    }
    // Reload a real request, not WebKit's empty/failed provisional history item.
    loadWebsite(url)
  }

  func retryFailedWebsite() {
    guard failedWebsiteURL != nil else { return }
    reload()
  }

  /// A pooled failure is not a useful warm document. Reopen retries its exact
  /// request, even when the earlier error UI has been dismissed.
  func retryFailedWebsiteOnOpen() {
    guard websiteFailure != nil, !readerReady else { return }
    retryFailedWebsite()
  }

  func openOriginal() {
    selectWebsite()
    bypassRouting = true
    webView.load(URLRequest(url: sourceURL))
  }

  func openUnwall() {
    selectWebsite()
    bypassRouting = false
    webView.load(URLRequest(url: ArticleRouting.unwall(sourceURL)))
  }

  func toggleReader() {
    if isReader {
      wantsReader = false
      if !websiteReady {
        // A downloaded article opens without a publisher request. Keep its
        // rendered HTML visible until the user-requested website has loaded.
        isOpeningWebsite = true
        loadWebsite(sourceURL)
      } else if !isOpeningWebsite {
        isReader = false
      }
      return
    }
    showReader()
  }

  /// Reuse prepared HTML and its scroll position when reopening a saved article.
  func showReader() {
    wantsReader = true
    if readerReady {
      isReader = true
      return
    }
    prepareReader()
  }

  private func selectWebsite() {
    wantsReader = false
    isOpeningWebsite = false
    isReader = false
  }

  /// Prepare the cleaned page before a tap, without changing the visible mode.
  func prepareReader() {
    guard hasLoaded, !isExtracting, !readerReady else { return }
    isExtracting = true
    let version = pageVersion
    extractionTask?.cancel()
    extractionTask = Task { [weak self] in
      guard let self else { return }
      do {
        let scriptURL = Bundle.main.url(forResource: "reader", withExtension: "js")!
        let script = try await Task.detached { try String(contentsOf: scriptURL, encoding: .utf8) }
          .value
        guard !Task.isCancelled, version == pageVersion else { return }
        _ = try await webView.evaluateJavaScript(script, in: nil, contentWorld: .defaultClient)
        let result = try await webView.evaluateJavaScript(
          "extractArticle()", in: nil, contentWorld: .defaultClient)
        guard !Task.isCancelled, version == pageVersion else { return }
        guard let article = result as? [String: String], article["content"] != nil else {
          throw ArticleError.message("This page could not be converted to Reader mode.")
        }
        let cssURL = Bundle.main.url(forResource: "reader", withExtension: "css")!
        let css = try await Task.detached {
          ReaderTheme.webFonts + (try String(contentsOf: cssURL, encoding: .utf8))
        }.value
        // Disk hits are cheap and local. Remote decorations must not hold Reader text.
        async let hero = PreviewImageDisk.shared.cachedDataURL(for: article["image"] ?? "")
        async let icon = PreviewImageDisk.shared.cachedDataURL(for: article["favicon"] ?? "")
        async let portrait = PreviewImageDisk.shared.cachedDataURL(
          for: article["authorImage"] ?? "")
        var media = await ReaderMedia(hero: hero, icon: icon, portrait: portrait)
        #if DEBUG
          if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-hold-reader-artwork")
          {
            media = ReaderMedia(hero: "", icon: "", portrait: "")
          }
        #endif
        guard !Task.isCancelled, version == pageVersion else { return }
        let host = sourceURL.host ?? ""
        let html = Self.readerHTML(article: article, css: css, host: host, media: media)
        extraction = (downloadURL, html)
        persistExtraction(in: store)
        prepareReaderReadiness()
        readerNavigation = readerView.loadHTMLString(html, baseURL: nil)
        hydrateDecorations(article: article, css: css, host: host, initial: media, version: version)
      } catch {
        guard !Task.isCancelled, version == pageVersion else { return }
        isExtracting = false
        guard wantsReader else { return }
        wantsReader = false
        let detail = (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String
        errorMessage = detail ?? "Reader could not extract this page. Try Open original."
      }
    }
  }

  private struct ReaderMedia: Equatable {
    var hero: String
    var icon: String
    var portrait: String
  }

  private static func readerHTML(
    article: [String: String], css: String, host: String, media: ReaderMedia
  ) -> String {
    let title = escape(article["title"] ?? "Article")
    let author = escape(article["author"] ?? "")
    let subtitle = escape(article["description"] ?? "")
    let hasHero = !(article["image"] ?? "").isEmpty
    let hasAvatar = !(article["authorImage"] ?? "").isEmpty || !(article["favicon"] ?? "").isEmpty
    let identity = media.portrait.isEmpty ? media.icon : media.portrait
    let avatar =
      hasAvatar
      ? """
      <img id='reader-avatar' class='avatar' \(identity.isEmpty ? "" : "src='\(identity)'") alt='' style='background:var(--muted)'
      data-arctic-icon="\(escape(article["favicon"] ?? ""))" data-arctic-portrait="\(escape(article["authorImage"] ?? ""))">
      """
      : ""
    let byline =
      author.isEmpty && !hasAvatar
      ? "" : "<div class='byline'>\(avatar)<span>\(author)</span></div>"
    let description = subtitle.isEmpty ? "" : "<p class='subtitle'>\(subtitle)</p>"
    let caption = escape(article["heroCaption"] ?? "")
    let width = max(1, Double(article["heroWidth"] ?? "") ?? 16)
    let height = max(1, Double(article["heroHeight"] ?? "") ?? 9)
    let hero =
      hasHero
      ? """
      <figure class='hero'><div style='aspect-ratio:\(width)/\(height);background:var(--muted);overflow:hidden'>
      <img id='reader-hero' data-arctic-source="\(escape(article["image"] ?? ""))" \(media.hero.isEmpty ? "" : "src='\(media.hero)'") alt='' style='display:block;width:100%;height:100%;object-fit:cover'></div>
      \(caption.isEmpty ? "" : "<figcaption>\(caption)</figcaption>")</figure>
      """ : ""
    return """
      <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src data: arctic-font:;">
      <title>\(title)</title><style>\(css)</style></head><body><main>
      <header><div class="source">\(escape(host))</div><h1>\(title)</h1>\(description)\(byline)</header>\(hero)
      <article id="reader-content">\(article["content"] ?? "")</article></main></body></html>
      """
  }

  /// This task belongs to the document, not the pool. Leaving the viewport or
  /// navigating cancels its consumer leases in the shared image pipeline.
  private func hydrateDecorations(
    article: [String: String], css: String, host: String, initial: ReaderMedia, version: Int
  ) {
    loadReaderMedia(
      sources: [
        "hero": article["image"] ?? "", "icon": article["favicon"] ?? "",
        "portrait": article["authorImage"] ?? "",
      ],
      initial: initial, version: version
    ) { [weak self] media in
      guard let self, media != initial else { return }
      self.extraction = (
        self.downloadURL, Self.readerHTML(article: article, css: css, host: host, media: media)
      )
      self.persistExtraction(in: self.store)
    }
  }

  private func loadReaderMedia(
    sources: [String: String], initial: ReaderMedia, version: Int,
    completion: @escaping (ReaderMedia) -> Void
  ) {
    decorationTask?.cancel()
    decorationTask = Task { [weak self] in
      #if DEBUG
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-hold-reader-artwork") {
          self?.testArtworkHeld = true
          // An unyielding stream is a deterministic held response. Cancellation
          // ends iteration immediately; this is not a timing-based test delay.
          let (stream, continuation) = AsyncStream<Void>.makeStream()
          for await _ in stream {}
          withExtendedLifetime(continuation) {}
          if self?.pageVersion == version { self?.testArtworkHeld = false }
          return
        }
      #endif
      var media = initial
      await withTaskGroup(of: (String, String).self) { group in
        for (key, url) in sources where !url.isEmpty {
          group.addTask { (key, await PreviewImageDisk.shared.dataURL(for: url)) }
        }
        for await (key, bytes) in group {
          guard let self, !Task.isCancelled, self.pageVersion == version else {
            group.cancelAll()
            return
          }
          guard !bytes.isEmpty else { continue }
          switch key {
          case "hero": media.hero = bytes
          case "icon": media.icon = bytes
          case "portrait": media.portrait = bytes
          default: continue
          }
          self.pendingReaderMedia = media
          if self.readerReady { self.applyReaderMedia() }
        }
      }
      guard let self, !Task.isCancelled, self.pageVersion == version else { return }
      completion(media)
    }
  }

  /// A document saved before its media completed can resume those decorations.
  /// Existing embedded images need no work; a cancelled import does not leave a
  /// permanently empty hero on the next open.
  private func hydrateCachedDecorations() {
    let version = pageVersion
    readerView.callAsyncJavaScript(
      """
      const hero = document.getElementById('reader-hero'), avatar = document.getElementById('reader-avatar');
      return {
        hero: hero && !hero.getAttribute('src') ? hero.dataset.arcticSource || '' : '',
        icon: avatar && !avatar.getAttribute('src') ? avatar.dataset.arcticIcon || '' : '',
        portrait: avatar && !avatar.getAttribute('src') ? avatar.dataset.arcticPortrait || '' : ''
      };
      """, arguments: [:], in: nil, in: .defaultClient
    ) { [weak self] result in
      guard let self, self.pageVersion == version,
        case .success(let value) = result, let sources = value as? [String: String],
        sources.values.contains(where: { !$0.isEmpty })
      else { return }
      self.loadReaderMedia(
        sources: sources, initial: ReaderMedia(hero: "", icon: "", portrait: ""), version: version
      ) { _ in }
    }
  }

  @ObservationIgnored private var pendingReaderMedia: ReaderMedia?
  private func applyReaderMedia() {
    guard let media = pendingReaderMedia else { return }
    pendingReaderMedia = nil
    readerView.callAsyncJavaScript(
      "for (const [id, src] of Object.entries(images)) { const image = document.getElementById(id); if (image && src) image.src = src; }",
      arguments: [
        "images": [
          "reader-hero": media.hero,
          "reader-avatar": media.portrait.isEmpty ? media.icon : media.portrait,
        ]
      ],
      in: nil, in: .defaultClient
    ) { _ in }
  }

  private func prepareReaderReadiness() {
    readerDocumentToken = UUID().uuidString
    preparingReaderAppearance = false
    let controller = readerView.configuration.userContentController
    controller.removeAllUserScripts()
    controller.addUserScript(
      WKUserScript(
        source:
          "window.webkit.messageHandlers.arcticReaderReady.postMessage('\(readerDocumentToken)');",
        injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
  }

  /// DOM readiness does not wait for remote body images or other load events.
  fileprivate func readerDocumentBecameReady(_ token: String, from view: WKWebView?) {
    guard view === readerView, token == readerDocumentToken,
      readerNavigation != nil, !readerReady, !preparingReaderAppearance
    else { return }
    preparingReaderAppearance = true
    let version = pageVersion
    applyAppearance { [weak self] in
      guard let self, version == self.pageVersion, token == self.readerDocumentToken else { return }
      self.installAnnotations()
      self.readerReady = true
      self.isExtracting = false
      self.applyReaderMedia()
      if self.decorationTask == nil { self.hydrateCachedDecorations() }
      if self.wantsReader { self.isReader = true }
    }
  }

  func persistExtraction(in store: ArticleStore?) {
    guard let store, let extraction else { return }
    persistenceTask?.cancel()
    let version = pageVersion
    persistenceTask = Task { [weak self] in
      guard let self, !Task.isCancelled, self.pageVersion == version else { return }
      await store.saveReader(extraction.html, for: extraction.url)
    }
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    guard webView === self.webView else { return }
    websiteNavigation = navigation
    websiteFailure = nil
    failedWebsiteURL = nil
    websiteReady = false
    // This initial website load belongs to the same downloaded article. Its
    // cached document remains valid and visible while the website prepares.
    if isOpeningWebsite { return }
    pageVersion += 1
    extractionTask?.cancel()
    decorationTask?.cancel()
    persistenceTask?.cancel()
    pendingReaderMedia = nil
    readerDocumentToken = ""
    extraction = nil
    readerNavigation = nil
    readerView.stopLoading()
    hasLoaded = false
    readerReady = false
    wantsReader = false
    isExtracting = false
    isReader = false
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    guard webView === self.webView, navigation === websiteNavigation, let url = webView.url else {
      return
    }
    if TestMode.enabled && url.scheme == "arctic-recovery" {
      currentURL = requestedWebsiteURL ?? currentURL
    } else if TestMode.enabled && url.isFileURL {
      currentURL = URL(
        string: "https://fixture.example/" + url.deletingPathExtension().lastPathComponent)!
    } else {
      currentURL = url
    }
    // Keep the saved URL for the initial document, even after a publisher
    // redirect. Later navigation belongs to the newly viewed article.
    if let previous = committedURL, previous != sourceURL {
      downloadURL = sourceURL
      cacheIdentity = nil
    }
    committedURL = sourceURL
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if webView === readerView {
      guard navigation === readerNavigation else { return }
      // Fallback for documents whose ready message was interrupted.
      readerDocumentBecameReady(readerDocumentToken, from: webView)
      return
    }
    guard navigation === websiteNavigation else { return }
    websiteReady = true
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
    report(error, from: webView, navigation: navigation)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    report(error, from: webView, navigation: navigation)
  }

  private func report(_ error: Error, from view: WKWebView, navigation: WKNavigation?) {
    guard (error as NSError).code != NSURLErrorCancelled else { return }
    if view === webView {
      guard navigation === websiteNavigation else { return }
      failWebsite(error)
      return
    } else {
      guard navigation === readerNavigation else { return }
      isExtracting = false
    }
    errorMessage = error.localizedDescription
  }

  private func failWebsite(_ error: Error) {
    failedWebsiteURL = requestedWebsiteURL ?? sourceURL
    websiteFailure = error.localizedDescription
    websiteReady = false
    isOpeningWebsite = false
    isLoading = false
    hasLoaded = readerReady
    if readerReady { isReader = true }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }
    if webView === self.webView, navigationAction.targetFrame?.isMainFrame == true,
      ["https", "http"].contains(url.scheme ?? "")
    {
      requestedWebsiteURL = ArticleRouting.original(url)
    }
    if navigationAction.navigationType == .linkActivated { cacheIdentity = nil }
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
      selectWebsite()
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
        const text = document.querySelector('#reader-content p') || document.getElementById('reader-content');
        const style = getComputedStyle(text);
        return {
          description: style.fontFamily + ', ' + style.fontSize + ', ' + o.padding + 'px padding, ' + o.leading + ' spacing, ' + o.theme,
          font: style.fontSize + ' ' + style.fontFamily
        };
      """
    appearanceVersion += 1
    let appearance = appearanceVersion
    let page = pageVersion
    readerView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .defaultClient) {
      [weak self] result in
      guard let self, self.appearanceVersion == appearance, self.pageVersion == page else { return }
      switch result {
      case .success(let value):
        let details = value as? [String: String] ?? [:]
        self.appearanceDescription = details["description"] ?? ""
        // Text readiness ends with applying styles. Font bytes never hold the
        // document; font-display: swap allows the native fallback immediately.
        completion?()
        #if DEBUG
          if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-reader-fonts"),
            let font = details["font"], let description = details["description"]
          {
            self.verifyReaderFont(
              font, description: description, appearance: appearance, page: page)
          }
        #endif
      case .failure(let error):
        self.appearanceDescription = error.localizedDescription
        completion?()
      }
    }
  }

  #if DEBUG
    /// A diagnostic verifies actual FontFace completion, rather than mistaking a
    /// computed family name for a successfully loaded font. It never gates text.
    private func verifyReaderFont(_ font: String, description: String, appearance: Int, page: Int) {
      readerView.callAsyncJavaScript(
        """
        const faces = await document.fonts.load(font);
        return faces.filter(face => face.status === 'loaded').map(face => face.family.replaceAll('"', '').replaceAll("'", '')).join(', ');
        """, arguments: ["font": font], in: nil, in: .defaultClient
      ) { [weak self] result in
        guard let self, self.appearanceVersion == appearance, self.pageVersion == page else {
          return
        }
        switch result {
        case .success(let value):
          self.appearanceDescription = description + ", loaded fonts: " + (value as? String ?? "")
        case .failure(let error):
          self.appearanceDescription = description + ", font failed: " + error.localizedDescription
        }
      }
    }
  #endif

  /// App-only scripts keep publisher JavaScript disabled and never alter cached HTML.
  private func installAnnotations() {
    guard let url = Bundle.main.url(forResource: "annotations", withExtension: "js"),
      let script = try? String(contentsOf: url, encoding: .utf8)
    else { return }
    readerView.evaluateJavaScript(script, in: nil, in: .defaultClient) { [weak self] result in
      guard case .success = result else { return }
      self?.refreshAnnotations()
      #if DEBUG
        self?.prepareLongAnnotationFixture()
      #endif
    }
  }

  #if DEBUG
    /// Seed a real quote from bundled HTML to exercise a long scrolling quote
    /// without relying on platform-dependent native selection handle gestures.
    private func prepareLongAnnotationFixture() {
      guard TestMode.enabled,
        ProcessInfo.processInfo.arguments.contains("-test-long-annotation"), annotations.isEmpty
      else { return }
      let token = readerDocumentToken
      readerView.evaluateJavaScript(
        """
        (() => {
          const paragraph = [...document.querySelectorAll('#reader-content p')]
            .find(p => p.textContent.startsWith('There is a particular pleasure'));
          if (!paragraph) return null;
          const range = document.createRange(); range.selectNodeContents(paragraph);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          const quote = globalThis.arcticAnnotations.selection(); selection.removeAllRanges();
          return quote;
        })()
        """, in: nil, in: .defaultClient
      ) { [weak self] result in
        guard let self, self.readerDocumentToken == token,
          case .success(let value) = result, let selection = value as? [String: Any],
          let data = try? JSONSerialization.data(withJSONObject: selection),
          let quote = try? JSONDecoder().decode(ReaderQuote.self, from: data)
        else { return }
        do {
          let annotation = try AnnotationStore.shared.highlight(quote, in: self.libraryURL)
          try AnnotationStore.shared.updateNote("Keep the whole passage.", id: annotation.id)
          self.refreshAnnotations()
          self.annotationPresentation = AnnotationPresentation(editing: annotation.id)
        } catch { self.errorMessage = error.localizedDescription }
      }
    }
  #endif

  func refreshAnnotations() {
    guard let data = try? JSONEncoder().encode(annotations),
      let json = String(data: data, encoding: .utf8)
    else { return }
    let token = readerDocumentToken
    var script = "return globalThis.arcticAnnotations?.render(JSON.parse(records), token) || [];"
    #if DEBUG
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-annotation-render") {
        // Read the rendered registry, not the native records. A passing storage
        // assertion alone does not prove that WebKit removed the visible paint.
        script = """
          const missing = globalThis.arcticAnnotations?.render(JSON.parse(records), token) || [];
          let painted = 0;
          for (const [name, ranges] of (globalThis.CSS?.highlights || [])) {
            if (name.startsWith('arctic-')) painted += ranges.size;
          }
          return { missing, painted, marks: document.querySelectorAll('mark[data-arctic-highlight]').length,
            selected: window.getSelection()?.toString().length || 0 };
          """
      }
    #endif
    readerView.callAsyncJavaScript(
      script, arguments: ["records": json, "token": token], in: nil, in: .defaultClient
    ) { [weak self] result in
      guard let self, self.readerDocumentToken == token else { return }
      var missing: [String]?
      if case .success(let value) = result { missing = value as? [String] }
      #if DEBUG
        if case .success(let value) = result, let rendered = value as? [String: Any] {
          missing = rendered["missing"] as? [String]
          self.annotationRenderState =
            "painted=\(rendered["painted"] ?? "?"); marks=\(rendered["marks"] ?? "?"); selected=\(rendered["selected"] ?? "?")"
        } else if case .failure(let error) = result {
          self.annotationRenderState = "error: " + error.localizedDescription
        }
      #endif
      if let ids = missing {
        self.unmatchedAnnotations = Set(ids)
        if let pending = self.pendingAnnotationReveal {
          self.pendingAnnotationReveal = nil
          self.revealAnnotation(pending)
        }
      }
    }
  }

  private func annotateSelection(withNote: Bool) {
    guard isReader, readerReady else { return }
    let url = libraryURL
    let version = pageVersion
    readerView.evaluateJavaScript(
      "globalThis.arcticAnnotations?.selection()", in: nil, in: .defaultClient
    ) { [weak self] result in
      guard let self, self.pageVersion == version, self.libraryURL == url,
        case .success(let value) = result, let selection = value as? [String: Any],
        let data = try? JSONSerialization.data(withJSONObject: selection),
        let quote = try? JSONDecoder().decode(ReaderQuote.self, from: data)
      else { return }
      do {
        let annotation = try AnnotationStore.shared.highlight(quote, in: url)
        self.readerView.evaluateJavaScript(
          "window.getSelection().removeAllRanges()", in: nil, in: .defaultClient
        ) { _ in }
        self.selectedAnnotationID = annotation.id
        self.refreshAnnotations()
        UISelectionFeedbackGenerator().selectionChanged()
        if withNote { self.beginNote(annotation: annotation) }
      } catch { self.errorMessage = "Could not save passage: " + error.localizedDescription }
    }
  }

  func beginNote(annotation: ReaderAnnotation? = nil) {
    selectedAnnotationID = nil
    noteDraft = ReaderNoteDraft(annotation: annotation)
  }

  fileprivate func annotationTapped(_ value: String?, token: String, from view: WKWebView?) {
    guard view === readerView, isReader, readerReady, !token.isEmpty,
      token == readerDocumentToken
    else { return }
    guard let value, let id = UUID(uuidString: value),
      annotations.contains(where: { $0.id == id })
    else {
      selectedAnnotationID = nil
      return
    }
    selectedAnnotationID = id
    UISelectionFeedbackGenerator().selectionChanged()
  }

  func revealAnnotation(_ id: UUID) {
    guard annotations.first(where: { $0.id == id })?.quote != nil else {
      pendingAnnotationReveal = nil
      selectedAnnotationID = nil
      showReader()
      return
    }
    pendingAnnotationReveal = id
    showReader()
    guard readerReady else { return }
    let token = readerDocumentToken
    readerView.callAsyncJavaScript(
      "return globalThis.arcticAnnotations?.reveal(id) || false;",
      arguments: ["id": id.uuidString], in: nil, in: .defaultClient
    ) { [weak self] result in
      guard let self, self.readerDocumentToken == token else { return }
      if case .success(let value) = result, value as? Bool == true {
        self.pendingAnnotationReveal = nil
        self.selectedAnnotationID = id
      }
    }
  }

  func stop() {
    pageVersion += 1
    cachedLoadTask?.cancel()
    cachedLoadTask = nil
    extractionTask?.cancel()
    decorationTask?.cancel()
    extractionTask = nil
    decorationTask = nil
    persistenceTask?.cancel()
    persistenceTask = nil
    pendingReaderMedia = nil
    readerDocumentToken = ""
    readerNavigation = nil
    websiteNavigation = nil
    isOpeningWebsite = false
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
  var isActive: () -> Bool = { true }
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
    uiView.accessibilityElementsHidden = !isActive()
    updateInsets(uiView)
  }

  static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
    if uiView.scrollView.delegate === coordinator { uiView.scrollView.delegate = nil }
  }

  /// Different enter/leave distances prevent the prompt's own height from
  /// repeatedly hiding and showing it. Loading a page alone never triggers it.
  final class Coordinator: NSObject, UIScrollViewDelegate {
    var nearEnd: Binding<Bool>
    var isActive: () -> Bool
    init(nearEnd: Binding<Bool>, isActive: @escaping () -> Bool) {
      self.nearEnd = nearEnd
      self.isActive = isActive
    }
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
      guard isActive() else { return }
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

/// Prepare the viewport and nearby rows before a tap. Cached HTML is loaded and
/// styled in its retained WebKit view; the last opened browser stays alive too.
/// Two preparation slots limit new work so scrolling keeps priority.
@MainActor @Observable final class BrowserPool {
  private var browsers: [URL: ArticleBrowser] = [:]
  private var active: URL?
  private var warmURLs: [URL] = []
  @ObservationIgnored private var preloadVersion = 0
  private(set) var lastOpenState = ""
  #if DEBUG
    var retainedBrowserCount: Int { browsers.count }
    var backgroundRetainedCount = -1
  #endif
  var readyReaderURLs: [URL] {
    browsers.filter { $0.value.readerReady }.map(\.key)
  }

  func open(_ url: URL, store: ArticleStore) -> ArticleBrowser {
    let began = CFAbsoluteTimeGetCurrent()
    active = url
    trim()
    // Reuse the in-flight preparation too. Never replace it with another WebView
    // just because the user taps before fonts or local HTML have finished loading.
    if let browser = browsers[url], browser.cacheIdentity == url {
      lastOpenState = browser.readerReady ? "prepared" : "preparing"
      browser.retryFailedWebsiteOnOpen()
      if store.articles.contains(where: { $0.url == url && $0.saved && $0.downloadedAt != nil }) {
        browser.showReader()
      }
      recordOpen(since: began)
      return browser
    }
    browsers[url]?.stop()
    let browser = ArticleBrowser(
      url: url, store: store, downloadedFile: store.downloadedFile(for: url))
    browsers[url] = browser
    lastOpenState = "cold"
    recordOpen(since: began)
    return browser
  }

  func preload(_ urls: [URL], store: ArticleStore) async {
    preloadVersion += 1
    let version = preloadVersion
    // Opening Reader cancels the queue; keep its neighbors for an immediate Back.
    guard !urls.isEmpty else { return }
    var seen = Set<URL>()
    warmURLs = Array(urls.filter { seen.insert($0).inserted }.prefix(10))
    trim()
    let local = warmURLs.filter { store.downloadedFile(for: $0) != nil }
    let ordered = local + warmURLs.filter { !local.contains($0) }
    var pending: [(url: URL, browser: ArticleBrowser, began: Date)] = browsers.compactMap {
      url, browser in
      guard url != active, !browser.readerReady, browser.errorMessage == nil,
        browser.websiteFailure == nil
      else { return nil }
      return (url, browser, Date())
    }
    for url in ordered {
      guard !Task.isCancelled, version == preloadVersion else { return }
      if let browser = browsers[url], browser.cacheIdentity == url,
        browser.errorMessage == nil, browser.websiteFailure == nil
      {
        continue
      }
      // Retire a stalled speculative document before opening its slot. Merely
      // forgetting its deadline leaves every old publisher request running.
      // A later tap starts a fresh foreground load without this time limit.
      while pending.count >= 2 {
        guard !Task.isCancelled, version == preloadVersion else { return }
        pending.removeAll { item in
          if item.browser.readerReady || item.browser.errorMessage != nil
            || item.browser.websiteFailure != nil
          {
            return true
          }
          guard Date().timeIntervalSince(item.began) > 8 else { return false }
          guard item.url != active, browsers[item.url] === item.browser else { return true }
          item.browser.stop()
          browsers.removeValue(forKey: item.url)
          return true
        }
        if pending.count < 2 { break }
        do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
      }
      guard !Task.isCancelled, version == preloadVersion else { return }
      // A tap can supply the browser while this queue is suspended.
      if let browser = browsers[url], browser.cacheIdentity == url,
        browser.errorMessage == nil, browser.websiteFailure == nil
      {
        continue
      }
      browsers[url]?.stop()
      let browser = ArticleBrowser(
        url: url, store: store, downloadedFile: store.downloadedFile(for: url))
      browsers[url] = browser
      pending.append((url, browser, Date()))
      await Task.yield()
    }
  }

  func persistExtractions(in store: ArticleStore) {
    for browser in browsers.values { browser.persistExtraction(in: store) }
  }
  /// Account changes must discard every document and cancel its owned work.
  func reset() {
    preloadVersion += 1
    for browser in browsers.values { browser.stop() }
    browsers.removeAll()
    active = nil
    warmURLs = []
    lastOpenState = ""
  }

  func releaseOffscreen() {
    preloadVersion += 1
    warmURLs = []
    trim()
  }
  private func trim() {
    let keep = Set(warmURLs + (active.map { [$0] } ?? []))
    for key in Array(browsers.keys) where !keep.contains(key) {
      browsers.removeValue(forKey: key)?.stop()
    }
  }
  private func recordOpen(since began: CFAbsoluteTime) {
    #if DEBUG
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-preloading") {
        print(
          "Arctic open: \(lastOpenState), construction \((CFAbsoluteTimeGetCurrent() - began) * 1000) ms"
        )
      }
    #endif
  }
}

import UIKit
import WebKit

/// One web screen, one lifecycle owner. Hidden tabs stay warm in the default
/// persistent data store; only the foreground screen counts reading time.
final class ReaderWebViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
  let path: String
  let origin: String
  let web: WKWebView
  var onMessage: ((ReaderWebViewController, [String: Any]) -> Void)?
  private(set) var ready = false
  private var active = false
  private var query = ""
  private var colors: ReaderNativeColors
  private let cover = UIStackView()
  private let messageLabel = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private lazy var retry = readerButton("Try again") { [weak self] in self?.reload() }
  private let controls: ReaderControlsView?
  private let handler = WeakScriptHandler()

  init(path: String, origin: String, colors: ReaderNativeColors, initialState: Any = NSNull()) {
    self.path = path
    self.origin = origin
    self.colors = colors
    let configuration = WKWebViewConfiguration()
    // Preserve the Expo WKWebView's persistent store and exact HTTP origin.
    configuration.websiteDataStore = .default()
    let data = (try? JSONSerialization.data(withJSONObject: initialState, options: [.fragmentsAllowed])) ?? Data("null".utf8)
    let script = "window.__readerInitialState = \(String(decoding: data, as: UTF8.self));"
    configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    web = WKWebView(frame: .zero, configuration: configuration)
    controls = path.hasPrefix("/reader/") ? ReaderControlsView() : nil
    super.init(nibName: nil, bundle: nil)
    handler.target = self
    configuration.userContentController.add(handler, name: "reader")
    web.navigationDelegate = self
    #if DEBUG
    web.isInspectable = true
    #endif
    web.allowsLinkPreview = false
    web.scrollView.contentInsetAdjustmentBehavior = .never
    web.scrollView.bounces = controls == nil
    controls?.onCommand = { [weak self] message in
      guard let self else { return }
      if message["type"] as? String == "back" { self.onMessage?(self, message) }
      else { self.send(message) }
    }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  deinit { web.configuration.userContentController.removeScriptMessageHandler(forName: "reader") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.addSubview(web)
    web.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      web.topAnchor.constraint(equalTo: view.topAnchor), web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    cover.axis = .vertical
    cover.alignment = .center
    cover.spacing = 12
    messageLabel.font = ReaderFont.body()
    messageLabel.textAlignment = .center
    messageLabel.numberOfLines = 0
    for item in [spinner, messageLabel, retry] { cover.addArrangedSubview(item) }
    view.addSubview(cover)
    cover.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      cover.centerXAnchor.constraint(equalTo: view.centerXAnchor), cover.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      cover.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -48),
    ])
    if let controls {
      view.addSubview(controls)
      controls.translatesAutoresizingMaskIntoConstraints = false
      NSLayoutConstraint.activate([
        controls.leadingAnchor.constraint(equalTo: view.leadingAnchor), controls.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        controls.topAnchor.constraint(equalTo: view.topAnchor), controls.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      ])
    }
    apply(colors)
    reload()
  }

  func apply(_ colors: ReaderNativeColors) {
    self.colors = colors
    guard isViewLoaded else { return }
    overrideUserInterfaceStyle = colors.dark ? .dark : .light
    view.backgroundColor = colors.canvas
    view.tintColor = colors.ink
    web.backgroundColor = colors.canvas
    web.scrollView.backgroundColor = colors.canvas
    web.isOpaque = false
    messageLabel.textColor = colors.detail
  }

  func setActive(_ value: Bool) {
    active = value
    if ready { send(["type": "lifecycle", "active": value]) }
  }
  func search(_ value: String) {
    query = value
    if ready { send(["type": "search", "query": value]) }
  }

  func send(_ message: [String: Any]) {
    var versioned = message
    versioned["version"] = 1
    // Pass structured arguments instead of interpolating book/user text in JS.
    web.callAsyncJavaScript("window.dispatchEvent(new MessageEvent('reader-native', {data: message}));", arguments: ["message": versioned], in: nil, in: .page) { [weak self] result in
      if case .failure(let error) = result { self?.showError(error.localizedDescription) }
    }
  }

  private func reload() {
    ready = false
    cover.isHidden = false
    retry.isHidden = true
    messageLabel.text = "Opening…"
    spinner.startAnimating()
    web.load(URLRequest(url: URL(string: origin + path)!))
  }
  private func showError(_ text: String) {
    cover.isHidden = false
    spinner.stopAnimating()
    retry.isHidden = false
    messageLabel.text = text
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    let source = message.frameInfo.securityOrigin
    guard message.frameInfo.isMainFrame, source.protocol == "http", source.host == "127.0.0.1", source.port == Int(ReaderWebServer.port),
          let body = message.body as? [String: Any], body["version"] as? Int == 1, let type = body["type"] as? String else { return }
    if type == "ready" {
      ready = true
      cover.isHidden = true
      spinner.stopAnimating()
      send(["type": "lifecycle", "active": active])
      search(query)
    }
    if type == "reader-state", let state = body["state"] as? [String: Any],
       let data = try? JSONSerialization.data(withJSONObject: state) {
      controls?.update(json: String(decoding: data, as: UTF8.self))
    }
    onMessage?(self, body)
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { decisionHandler(.cancel); return }
    if url.absoluteString == "about:blank" || (url.scheme == "http" && url.host == "127.0.0.1" && url.port == Int(ReaderWebServer.port)) {
      decisionHandler(.allow)
      return
    }
    decisionHandler(.cancel)
    if action.navigationType == .linkActivated, ["https", "http", "mailto"].contains(url.scheme ?? "") {
      UIApplication.shared.open(url)
    }
  }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError(error.localizedDescription) }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    if (error as NSError).code != NSURLErrorCancelled { showError(error.localizedDescription) }
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { reload() }
}

/// WKUserContentController retains its handlers. Keep the controller reference
/// weak so closing a book releases its WebView and its rendering process state.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(userContentController, didReceive: message)
  }
}

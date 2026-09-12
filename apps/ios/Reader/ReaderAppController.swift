import UIKit
import UniformTypeIdentifiers

/// Owns native navigation, import delivery, and the foreground web screen. The
/// Reader gets a fixed safe-area viewport; sheet/keyboard motion cannot resize it.
final class ReaderAppController: UIViewController, UIDocumentPickerDelegate {
  private let runtime: ReaderRuntime
  private let appearance = ReaderAppearance()
  private let titles = ["Library", "Highlights", "Sessions", "Settings"]
  private let paths = ["/", "/highlights", "/reading-sessions"]
  private let header = ReaderLibraryHeader()
  private let content = UIView()
  private let rootStack = UIStackView()
  private let status = UIStackView()
  private let statusLabel = UILabel()
  private lazy var openImportButton = readerButton("Open") { [weak self] in self?.openImportedBook() }
  private lazy var dismissStatusButton = readerButton("Dismiss import status", symbol: "xmark") { [weak self] in self?.status.isHidden = true }
  private lazy var settings = ReaderSettingsController(runtime: runtime)
  private var screens: [Int: ReaderWebViewController] = [:]
  private var reader: ReaderWebViewController?
  private var selected = 0
  private var active = true
  private var started = false
  private var starting = false
  private var pendingURLs: [URL] = []
  private var inFlight = ""
  private var importedBook = ""
  private var recentBook: ReaderRecentBook?

  init(runtime: ReaderRuntime) {
    self.runtime = runtime
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override var preferredStatusBarStyle: UIStatusBarStyle { appearance.colors.dark ? .lightContent : .darkContent }

  override func viewDidLoad() {
    super.viewDidLoad()
    header.onSearch = { [weak self] query in self?.screens[0]?.search(query) }
    header.onNavigation = { [weak self] in self?.showNavigation() }
    settings.onBack = { [weak self] in self?.select(0) }
    rootStack.axis = .vertical
    rootStack.addArrangedSubview(content)
    rootStack.addSubview(header)
    header.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      header.leadingAnchor.constraint(equalTo: rootStack.leadingAnchor), header.trailingAnchor.constraint(equalTo: rootStack.trailingAnchor), header.topAnchor.constraint(equalTo: rootStack.topAnchor),
    ])
    view.addSubview(rootStack)
    rootStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      rootStack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), rootStack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
      rootStack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), rootStack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ])
    status.axis = .horizontal
    status.alignment = .center
    status.spacing = 4
    status.isLayoutMarginsRelativeArrangement = true
    status.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 4)
    status.layer.cornerRadius = 16
    status.layer.cornerCurve = .continuous
    statusLabel.font = ReaderFont.body(14)
    statusLabel.numberOfLines = 3
    for item in [statusLabel, openImportButton, dismissStatusButton] { status.addArrangedSubview(item) }
    view.addSubview(status)
    status.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      status.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16), status.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
      status.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
    ])
    status.isHidden = true
    applyAppearance()
    start()
  }

  private func start() {
    guard !started, !starting else { return }
    starting = true
    runtime.start { [weak self] result in
      guard let self else { return }
      self.starting = false
      switch result {
      case .success:
        guard !self.started else { return }
        self.started = true
        self.select(0)
        let urls = self.pendingURLs
        self.pendingURLs.removeAll()
        for url in urls { self.open(url) }
      case .failure(let error):
        self.alert("Could not open Reader", error.localizedDescription, retry: { [weak self] in self?.start() })
      }
    }
  }

  private func screen(_ index: Int) -> ReaderWebViewController {
    if let screen = screens[index] { return screen }
    let screen = ReaderWebViewController(path: paths[index], origin: runtime.origin, colors: appearance.colors)
    screen.onMessage = { [weak self] in self?.receive($0, $1) }
    if index == 0 { screen.onScroll = { [weak self] offset in self?.header.updateScroll(offset) } }
    screens[index] = screen
    mount(screen, in: content)
    return screen
  }

  private func mount(_ child: UIViewController, in container: UIView) {
    addChild(child)
    container.addSubview(child.view)
    child.view.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      child.view.leadingAnchor.constraint(equalTo: container.leadingAnchor), child.view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      child.view.topAnchor.constraint(equalTo: container.topAnchor), child.view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
    child.didMove(toParent: self)
  }

  private func select(_ index: Int) {
    guard started, reader == nil else { return }
    view.endEditing(true)
    selected = index
    header.isHidden = index != 0
    if index < 3 { _ = screen(index) }
    else if settings.parent == nil { mount(settings, in: content) }
    settings.view.isHidden = index != 3
    for (key, screen) in screens {
      screen.view.isHidden = key != index
      screen.setActive(key == index && active)
    }
    settings.apply(appearance.colors)
  }

  func setActive(_ value: Bool) {
    active = value
    for (key, screen) in screens { screen.setActive(value && reader == nil && key == selected) }
    reader?.setActive(value)
    UIApplication.shared.isIdleTimerDisabled = value && reader != nil && runtime.keepAwake
    if value && isViewLoaded { start() }
  }

  private func openReader(_ path: String, state: Any = NSNull()) {
    if let current = reader {
      current.prepareToLeave { [weak self, weak current] saved in
        guard let self, current === self.reader, saved else { return }
        self.closeReader()
        self.openReader(path, state: state)
      }
      return
    }
    view.endEditing(true)
    let controller = ReaderWebViewController(path: path, origin: runtime.origin, colors: appearance.colors, initialState: state)
    controller.onMessage = { [weak self] in self?.receive($0, $1) }
    reader = controller
    rootStack.isHidden = true
    status.isHidden = true
    addChild(controller)
    view.addSubview(controller.view)
    controller.view.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      controller.view.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), controller.view.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
      controller.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), controller.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ])
    controller.didMove(toParent: self)
    setActive(active)
  }

  private func closeReader() {
    guard let reader else { return }
    reader.setActive(false)
    reader.dismiss(animated: false)
    reader.willMove(toParent: nil)
    reader.view.removeFromSuperview()
    reader.removeFromParent()
    self.reader = nil
    rootStack.isHidden = false
    select(selected)
    setActive(active)
  }

  private func receive(_ screen: ReaderWebViewController, _ message: [String: Any]) {
    switch message["type"] as? String {
    case "library-state":
      guard screen === screens[0] else { return }
      recentBook = (message["recent"] as? [String: Any]).flatMap(ReaderRecentBook.init)
    case "appearance":
      guard screen === reader || (reader == nil && screen === screens[selected]), appearance.update(message) else { return }
      applyAppearance()
    case "ready":
      if screen === screens[0] { inFlight = ""; deliverImport() }
    case "pick-books": pickBooks()
    case "back": if screen === reader { closeReader() }
    case "navigate":
      guard let path = message["path"] as? String, let url = URL(string: path, relativeTo: URL(string: runtime.origin)!),
            url.scheme == "http", url.host == "127.0.0.1", url.port == Int(ReaderWebServer.port) else { return }
      if url.path.hasPrefix("/reader/") { openReader(url.path, state: message["state"] ?? NSNull()) }
      else if let index = (paths + ["/settings"]).firstIndex(of: url.path) { closeReader(); select(index) }
    case "imported", "import-error":
      guard screen === screens[0], let id = message["id"] as? String, id == inFlight else { return }
      if message["type"] as? String == "import-error" {
        status.isHidden = true
        importFailed(id, reason: message["error"] as? String ?? "Select the EPUB again.")
        return
      }
      do { try runtime.finishImport(id) }
      catch { alert("Could not finish import", error.localizedDescription); return }
      inFlight = ""
      importedBook = message["bookId"] as? String ?? ""
      showStatus("\(message["duplicate"] as? Bool == true ? "Already in your library" : "Added to your library"): \(message["title"] as? String ?? "Book")", canOpen: true)
      deliverImport()
    default: break
    }
  }

  private func applyAppearance() {
    let colors = appearance.colors
    overrideUserInterfaceStyle = colors.dark ? .dark : .light
    view.backgroundColor = colors.canvas
    view.tintColor = colors.ink
    header.apply(colors)
    status.backgroundColor = colors.soft
    statusLabel.textColor = colors.ink
    for screen in screens.values { screen.apply(colors) }
    reader?.apply(colors)
    if settings.isViewLoaded { settings.apply(colors) }
    setNeedsStatusBarAppearanceUpdate()
  }

  private func showNavigation() {
    guard presentedViewController == nil else { return }
    let icons = ["library", "highlighter", "clock-3", "settings"]
    let items = titles.enumerated().map { index, title in
      ReaderMenuController.Item(title: title, icon: icons[index], selected: index == selected, action: { [weak self] in self?.select(index) })
    }
    let menu = ReaderMenuController(title: "", items: items, colors: appearance.colors, utilities: [
      .init(title: "Theme", icon: appearance.colors.dark ? "moon" : "sun", action: { [weak self] in self?.screens[0]?.send(["type": "toggle-appearance"]) }),
      .init(title: "Add book", icon: "book-plus", action: { [weak self] in self?.pickBooks() }),
    ], recent: recentBook, onContinue: { [weak self] id in self?.openReader("/reader/" + id) })
    present(menu, animated: true)
  }

  private func pickBooks() {
    guard presentedViewController == nil, reader == nil else { return }
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType(filenameExtension: "epub") ?? .data], asCopy: true)
    picker.allowsMultipleSelection = true
    picker.delegate = self
    present(picker, animated: true)
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    controller.dismiss(animated: true) { [weak self] in self?.stage(urls) }
  }

  func open(_ url: URL) {
    guard started else { pendingURLs.append(url); return }
    if url.isFileURL { stage([url]); return }
    guard url.scheme == "reader" else { return }
    let path = "/" + (url.host ?? "") + url.path
    if path.hasPrefix("/reader/"), path.count > 8 { openReader(path) }
  }
  private func stage(_ urls: [URL]) {
    if let current = reader {
      current.prepareToLeave { [weak self, weak current] saved in
        guard let self, current === self.reader, saved else { return }
        self.closeReader()
        self.stage(urls)
      }
      return
    }
    select(0)
    showStatus("Adding books…", canOpen: false)
    runtime.stage(urls) { [weak self] result in
      guard let self else { return }
      if case .failure(let error) = result {
        self.status.isHidden = true
        self.alert("Could not add books", error.localizedDescription)
      }
      self.deliverImport()
    }
  }
  private func deliverImport() {
    guard inFlight.isEmpty, let library = screens[0], library.ready else { return }
    do {
      guard let next = try runtime.pendingImports().first else { return }
      inFlight = next.id
      showStatus("Importing \(next.name)…", canOpen: false)
      library.send(next.message)
    } catch { alert("Could not read imports", error.localizedDescription) }
  }
  private func importFailed(_ id: String, reason: String) {
    let alert = UIAlertController(title: "Could not import book", message: reason, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Try again", style: .default) { [weak self] _ in
      self?.inFlight = ""; self?.deliverImport()
    })
    alert.addAction(UIAlertAction(title: "Skip this file", style: .cancel) { [weak self] _ in
      guard let self else { return }
      do {
        // Only the private staged copy is removed; the selected original stays.
        try self.runtime.finishImport(id)
        self.inFlight = ""
        self.deliverImport()
      } catch { self.alert("Could not finish import", error.localizedDescription) }
    })
    present(alert, animated: true)
  }
  private func showStatus(_ text: String, canOpen: Bool) {
    statusLabel.text = text
    openImportButton.isHidden = !canOpen
    dismissStatusButton.isHidden = !canOpen
    status.isHidden = reader != nil
  }
  private func openImportedBook() {
    guard !importedBook.isEmpty else { return }
    openReader("/reader/\(importedBook)")
  }
  private func alert(_ title: String, _ message: String, retry: (() -> Void)? = nil) {
    let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Close", style: .cancel))
    if let retry { alert.addAction(UIAlertAction(title: "Try again", style: .default) { _ in retry() }) }
    let presenter = reader?.presentedViewController ?? reader ?? self
    presenter.present(alert, animated: true)
  }
}

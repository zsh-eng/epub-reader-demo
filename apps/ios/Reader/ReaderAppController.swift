import UIKit
import UniformTypeIdentifiers

/// Owns native navigation, import delivery, and the foreground web screen. The
/// Reader gets a fixed safe-area viewport; sheet/keyboard motion cannot resize it.
final class ReaderAppController: UIViewController, UISearchBarDelegate, UIDocumentPickerDelegate {
  private let runtime: ReaderRuntime
  private let appearance = ReaderAppearance()
  private let titles = ["Library", "Highlights", "Activity", "Settings"]
  private let paths = ["/", "/highlights", "/reading-sessions"]
  private let symbols = ["books.vertical", "highlighter", "chart.bar", "gearshape"]
  private let header = UIStackView()
  private let titleLabel = UILabel()
  private let search = UISearchBar()
  private let tabs = UIStackView()
  private let content = UIView()
  private let rootStack = UIStackView()
  private let status = UIStackView()
  private let statusLabel = UILabel()
  private lazy var importButton = readerButton("Add books", symbol: "plus") { [weak self] in self?.pickBooks() }
  private lazy var openImportButton = readerButton("Open") { [weak self] in self?.openImportedBook() }
  private lazy var dismissStatusButton = readerButton("Dismiss import status", symbol: "xmark") { [weak self] in self?.status.isHidden = true }
  private lazy var settings = ReaderSettingsController(runtime: runtime)
  private var screens: [Int: ReaderWebViewController] = [:]
  private var reader: ReaderWebViewController?
  private var selected = 0
  private var active = true
  private var started = false
  private var pendingURLs: [URL] = []
  private var inFlight = ""
  private var importedBook = ""
  private var searchValues = [0: "", 1: ""]

  init(runtime: ReaderRuntime) {
    self.runtime = runtime
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override var preferredStatusBarStyle: UIStatusBarStyle { appearance.colors.dark ? .lightContent : .darkContent }

  override func viewDidLoad() {
    super.viewDidLoad()
    titleLabel.font = ReaderFont.literary(30)
    titleLabel.adjustsFontForContentSizeCategory = true
    header.axis = .horizontal
    header.alignment = .center
    header.isLayoutMarginsRelativeArrangement = true
    header.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 4, leading: 24, bottom: 0, trailing: 12)
    header.addArrangedSubview(titleLabel)
    header.addArrangedSubview(importButton)
    importButton.setContentHuggingPriority(.required, for: .horizontal)
    search.delegate = self
    search.searchBarStyle = .minimal
    search.searchTextField.font = ReaderFont.body()
    search.searchTextField.accessibilityIdentifier = "library-search"
    search.autocapitalizationType = .none
    tabs.axis = .horizontal
    tabs.distribution = .fillEqually
    for index in titles.indices {
      let button = readerButton(titles[index]) { [weak self] in self?.select(index) }
      button.configuration?.image = UIImage(systemName: symbols[index])
      button.configuration?.imagePlacement = .top
      button.configuration?.imagePadding = 4
      button.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 0, bottom: 6, trailing: 0)
      button.accessibilityIdentifier = "tab-\(titles[index].lowercased())"
      tabs.addArrangedSubview(button)
    }
    rootStack.axis = .vertical
    for item in [header, search, content, tabs] { rootStack.addArrangedSubview(item) }
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
      status.bottomAnchor.constraint(equalTo: tabs.topAnchor, constant: -12),
    ])
    status.isHidden = true
    applyAppearance()
    start()
  }

  private func start() {
    runtime.start { [weak self] result in
      guard let self else { return }
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
    titleLabel.text = titles[index]
    importButton.isHidden = index != 0
    search.isHidden = index > 1
    search.text = searchValues[index] ?? ""
    search.placeholder = index == 0 ? "Search books or authors" : "Search highlights"
    if index < 3 { _ = screen(index) }
    else if settings.parent == nil { mount(settings, in: content) }
    settings.view.isHidden = index != 3
    for (key, screen) in screens {
      screen.view.isHidden = key != index
      screen.setActive(key == index && active)
    }
    for (key, item) in tabs.arrangedSubviews.enumerated() {
      item.tintColor = key == index ? appearance.colors.ink : appearance.colors.detail
      item.accessibilityTraits = key == index ? [.button, .selected] : [.button]
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
    view.endEditing(true)
    closeReader()
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
        alert("Could not import book", message["error"] as? String ?? "Select the EPUB again.", retry: { [weak self] in
          self?.inFlight = ""; self?.deliverImport()
        })
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
    titleLabel.textColor = colors.ink
    search.searchTextField.textColor = colors.ink
    search.searchTextField.backgroundColor = colors.soft
    status.backgroundColor = colors.soft
    statusLabel.textColor = colors.ink
    for screen in screens.values { screen.apply(colors) }
    reader?.apply(colors)
    if settings.isViewLoaded { settings.apply(colors) }
    for (key, item) in tabs.arrangedSubviews.enumerated() { item.tintColor = key == selected ? colors.ink : colors.detail }
    setNeedsStatusBarAppearanceUpdate()
  }

  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
    searchValues[selected] = searchText
    screens[selected]?.search(searchText)
  }
  func searchBarSearchButtonClicked(_ searchBar: UISearchBar) { searchBar.resignFirstResponder() }

  private func pickBooks() {
    guard presentedViewController == nil, reader == nil else { return }
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType(filenameExtension: "epub") ?? .data], asCopy: true)
    picker.allowsMultipleSelection = true
    picker.delegate = self
    present(picker, animated: true)
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { stage(urls) }

  func open(_ url: URL) {
    guard started else { pendingURLs.append(url); return }
    if url.isFileURL { stage([url]); return }
    guard url.scheme == "reader" else { return }
    let path = "/" + (url.host ?? "") + url.path
    if path.hasPrefix("/reader/"), path.count > 8 { openReader(path) }
  }
  private func stage(_ urls: [URL]) {
    closeReader()
    select(0)
    showStatus("Adding books…", canOpen: false)
    runtime.stage(urls) { [weak self] result in
      guard let self else { return }
      if case .failure(let error) = result { self.alert("Could not add books", error.localizedDescription) }
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

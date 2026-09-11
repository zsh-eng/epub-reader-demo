import ExpoModulesCore
import UIKit

/// UIKit owns control hit testing, menus, sheets, and keyboard layout. Empty
/// space passes touches to the book WebView without resizing its viewport.
final class ReaderControlsView: ExpoView {
  let onCommand = EventDispatcher()
  private let topBar = UIToolbar()
  private let bottomBar = UIToolbar()
  private var state: ReaderNativeState?
  private var sequence = 0
  private var openRequest = 0
  private var barState = ""
  private var reportedError = ""
  private var notebook: ReaderNotebookController?
  private var tools: ReaderToolsController?
  private weak var presentedSheet: UIViewController?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    for bar in [topBar, bottomBar] {
      bar.isTranslucent = true
      addSubview(bar)
    }
    topBar.items = [item("Back to Library", symbol: "chevron.left") { [weak self] in self?.send(["action": "back"]) }]
    bottomBar.isHidden = true
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    topBar.frame = CGRect(x: 8, y: 0, width: max(0, bounds.width - 16), height: 48)
    bottomBar.frame = CGRect(x: 8, y: max(0, bounds.height - 48), width: max(0, bounds.width - 16), height: 48)
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { presentedSheet?.dismiss(animated: false) }
  }

  func update(json: String) {
    guard let data = json.data(using: .utf8), let next = try? JSONDecoder().decode(ReaderNativeState.self, from: data) else { return }
    if state?.session != next.session {
      presentedSheet?.dismiss(animated: false)
      notebook = nil
      tools = nil
      sequence = 0
      openRequest = 0
    }
    state = next
    overrideUserInterfaceStyle = next.colors.dark ? .dark : .light
    topBar.tintColor = next.colors.ink
    bottomBar.tintColor = next.colors.ink
    updateBars(next)
    notebook?.update(next)
    tools?.update(next)
    if next.error != reportedError {
      reportedError = next.error
      if !next.error.isEmpty, let presenter, presenter.presentedViewController == nil {
        let alert = UIAlertController(title: "Could not complete the action", message: next.error, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        presenter.present(alert, animated: true)
      }
    }
    if next.openRequest > openRequest {
      openRequest = next.openRequest
      showNotebook(focus: true)
    }
  }

  @discardableResult private func send(_ command: [String: Any]) -> Int {
    guard let state else {
      if command["action"] as? String == "back" { onCommand(["message": ["type": "back"]]) }
      return sequence
    }
    sequence += 1
    onCommand(["message": ["type": "reader-command", "bookId": state.bookId,
                           "session": state.session, "sequence": sequence, "command": command]])
    return sequence
  }

  private func item(_ title: String, symbol: String, action: @escaping () -> Void) -> UIBarButtonItem {
    let item = UIBarButtonItem(title: title, image: UIImage(systemName: symbol), primaryAction: UIAction { _ in action() })
    item.accessibilityLabel = title
    return item
  }

  private func updateBars(_ state: ReaderNativeState) {
    let key = "\(state.session)|\(state.chromeVisible)|\(state.page)|\(state.totalPages)|\(state.canGoNext)|\(state.canGoPrevious)|\(state.startLabel)|\(state.startPending)|\(state.settings.showPageNumbers)|\(state.readingStatus)|\(state.statusPending)"
    guard key != barState else { return }
    barState = key
    let visible = state.chromeVisible || !state.startLabel.isEmpty
    topBar.isHidden = !visible
    bottomBar.isHidden = !visible
    let back = item("Back to Library", symbol: "chevron.left") { [weak self] in self?.send(["action": "back"]) }
    let contents = item("Contents", symbol: "list.bullet") { [weak self] in self?.showTools(.contents) }
    let appearance = item("Reading appearance", symbol: "textformat.size") { [weak self] in self?.showTools(.appearance) }
    let info = UIAction(title: "About this book", image: UIImage(systemName: "info.circle")) { [weak self] _ in self?.showTools(.book) }
    let statuses = [("want-to-read", "Want to Read"), ("reading", "Reading"), ("finished", "Finished"), ("dnf", "Did Not Finish")].map { value, title in
      UIAction(title: title, attributes: state.statusPending ? .disabled : [], state: state.readingStatus == value ? .on : .off) { [weak self] _ in self?.send(["action": "reading-status", "status": value]) }
    }
    let remove = UIAction(title: "Remove from Library", image: UIImage(systemName: "trash"), attributes: .destructive) { [weak self] _ in self?.confirmRemove() }
    let more = UIBarButtonItem(image: UIImage(systemName: "ellipsis"), menu: UIMenu(children: [info, UIMenu(title: "Reading status", children: statuses), remove]))
    more.accessibilityLabel = "Book actions"
    topBar.items = [back, .flexibleSpace(), contents, appearance, more]
    topBar.accessibilityLabel = state.title
    let previous = item("Previous page", symbol: "chevron.left") { [weak self] in self?.send(["action": "previous"]) }
    previous.isEnabled = state.canGoPrevious
    let next = item("Next page", symbol: "chevron.right") { [weak self] in self?.send(["action": "next"]) }
    next.isEnabled = state.canGoNext
    let pageTitle = state.settings.showPageNumbers ? "\(state.page) / \(state.totalPages)" : "Reading position"
    let page = UIBarButtonItem(title: state.startLabel.isEmpty ? pageTitle : state.startLabel,
                              primaryAction: UIAction { [weak self] _ in
      if state.startLabel.isEmpty { self?.showTools(.contents) }
      else { self?.send(["action": "start-reading"]) }
    })
    page.isEnabled = !state.startPending
    page.accessibilityLabel = state.startLabel.isEmpty ? "Page \(state.page) of \(state.totalPages). Contents" : state.startLabel
    let note = item("Write a note", symbol: "square.and.pencil") { [weak self] in self?.showNotebook(focus: false) }
    bottomBar.items = [previous, next, .flexibleSpace(), page, .flexibleSpace(), note]
  }

  private func confirmRemove() {
    guard let presenter, let state else { return }
    let alert = UIAlertController(title: "Remove \(state.title)?", message: "This removes the book and its notes from this library.", preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Remove", style: .destructive) { [weak self] _ in self?.send(["action": "remove-book"]) })
    presenter.present(alert, animated: true)
  }

  private var presenter: UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let controller = next as? UIViewController { return controller }
      responder = next
    }
    return nil
  }

  private func showNotebook(focus: Bool) {
    guard let state, let presenter else { return }
    if let notebook, notebook.presentingViewController != nil {
      if focus { notebook.focusComposer() }
      return
    }
    guard presenter.presentedViewController == nil else { return }
    let controller = notebook ?? ReaderNotebookController(command: { [weak self] in self?.send($0) ?? 0 })
    notebook = controller
    controller.update(state)
    controller.modalPresentationStyle = .pageSheet
    controller.configureSheet()
    presentedSheet = controller
    presenter.present(controller, animated: true) {
      if focus { controller.focusComposer() }
    }
  }

  private func showTools(_ mode: ReaderToolsController.Mode) {
    guard let state, let presenter else { return }
    if presenter.presentedViewController is ReaderNotebookController {
      send(["action": "close"])
      presenter.dismiss(animated: true) { [weak self] in self?.showTools(mode) }
      return
    }
    guard presenter.presentedViewController == nil else { return }
    let controller = ReaderToolsController(mode: mode, state: state, command: { [weak self] in self?.send($0) ?? 0 })
    tools = controller
    let navigation = UINavigationController(rootViewController: controller)
    navigation.modalPresentationStyle = .pageSheet
    navigation.sheetPresentationController?.detents = [.medium(), .large()]
    navigation.sheetPresentationController?.prefersGrabberVisible = true
    presentedSheet = navigation
    presenter.present(navigation, animated: true)
  }
}

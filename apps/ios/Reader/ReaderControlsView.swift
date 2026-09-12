import UIKit

/// Native controls keep the web design. Empty space passes to WKWebView; neither
/// the chrome nor the notebook changes the book's layout or pagination viewport.
final class ReaderControlsView: UIView {
  var onCommand: (([String: Any]) -> Void)?
  private let header = ReaderHeaderView()
  private let footer = ReaderFooterView()
  private var state: ReaderNativeState?
  private var sequence = 0
  private var openRequest = 0
  private var reportedError = ""
  private var notebook: ReaderNotebookController?
  private var tools: ReaderToolsController?
  private weak var presentedSheet: UIViewController?
  private var pendingLeave: (sequence: Int, complete: (Bool) -> Void)?

  init() {
    super.init(frame: .zero)
    addSubview(header); addSubview(footer)
    header.onBack = { [weak self] in self?.send(["action": "back"]) }
    header.onTools = { [weak self] in self?.showMenu() }
    header.onBookmark = { [weak self] in self?.send(["action": "bookmark"]) }
    footer.command = { [weak self] in self?.send($0) ?? 0 }
    footer.onContents = { [weak self] in self?.showTools(.contents) }
    footer.onNote = { [weak self] in self?.showNotebook(focus: false) }
    header.isHidden = true; footer.isHidden = true
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func layoutSubviews() {
    super.layoutSubviews()
    header.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 98)
    footer.frame = CGRect(x: 0, y: max(0, bounds.height - 234), width: bounds.width, height: 234)
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
      pendingLeave?.complete(false); pendingLeave = nil
      presentedSheet?.dismiss(animated: false)
      notebook?.close()
      notebook?.willMove(toParent: nil); notebook?.view.removeFromSuperview(); notebook?.removeFromParent()
      notebook = nil; tools = nil; sequence = 0; openRequest = 0
    }
    let changedVisibility = state?.chromeVisible != next.chromeVisible || state?.isBookmarked != next.isBookmarked
    state = next
    overrideUserInterfaceStyle = next.colors.dark ? .dark : .light
    header.update(next); footer.update(next)
    header.isHidden = false; footer.isHidden = notebook?.isOpen == true
    let visible = next.chromeVisible || !next.startLabel.isEmpty
    header.isUserInteractionEnabled = visible || next.isBookmarked
    footer.isUserInteractionEnabled = visible
    UIView.animate(withDuration: changedVisibility && !UIAccessibility.isReduceMotionEnabled ? 0.24 : 0, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
      self.header.transform = CGAffineTransform(translationX: 0, y: visible ? 0 : next.isBookmarked ? -80 : -104)
      self.header.alpha = visible || next.isBookmarked ? 1 : 0
      self.footer.transform = CGAffineTransform(translationX: 0, y: visible ? 0 : 240)
      self.footer.alpha = visible ? 1 : 0
    }
    notebook?.update(next); tools?.update(next)
    if next.error != reportedError {
      reportedError = next.error
      if !next.error.isEmpty, let presenter, presenter.presentedViewController == nil, notebook?.isOpen != true {
        let alert = UIAlertController(title: "Could not complete the action", message: next.error, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default)); presenter.present(alert, animated: true)
      }
    }
    if next.openRequest > openRequest { openRequest = next.openRequest; showNotebook(focus: true) }
    if let pending = pendingLeave, next.acknowledged >= pending.sequence {
      pendingLeave = nil; presentedSheet?.view.isUserInteractionEnabled = true
      pending.complete(next.error.isEmpty)
    }
  }
  func prepareToLeave(_ complete: @escaping (Bool) -> Void) {
    guard let state else { complete(true); return }
    footer.scrubber.cancel(at: state.page)
    notebook?.endEditing()
    presentedSheet?.view.endEditing(true)
    presentedSheet?.view.isUserInteractionEnabled = false
    pendingLeave = (send(["action": "close"]), complete)
  }
  @discardableResult private func send(_ command: [String: Any]) -> Int {
    guard let state else {
      if command["action"] as? String == "back" { onCommand?(["type": "back"]) }
      return sequence
    }
    sequence += 1
    onCommand?(["type": "reader-command", "bookId": state.bookId, "session": state.session, "sequence": sequence, "command": command])
    return sequence
  }
  private var presenter: UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next { if let controller = next as? UIViewController { return controller }; responder = next }
    return nil
  }
  private func showNotebook(focus: Bool) {
    guard let state, let presenter, presenter.presentedViewController == nil else { return }
    if notebook == nil {
      let controller = ReaderNotebookController(command: { [weak self] in self?.send($0) ?? 0 })
      notebook = controller
      controller.onVisibilityChange = { [weak self] open in
        self?.footer.isHidden = open
        self?.footer.accessibilityElementsHidden = open
      }
      presenter.addChild(controller)
      presenter.view.addSubview(controller.view)
      controller.view.translatesAutoresizingMaskIntoConstraints = false
      NSLayoutConstraint.activate([
        controller.view.leadingAnchor.constraint(equalTo: presenter.view.leadingAnchor), controller.view.trailingAnchor.constraint(equalTo: presenter.view.trailingAnchor), controller.view.topAnchor.constraint(equalTo: presenter.view.topAnchor), controller.view.bottomAnchor.constraint(equalTo: presenter.view.bottomAnchor),
      ])
      controller.didMove(toParent: presenter)
    }
    notebook?.update(state)
    notebook?.open(focus: focus)
  }
  private func showMenu() {
    guard let state, let presenter, presenter.presentedViewController == nil else { return }
    notebook?.close()
    let menu = ReaderMenuController(title: "Reader Tools", items: [
      .init(title: "Notes", icon: "notebook-pen", action: { [weak self] in self?.showNotebook(focus: false); self?.notebook?.expand() }),
      .init(title: "Contents", icon: "list", action: { [weak self] in self?.showTools(.contents) }),
      .init(title: "Book Status", icon: "book-marked", action: { [weak self] in self?.showTools(.book) }),
      .init(title: "Search Book", icon: "search", enabled: false, action: {}),
      .init(title: "Themes & Settings", icon: "settings", action: { [weak self] in self?.showTools(.appearance) }),
    ], colors: state.colors)
    presentedSheet = menu; presenter.present(menu, animated: true)
  }
  private func showTools(_ mode: ReaderToolsController.Mode) {
    guard let state, let presenter, presenter.presentedViewController == nil else { return }
    notebook?.close()
    let controller = ReaderToolsController(mode: mode, state: state, command: { [weak self] in self?.send($0) ?? 0 })
    controller.onBack = { [weak self] in self?.showMenu() }
    tools = controller
    controller.modalPresentationStyle = .pageSheet
    controller.sheetPresentationController?.detents = [.custom { context in min(mode == .appearance ? 568 : 520, context.maximumDetentValue) }, .large()]
    controller.sheetPresentationController?.prefersGrabberVisible = true
    controller.sheetPresentationController?.preferredCornerRadius = 28
    presentedSheet = controller
    presenter.present(controller, animated: true)
  }
}

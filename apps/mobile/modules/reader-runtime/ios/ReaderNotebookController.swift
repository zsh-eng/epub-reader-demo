import UIKit

/// One native input survives detent changes, keyboard transitions, and notebook
/// browsing. The sheet changes size; the book underneath never changes size.
final class ReaderNotebookController: UIViewController, UITextViewDelegate, UITableViewDataSource, UITableViewDelegate, UISheetPresentationControllerDelegate {
  private let command: ReaderNativeCommand
  private var state: ReaderNativeState?
  private let input = UITextView()
  private let placeholder = UILabel()
  private let sendButton = UIButton(type: .system)
  private let contextLabel = UILabel()
  private let contextButton = UIButton(type: .system)
  private let errorLabel = UILabel()
  private let undoButton = UIButton(type: .system)
  private let footer = UIStackView()
  private let composer = UIView()
  private let table = UITableView(frame: .zero, style: .plain)
  private let header = UIToolbar()
  private var inputHeight: NSLayoutConstraint!
  private var leading: NSLayoutConstraint!
  private var trailing: NSLayoutConstraint!
  private var rows: [ReaderNativeNote] = []
  private var lastInputSequence = 0
  private var pendingSaveSequence = 0
  private var deletedID = ""
  private var compactHeight: CGFloat = 84
  private var keyboardObserver: NSObjectProtocol?
  private let compact = UISheetPresentationController.Detent.Identifier("composer")

  init(command: @escaping ReaderNativeCommand) {
    self.command = command
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  deinit { if let keyboardObserver { NotificationCenter.default.removeObserver(keyboardObserver) } }

  func configureSheet() {
    guard let sheet = sheetPresentationController else { return }
    if #available(iOS 16.0, *) {
      sheet.detents = [.custom(identifier: compact) { [weak self] _ in self?.compactHeight ?? 84 }, .large()]
      sheet.selectedDetentIdentifier = compact
      sheet.largestUndimmedDetentIdentifier = compact
    } else {
      sheet.detents = [.medium(), .large()]
      sheet.largestUndimmedDetentIdentifier = .medium
    }
    sheet.prefersGrabberVisible = true
    sheet.prefersScrollingExpandsWhenScrolledToEdge = false
    sheet.prefersEdgeAttachedInCompactHeight = true
    sheet.delegate = self
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    table.dataSource = self
    table.delegate = self
    table.keyboardDismissMode = .interactive
    table.separatorStyle = .none
    table.backgroundColor = .clear
    table.register(UITableViewCell.self, forCellReuseIdentifier: "note")
    table.estimatedRowHeight = 100
    table.rowHeight = UITableView.automaticDimension
    table.accessibilityIdentifier = "reader-notebook-list"

    input.delegate = self
    input.backgroundColor = .clear
    input.font = .preferredFont(forTextStyle: .body)
    input.adjustsFontForContentSizeCategory = true
    input.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 4)
    input.accessibilityLabel = "Write a note"
    input.accessibilityIdentifier = "reader-note-input"
    input.isScrollEnabled = false
    placeholder.text = "Write a note…"
    placeholder.font = .preferredFont(forTextStyle: .body)
    placeholder.adjustsFontForContentSizeCategory = true
    placeholder.isUserInteractionEnabled = false
    input.addSubview(placeholder)
    placeholder.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      placeholder.leadingAnchor.constraint(equalTo: input.leadingAnchor, constant: 13),
      placeholder.topAnchor.constraint(equalTo: input.topAnchor, constant: 12),
    ])
    let keyboardBar = UIToolbar()
    keyboardBar.sizeToFit()
    keyboardBar.items = [.flexibleSpace(), UIBarButtonItem(title: "Done", primaryAction: UIAction { [weak self] _ in self?.input.resignFirstResponder() })]
    input.inputAccessoryView = keyboardBar
    sendButton.setImage(UIImage(systemName: "arrow.up"), for: .normal)
    sendButton.accessibilityLabel = "Save note"
    sendButton.addTarget(self, action: #selector(save), for: .touchUpInside)
    sendButton.configuration = .filled()
    sendButton.configuration?.cornerStyle = .capsule

    composer.layer.cornerRadius = 26
    composer.layer.cornerCurve = .continuous
    composer.addSubview(input)
    composer.addSubview(sendButton)
    for item in [input, sendButton] { item.translatesAutoresizingMaskIntoConstraints = false }
    inputHeight = input.heightAnchor.constraint(equalToConstant: 48)
    NSLayoutConstraint.activate([
      input.leadingAnchor.constraint(equalTo: composer.leadingAnchor),
      input.topAnchor.constraint(equalTo: composer.topAnchor),
      input.bottomAnchor.constraint(equalTo: composer.bottomAnchor), inputHeight,
      input.trailingAnchor.constraint(equalTo: sendButton.leadingAnchor, constant: -4),
      sendButton.trailingAnchor.constraint(equalTo: composer.trailingAnchor, constant: -8),
      sendButton.bottomAnchor.constraint(equalTo: composer.bottomAnchor, constant: -8),
      sendButton.widthAnchor.constraint(equalToConstant: 36), sendButton.heightAnchor.constraint(equalToConstant: 36),
    ])

    contextLabel.font = .preferredFont(forTextStyle: .caption1)
    contextLabel.adjustsFontForContentSizeCategory = true
    contextLabel.numberOfLines = 2
    contextButton.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
    contextButton.accessibilityLabel = "Remove quote"
    contextButton.addTarget(self, action: #selector(clearContext), for: .touchUpInside)
    let context = UIStackView(arrangedSubviews: [contextLabel, contextButton])
    context.spacing = 8
    contextButton.setContentHuggingPriority(.required, for: .horizontal)
    contextButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    contextButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    errorLabel.numberOfLines = 0
    errorLabel.font = .preferredFont(forTextStyle: .caption1)
    errorLabel.adjustsFontForContentSizeCategory = true
    undoButton.setTitle("Note deleted · Undo", for: .normal)
    undoButton.addTarget(self, action: #selector(undo), for: .touchUpInside)
    undoButton.accessibilityLabel = "Undo delete note"
    footer.axis = .vertical
    footer.spacing = 6
    for item in [context, errorLabel, undoButton, composer] { footer.addArrangedSubview(item) }
    for item in [header, table, footer] {
      view.addSubview(item)
    }
    footer.translatesAutoresizingMaskIntoConstraints = false
    leading = footer.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 18)
    trailing = footer.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -18)
    NSLayoutConstraint.activate([
      leading, trailing,
      footer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -8),
    ])
    keyboardObserver = NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] notification in
      guard let self, self.view.window != nil else { return }
      let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
      self.leading.constant = self.input.isFirstResponder ? 8 : 18
      self.trailing.constant = -self.leading.constant
      UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : duration, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) { self.view.layoutIfNeeded() }
    }
    if let state { update(state) }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    resizeInput()
    let expanded = footer.frame.minY > 125
    header.frame = CGRect(x: 12, y: 20, width: max(0, view.bounds.width - 24), height: 44)
    table.frame = CGRect(x: 0, y: 64, width: view.bounds.width, height: max(0, footer.frame.minY - 70))
    table.isHidden = !expanded
    header.isHidden = !expanded
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    _ = command(["action": "close"])
  }

  func update(_ next: ReaderNativeState) {
    state = next
    guard isViewLoaded else { return }
    overrideUserInterfaceStyle = next.colors.dark ? .dark : .light
    view.tintColor = next.colors.accent
    composer.backgroundColor = next.colors.soft
    input.textColor = next.colors.ink
    placeholder.textColor = next.colors.detail
    contextLabel.textColor = next.colors.detail
    errorLabel.textColor = next.colors.ink
    sendButton.configuration?.baseBackgroundColor = next.colors.ink
    sendButton.configuration?.baseForegroundColor = next.colors.canvas
    if next.acknowledged >= lastInputSequence && input.markedTextRange == nil && input.text != next.draft.content {
      input.text = next.draft.content
    }
    if next.acknowledged >= pendingSaveSequence { pendingSaveSequence = 0 }
    input.isEditable = next.draft.ready
    input.accessibilityLabel = next.draft.editingId.isEmpty ? "Write a note" : "Edit note"
    sendButton.accessibilityLabel = next.draft.editingId.isEmpty ? "Save note" : "Save changes"
    sendButton.setImage(UIImage(systemName: next.draft.editingId.isEmpty ? "arrow.up" : "checkmark"), for: .normal)
    contextLabel.text = next.draft.editingId.isEmpty ? next.draft.quote : "Editing note\(next.draft.quote.isEmpty ? "" : " · \(next.draft.quote)")"
    contextLabel.superview?.isHidden = next.draft.quote.isEmpty && next.draft.editingId.isEmpty
    contextButton.accessibilityLabel = next.draft.editingId.isEmpty ? "Remove quote" : "Cancel edit"
    errorLabel.text = next.error
    errorLabel.isHidden = next.error.isEmpty
    undoButton.isHidden = deletedID.isEmpty || next.notes.contains(where: { $0.id == deletedID })
    let sorted = next.notes.sorted { $0.createdAt > $1.createdAt }
    if rows != sorted {
      rows = sorted
      table.reloadData()
    }
    let title = UIBarButtonItem(title: "Notebook · \(rows.count)", style: .plain, target: nil, action: nil)
    title.isEnabled = false
    header.items = [title, .flexibleSpace(), UIBarButtonItem(title: "Close", primaryAction: UIAction { [weak self] _ in self?.dismissNotebook() })]
    let empty = UILabel()
    empty.text = "A place for what stays with you."
    empty.font = UIFont(descriptor: UIFont.preferredFont(forTextStyle: .body).fontDescriptor.withDesign(.serif)!, size: 0)
    empty.textColor = next.colors.detail
    empty.textAlignment = .center
    empty.numberOfLines = 0
    table.backgroundView = rows.isEmpty ? empty : nil
    resizeInput()
    refreshSendButton()
  }

  private func resizeInput() {
    guard input.bounds.width > 0 else { return }
    let measured = input.sizeThatFits(CGSize(width: input.bounds.width, height: .greatestFiniteMagnitude)).height
    let height = min(160, max(48, measured))
    if inputHeight.constant != height { inputHeight.constant = height }
    input.isScrollEnabled = measured > 160
    placeholder.isHidden = !input.text.isEmpty
    let desired = height + 36 + (contextLabel.superview?.isHidden == false ? 50 : 0) + (errorLabel.isHidden ? 0 : 48) + (undoButton.isHidden ? 0 : 38)
    if compactHeight != desired {
      compactHeight = desired
      if #available(iOS 16.0, *) { sheetPresentationController?.invalidateDetents() }
    }
  }

  private func refreshSendButton() {
    sendButton.isEnabled = input.isEditable && state?.draft.saving == false && pendingSaveSequence == 0 && !input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  func focusComposer() { loadViewIfNeeded(); input.becomeFirstResponder() }
  func textViewDidChange(_ textView: UITextView) {
    lastInputSequence = command(["action": "draft", "content": textView.text ?? ""])
    resizeInput()
    refreshSendButton()
  }
  func textViewDidEndEditing(_ textView: UITextView) { _ = command(["action": "close"]) }
  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    state?.draft.saving == false && pendingSaveSequence == 0
  }
  @objc private func save() {
    guard sendButton.isEnabled else { return }
    pendingSaveSequence = command(["action": "save"])
    lastInputSequence = pendingSaveSequence
    refreshSendButton()
  }
  @objc private func clearContext() {
    lastInputSequence = command(["action": state?.draft.editingId.isEmpty == false ? "cancel-edit" : "remove-quote"])
  }
  @objc private func undo() { _ = command(["action": "undo", "id": deletedID]); deletedID = ""; undoButton.isHidden = true }
  private func dismissNotebook() { input.resignFirstResponder(); _ = command(["action": "close"]); dismiss(animated: true) }
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { _ = command(["action": "close"]) }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }
  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let note = rows[indexPath.row]
    let cell = tableView.dequeueReusableCell(withIdentifier: "note", for: indexPath)
    var content = cell.defaultContentConfiguration()
    content.text = note.text
    content.textProperties.numberOfLines = 0
    content.textProperties.color = state?.colors.ink ?? .label
    content.secondaryText = [note.quote.isEmpty ? nil : "“\(note.quote)”", note.chapter, note.page > 0 ? "Page \(note.page)" : "Location unavailable"].compactMap { $0 }.joined(separator: "\n")
    content.secondaryTextProperties.numberOfLines = 4
    content.secondaryTextProperties.color = state?.colors.detail ?? .secondaryLabel
    content.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 14, leading: 24, bottom: 14, trailing: 24)
    cell.contentConfiguration = content
    cell.backgroundColor = state?.colors.canvas
    cell.accessoryType = note.page > 0 ? .disclosureIndicator : .none
    return cell
  }
  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    let note = rows[indexPath.row]
    guard note.page > 0 else { return }
    _ = command(["action": "visit", "id": note.id])
    input.resignFirstResponder()
    sheetPresentationController?.animateChanges { self.sheetPresentationController?.selectedDetentIdentifier = self.compact }
  }
  func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
    let note = rows[indexPath.row]
    guard note.kind == "note" else { return nil }
    let edit = UIContextualAction(style: .normal, title: "Edit") { [weak self] _, _, done in
      guard let self else { return }
      self.lastInputSequence = self.command(["action": "edit", "id": note.id])
      self.focusComposer()
      done(true)
    }
    edit.backgroundColor = state?.colors.accent
    return UISwipeActionsConfiguration(actions: [edit])
  }
  func tableView(_ tableView: UITableView, leadingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
    let note = rows[indexPath.row]
    let delete = UIContextualAction(style: .destructive, title: "Delete") { [weak self] _, _, done in
      self?.deletedID = note.id
      self?.lastInputSequence = self?.command(["action": "delete", "id": note.id]) ?? 0
      done(true)
    }
    return UISwipeActionsConfiguration(actions: [delete])
  }
}

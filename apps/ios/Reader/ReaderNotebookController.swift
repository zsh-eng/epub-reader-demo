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
  private lazy var header = ReaderSheetHeader(title: "Notebook") { [weak self] in self?.dismissNotebook() }
  private lazy var orderButton = readerButton("Notebook order", symbol: "slider.horizontal.3") {}
  private var inputHeight: NSLayoutConstraint!
  private var leading: NSLayoutConstraint!
  private var trailing: NSLayoutConstraint!
  private var rows: [ReaderNativeNote] = []
  private var lastInputSequence = 0
  private var pendingSaveSequence = 0
  private var pendingUndoSequence = 0
  private var deletedID = ""
  private var orderByBook = false
  private var headerKey = ""
  private var compactHeight: CGFloat = 132
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
      sheet.detents = [.custom(identifier: compact) { [weak self] _ in self?.compactHeight ?? 132 }, .large()]
      sheet.selectedDetentIdentifier = compact
      sheet.largestUndimmedDetentIdentifier = compact
    } else {
      sheet.detents = [.medium(), .large()]
      sheet.largestUndimmedDetentIdentifier = .medium
    }
    sheet.prefersGrabberVisible = true
    sheet.preferredCornerRadius = 28
    sheet.prefersScrollingExpandsWhenScrolledToEdge = false
    sheet.prefersEdgeAttachedInCompactHeight = true
    sheet.delegate = self
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = state?.colors.canvas ?? ReaderNativeColors.paper.canvas
    table.dataSource = self
    table.delegate = self
    table.keyboardDismissMode = .interactive
    table.separatorStyle = .none
    table.backgroundColor = .clear
    table.register(ReaderNoteCell.self, forCellReuseIdentifier: "note")
    table.estimatedRowHeight = 100
    table.rowHeight = UITableView.automaticDimension
    table.accessibilityIdentifier = "reader-notebook-list"

    input.delegate = self
    input.backgroundColor = .clear
    input.font = ReaderFont.body()
    input.adjustsFontForContentSizeCategory = true
    input.textContainerInset = UIEdgeInsets(top: 16, left: 8, bottom: 16, right: 4)
    input.accessibilityLabel = "Write a note"
    input.accessibilityIdentifier = "reader-note-input"
    input.isScrollEnabled = false
    placeholder.text = "Write a note…"
    placeholder.font = ReaderFont.body()
    placeholder.adjustsFontForContentSizeCategory = true
    placeholder.isUserInteractionEnabled = false
    input.addSubview(placeholder)
    placeholder.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      placeholder.leadingAnchor.constraint(equalTo: input.leadingAnchor, constant: 13),
      placeholder.topAnchor.constraint(equalTo: input.topAnchor, constant: 16),
    ])
    // The sheet has its own keyboard-dismiss action. An input accessory toolbar
    // would add another material and consume the compact composer's height.
    sendButton.setImage(UIImage(systemName: "arrow.up"), for: .normal)
    sendButton.accessibilityLabel = "Save note"
    sendButton.addTarget(self, action: #selector(save), for: .touchUpInside)
    sendButton.configuration = .filled()
    sendButton.configuration?.cornerStyle = .capsule

    composer.layer.cornerRadius = 28
    composer.layer.cornerCurve = .continuous
    composer.layer.borderWidth = 0.5
    composer.addSubview(input)
    composer.addSubview(sendButton)
    for item in [input, sendButton] { item.translatesAutoresizingMaskIntoConstraints = false }
    inputHeight = input.heightAnchor.constraint(equalToConstant: 56)
    NSLayoutConstraint.activate([
      input.leadingAnchor.constraint(equalTo: composer.leadingAnchor),
      input.topAnchor.constraint(equalTo: composer.topAnchor),
      input.bottomAnchor.constraint(equalTo: composer.bottomAnchor), inputHeight,
      input.trailingAnchor.constraint(equalTo: sendButton.leadingAnchor, constant: -4),
      sendButton.trailingAnchor.constraint(equalTo: composer.trailingAnchor, constant: -8),
      sendButton.bottomAnchor.constraint(equalTo: composer.bottomAnchor, constant: -6),
      sendButton.widthAnchor.constraint(equalToConstant: 44), sendButton.heightAnchor.constraint(equalToConstant: 44),
    ])

    contextLabel.font = ReaderFont.body(12)
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
    errorLabel.font = ReaderFont.body(12)
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
    header.insertAction(orderButton)
    let keyboardButton = readerButton("Dismiss keyboard", symbol: "keyboard.chevron.compact.down") { [weak self] in self?.input.resignFirstResponder() }
    header.insertAction(keyboardButton)
    footer.translatesAutoresizingMaskIntoConstraints = false
    view.keyboardLayoutGuide.followsUndockedKeyboard = true
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
    footer.layoutIfNeeded()
    resizeInput()
    let expanded = footer.frame.minY > 125
    header.frame = CGRect(x: 24, y: 20, width: max(0, view.bounds.width - 48), height: 44)
    table.frame = CGRect(x: 0, y: 76, width: view.bounds.width, height: max(0, footer.frame.minY - 84))
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
    view.backgroundColor = next.colors.canvas
    view.tintColor = next.colors.accent
    composer.backgroundColor = next.colors.soft
    composer.layer.borderColor = next.colors.rule.cgColor
    header.apply(next.colors)
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
    if pendingUndoSequence > 0 && next.acknowledged >= pendingUndoSequence {
      if next.notes.contains(where: { $0.id == deletedID }) { deletedID = "" }
      pendingUndoSequence = 0
    }
    undoButton.isHidden = deletedID.isEmpty || next.notes.contains(where: { $0.id == deletedID })
    undoButton.isEnabled = pendingUndoSequence == 0
    let sorted = next.notes.sorted {
      if !orderByBook { return $0.createdAt > $1.createdAt }
      if $0.chapterIndex != $1.chapterIndex { return $0.chapterIndex < $1.chapterIndex }
      if $0.offset != $1.offset { return $0.offset < $1.offset }
      return $0.createdAt > $1.createdAt
    }
    let changed = rows != sorted
    if changed {
      rows = sorted
      table.reloadData()
    }
    if !changed {
      for case let cell as ReaderNoteCell in table.visibleCells {
        if let index = table.indexPath(for: cell) { cell.configure(rows[index.row], colors: next.colors, editing: rows[index.row].id == next.draft.editingId) }
      }
    }
    updateHeader()
    let empty = UILabel()
    empty.text = "A place for what stays with you."
    empty.font = ReaderFont.literary(22)
    empty.textColor = next.colors.detail
    empty.textAlignment = .center
    empty.numberOfLines = 0
    table.backgroundView = rows.isEmpty ? empty : nil
    resizeInput()
    refreshSendButton()
  }

  private func resizeInput() {
    placeholder.isHidden = !input.text.isEmpty
    // A restored draft arrives before the input's first layout. Measure against
    // its available width, not the still-zero bounds of that nested text view.
    let width = view.bounds.width - view.safeAreaInsets.left - view.safeAreaInsets.right - leading.constant * 2 - 56
    guard width > 0 else { return }
    let measured = input.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
    let height = min(160, max(56, measured))
    if inputHeight.constant != height { inputHeight.constant = height }
    input.isScrollEnabled = measured > 160
    // Detent heights exclude the bottom safe area; UIKit adds it. Counting it
    // here would leave a second empty strip above the compact composer.
    let desired = footer.systemLayoutSizeFitting(CGSize(width: max(1, view.bounds.width - 36), height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height + 32
    if compactHeight != desired {
      compactHeight = desired
      if #available(iOS 16.0, *) { sheetPresentationController?.invalidateDetents() }
    }
  }

  private func refreshSendButton() {
    sendButton.isEnabled = input.isEditable && state?.draft.saving == false && pendingSaveSequence == 0 && !input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  func focusComposer() { loadViewIfNeeded(); input.becomeFirstResponder() }
  func textViewDidBeginEditing(_ textView: UITextView) {
    sheetPresentationController?.animateChanges { self.sheetPresentationController?.selectedDetentIdentifier = .large }
  }
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
  @objc private func undo() {
    pendingUndoSequence = command(["action": "undo", "id": deletedID])
    undoButton.isEnabled = false
  }
  private func dismissNotebook() { input.resignFirstResponder(); _ = command(["action": "close"]); dismiss(animated: true) }
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { _ = command(["action": "close"]) }

  private func updateHeader() {
    let key = "\(rows.count)|\(orderByBook)"
    guard headerKey != key else { return }
    headerKey = key
    header.setTitle("Notebook · \(rows.count)")
    orderButton.menu = UIMenu(children: [
      UIAction(title: "By time", state: orderByBook ? .off : .on) { [weak self] _ in self?.changeOrder(false) },
      UIAction(title: "By book", state: orderByBook ? .on : .off) { [weak self] _ in self?.changeOrder(true) },
    ])
    orderButton.showsMenuAsPrimaryAction = true
  }
  private func changeOrder(_ byBook: Bool) {
    let first = table.indexPathsForVisibleRows?.first
    let id = first.map { rows[$0.row].id }
    let offset = first.map { table.rectForRow(at: $0).minY - table.contentOffset.y } ?? 0
    orderByBook = byBook
    if let state { update(state) }
    if let id, let index = rows.firstIndex(where: { $0.id == id }) {
      table.layoutIfNeeded()
      table.setContentOffset(CGPoint(x: 0, y: table.rectForRow(at: IndexPath(row: index, section: 0)).minY - offset), animated: false)
    }
  }
  private func edit(_ note: ReaderNativeNote) {
    lastInputSequence = command(["action": "edit", "id": note.id])
    focusComposer()
  }
  private func delete(_ note: ReaderNativeNote) {
    deletedID = note.id
    lastInputSequence = command(["action": "delete", "id": note.id])
  }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }
  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let note = rows[indexPath.row]
    let cell = tableView.dequeueReusableCell(withIdentifier: "note", for: indexPath) as! ReaderNoteCell
    cell.configure(note, colors: state?.colors ?? .paper, editing: note.id == state?.draft.editingId)
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
      self.edit(note)
      done(true)
    }
    edit.backgroundColor = state?.colors.accent
    return UISwipeActionsConfiguration(actions: [edit])
  }
  func tableView(_ tableView: UITableView, leadingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
    let note = rows[indexPath.row]
    let delete = UIContextualAction(style: .destructive, title: "Delete") { [weak self] _, _, done in
      self?.delete(note)
      done(true)
    }
    return UISwipeActionsConfiguration(actions: [delete])
  }
  func tableView(_ tableView: UITableView, contextMenuConfigurationForRowAt indexPath: IndexPath, point: CGPoint) -> UIContextMenuConfiguration? {
    let note = rows[indexPath.row]
    return UIContextMenuConfiguration(identifier: note.id as NSString, previewProvider: nil) { [weak self] _ in
      var actions: [UIMenuElement] = [UIAction(title: "Copy", image: UIImage(systemName: "doc.on.doc")) { _ in UIPasteboard.general.string = note.text }]
      if note.kind == "note" {
        actions.append(UIAction(title: "Edit", image: UIImage(systemName: "pencil")) { _ in self?.edit(note) })
      }
      actions.append(UIAction(title: "Delete", image: UIImage(systemName: "trash"), attributes: .destructive) { _ in self?.delete(note) })
      return UIMenu(children: actions)
    }
  }
}

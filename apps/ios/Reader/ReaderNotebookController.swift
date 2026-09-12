import UIKit

/// One native input survives detent changes, keyboard transitions, and notebook
/// browsing. The sheet changes size; the book underneath never changes size.
final class ReaderNotebookController: UIViewController, UITextViewDelegate, UITableViewDataSource, UITableViewDelegate {
  var onVisibilityChange: ((Bool) -> Void)?
  private let command: ReaderNativeCommand
  private var state: ReaderNativeState?
  private let input = UITextView()
  private let placeholder = UILabel()
  private let sendButton = UIButton(type: .system)
  private let contextLabel = UILabel()
  private let contextButton = UIButton(type: .system)
  private let errorLabel = UILabel()
  private let undoButton = UIButton(type: .system)
  private let surface = ReaderNotebookSurface()
  private var footer: UIStackView { surface.footer }
  var isOpen: Bool { surface.isOpen }
  private let composer = UIView()
  private let table = UITableView(frame: .zero, style: .plain)
  private lazy var header = ReaderSheetHeader(title: "Notebook") { [weak self] in self?.dismissNotebook() }
  private lazy var orderButton = readerButton("Notebook order", symbol: "slider.horizontal.3") {}
  private var inputHeight: NSLayoutConstraint!
  private var rows: [ReaderNativeNote] = []
  private var lastInputSequence = 0
  private var submittedInput = ""
  private var pendingSaveSequence = 0
  private var pendingUndoSequence = 0
  private var deletedID = ""
  private var orderByBook = false
  private var headerKey = ""

  init(command: @escaping ReaderNativeCommand) {
    self.command = command
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func loadView() { view = surface }

  override func viewDidLoad() {
    super.viewDidLoad()
    surface.onDismiss = { [weak self] in self?.close() }
    surface.onExpand = { [weak self] in self?.input.resignFirstResponder() }
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
    input.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
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
      placeholder.leadingAnchor.constraint(equalTo: input.leadingAnchor, constant: 5),
      placeholder.topAnchor.constraint(equalTo: input.topAnchor, constant: 8),
    ])
    // The sheet has its own keyboard-dismiss action. An input accessory toolbar
    // would add another material and consume the compact composer's height.
    sendButton.setImage(readerIcon("arrow-up", size: 20), for: .normal)
    sendButton.accessibilityLabel = "Save note"
    sendButton.addTarget(self, action: #selector(save), for: .touchUpInside)
    sendButton.configuration = .plain()
    sendButton.configuration?.cornerStyle = .capsule

    composer.layer.cornerRadius = 32
    composer.layer.cornerCurve = .continuous
    composer.layer.borderWidth = 1
    let browse = readerButton("Open notebook", symbol: "book-open") { [weak self] in self?.surface.expand() }
    composer.addSubview(browse)
    browse.translatesAutoresizingMaskIntoConstraints = false
    composer.addSubview(input)
    composer.addSubview(sendButton)
    for item in [input, sendButton] { item.translatesAutoresizingMaskIntoConstraints = false }
    inputHeight = input.heightAnchor.constraint(equalToConstant: 44)
    NSLayoutConstraint.activate([
      browse.leadingAnchor.constraint(equalTo: composer.leadingAnchor), browse.bottomAnchor.constraint(equalTo: composer.bottomAnchor),
      browse.widthAnchor.constraint(equalToConstant: 44), browse.heightAnchor.constraint(equalToConstant: 44),
      input.leadingAnchor.constraint(equalTo: browse.trailingAnchor),
      input.topAnchor.constraint(equalTo: composer.topAnchor),
      input.bottomAnchor.constraint(equalTo: composer.bottomAnchor), inputHeight,
      input.trailingAnchor.constraint(equalTo: sendButton.leadingAnchor, constant: -4),
      sendButton.trailingAnchor.constraint(equalTo: composer.trailingAnchor, constant: -4),
      sendButton.bottomAnchor.constraint(equalTo: composer.bottomAnchor),
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
    for item in [header, table] { surface.body.addSubview(item) }
    header.insertAction(orderButton)
    let keyboardButton = readerButton("Dismiss keyboard", symbol: "keyboard.chevron.compact.down") { [weak self] in self?.input.resignFirstResponder() }
    header.insertAction(keyboardButton)
    if let state { update(state) }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    resizeInput()
    let width = surface.body.bounds.width
    header.frame = CGRect(x: 16, y: 0, width: max(0, width - 32), height: 44)
    table.frame = CGRect(x: 0, y: 44, width: width, height: max(0, surface.body.bounds.height - 44))
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    _ = command(["action": "close"])
  }

  func update(_ next: ReaderNativeState) {
    state = next
    guard isViewLoaded else { return }
    overrideUserInterfaceStyle = next.colors.dark ? .dark : .light
    surface.apply(next.colors)
    view.tintColor = next.colors.accent
    composer.backgroundColor = next.colors.canvas.withAlphaComponent(0.95)
    composer.layer.borderColor = next.colors.rule.withAlphaComponent(0.8).cgColor
    header.apply(next.colors)
    input.textColor = next.colors.ink
    placeholder.textColor = next.colors.detail
    contextLabel.textColor = next.colors.detail
    errorLabel.textColor = next.colors.ink
    sendButton.configuration?.background.backgroundColor = next.colors.ink
    sendButton.configuration?.background.cornerRadius = 14
    sendButton.configuration?.background.backgroundInsets = NSDirectionalEdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4)
    sendButton.configuration?.baseForegroundColor = next.colors.canvas
    if next.acknowledged >= lastInputSequence && input.markedTextRange == nil {
      if input.text != next.draft.content { input.text = next.draft.content }
      submittedInput = next.draft.content
    }
    if next.acknowledged >= pendingSaveSequence { pendingSaveSequence = 0 }
    input.isEditable = next.draft.ready
    input.accessibilityLabel = next.draft.editingId.isEmpty ? "Write a note" : "Edit note"
    sendButton.accessibilityLabel = next.draft.editingId.isEmpty ? "Save note" : "Save changes"
    sendButton.setImage(readerIcon(next.draft.editingId.isEmpty ? "arrow-up" : "check", size: 20), for: .normal)
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
        if let index = table.indexPath(for: cell) { cell.configure(rows[index.row], colors: next.colors, editing: rows[index.row].id == next.draft.editingId, byBook: orderByBook) }
      }
    }
    updateHeader()
    let empty = UILabel()
    empty.text = "Your notes will appear here."
    empty.font = ReaderFont.literary(18)
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
    let width = surface.availableInputWidth - 96
    guard width > 0 else { return }
    let measured = input.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
    let height = min(160, max(44, measured))
    if inputHeight.constant != height { inputHeight.constant = height }
    input.isScrollEnabled = measured > 160
    surface.setNeedsLayout()
  }

  private func refreshSendButton() {
    sendButton.alpha = input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.3 : 1
    sendButton.isEnabled = input.isEditable && state?.draft.saving == false && pendingSaveSequence == 0 && !input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  func focusComposer() { loadViewIfNeeded(); input.becomeFirstResponder() }
  func textViewDidBeginEditing(_ textView: UITextView) { surface.isTyping = true }
  func open(focus: Bool) { surface.open(); onVisibilityChange?(true); if focus { focusComposer() } }
  func expand() { surface.expand() }
  func endEditing() { input.resignFirstResponder() }
  func close() { input.resignFirstResponder(); _ = command(["action": "close"]); surface.close(); onVisibilityChange?(false) }
  func textViewDidChange(_ textView: UITextView) {
    if textView.markedTextRange == nil { submitInput() }
    resizeInput()
    refreshSendButton()
  }
  func textViewDidEndEditing(_ textView: UITextView) {
    surface.isTyping = false
    // Commit the final IME composition before the ordered persistence barrier.
    textView.unmarkText()
    submitInput()
    _ = command(["action": "close"])
  }
  private func submitInput() {
    let text = input.text ?? ""
    guard pendingSaveSequence == 0, text != submittedInput else { return }
    submittedInput = text
    lastInputSequence = command(["action": "draft", "content": text])
  }
  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    state?.draft.saving == false && pendingSaveSequence == 0
  }
  override var keyCommands: [UIKeyCommand]? {
    [UIKeyCommand(title: "Save note", action: #selector(save), input: "\r", modifierFlags: .command),
     UIKeyCommand(title: "Close notebook", action: #selector(escape), input: UIKeyCommand.inputEscape)]
  }
  @objc private func escape() { if input.isFirstResponder { input.resignFirstResponder() } else { close() } }
  @objc private func save() {
    guard sendButton.isEnabled else { return }
    input.unmarkText()
    submitInput()
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
  private func dismissNotebook() { close() }

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
    cell.configure(note, colors: state?.colors ?? .paper, editing: note.id == state?.draft.editingId, byBook: orderByBook)
    cell.onEdit = { [weak self] in self?.edit(note) }
    cell.onDelete = { [weak self] in self?.delete(note) }
    return cell
  }
  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    let note = rows[indexPath.row]
    guard note.page > 0 else { return }
    _ = command(["action": "visit", "id": note.id])
    input.resignFirstResponder()
    surface.collapse()
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
  func tableView(_ tableView: UITableView, willDisplayContextMenu configuration: UIContextMenuConfiguration, animator: UIContextMenuInteractionAnimating?) {
    guard let id = configuration.identifier as? String, let index = rows.firstIndex(where: { $0.id == id }) else { return }
    (tableView.cellForRow(at: IndexPath(row: index, section: 0)) as? ReaderNoteCell)?.setMenuOpen(true)
  }
  func tableView(_ tableView: UITableView, willEndContextMenuInteraction configuration: UIContextMenuConfiguration, animator: UIContextMenuInteractionAnimating?) {
    animator?.addCompletion { [weak self] in self?.table.visibleCells.compactMap { $0 as? ReaderNoteCell }.forEach { $0.setMenuOpen(false) } }
  }

}

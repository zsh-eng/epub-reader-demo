import UIKit

/// Reader-styled content with native search, lists, menus, steppers, and switches. Only
/// settled slider values cross the bridge and cause a book layout change.
final class ReaderToolsController: UIViewController, UITableViewDataSource, UITableViewDelegate, UISearchBarDelegate {
  enum Mode { case contents, appearance, book }
  private let mode: Mode
  private var state: ReaderNativeState
  private let command: ReaderNativeCommand
  private var search = ""
  private var panel = 0
  private let tableView = UITableView(frame: .zero, style: .insetGrouped)
  private let searchBar = UISearchBar()
  private let segments = ReaderSegments(["Type", "Layout", "Theme"])
  private lazy var header = ReaderSheetHeader(title: mode == .contents ? "Contents" : mode == .appearance ? "Reading settings" : "About this book") { [weak self] in self?.dismiss(animated: true) }
  private let fonts = [("lora", "Lora"), ("iowan", "Iowan"), ("garamond", "Garamond"), ("inter", "Inter"), ("monospace", "Mono"), ("serif", "System Serif"), ("sans-serif", "System Sans")]

  init(mode: Mode, state: ReaderNativeState, command: @escaping ReaderNativeCommand) {
    self.mode = mode
    self.state = state
    self.command = command
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func viewDidLoad() {
    super.viewDidLoad()
    tableView.dataSource = self
    tableView.delegate = self
    tableView.keyboardDismissMode = .interactive
    tableView.estimatedRowHeight = 60
    tableView.rowHeight = UITableView.automaticDimension
    tableView.separatorStyle = .none
    searchBar.delegate = self
    searchBar.searchBarStyle = .minimal
    searchBar.placeholder = "Find a chapter"
    searchBar.searchTextField.font = ReaderFont.body()
    searchBar.accessibilityLabel = "Find a chapter"
    segments.onSelect = { [weak self] panel in self?.panel = panel; self?.tableView.reloadData() }
    for item in [header, searchBar, segments, tableView] { view.addSubview(item); item.translatesAutoresizingMaskIntoConstraints = false }
    searchBar.isHidden = mode != .contents
    segments.isHidden = mode != .appearance
    NSLayoutConstraint.activate([
      header.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24), header.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
      header.topAnchor.constraint(equalTo: view.topAnchor, constant: 20), header.heightAnchor.constraint(equalToConstant: 48),
      searchBar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 8), searchBar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -8), searchBar.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 8),
      segments.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24), segments.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24), segments.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 12),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor), tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor), tableView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
      tableView.topAnchor.constraint(equalTo: mode == .appearance ? segments.bottomAnchor : mode == .contents ? searchBar.bottomAnchor : header.bottomAnchor, constant: 8),
    ])
    update(state)
  }
  func update(_ next: ReaderNativeState) {
    state = next
    guard isViewLoaded else { return }
    overrideUserInterfaceStyle = next.colors.dark ? .dark : .light
    view.backgroundColor = next.colors.canvas
    view.tintColor = next.colors.ink
    header.apply(next.colors)
    segments.apply(next.colors)
    searchBar.searchTextField.backgroundColor = next.colors.soft
    searchBar.searchTextField.textColor = next.colors.ink
    tableView.backgroundColor = next.colors.canvas
    tableView.tintColor = next.colors.ink
    tableView.reloadData()
  }
  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
    search = searchText
    tableView.reloadData()
  }
  private var chapters: [ReaderNativeChapter] {
    state.contents.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }
  }
  func numberOfSections(in tableView: UITableView) -> Int {
    mode == .contents ? 2 : 1
  }
  func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
    if mode == .appearance { return ["Typography", "Layout", "Theme"][panel] }
    if mode == .contents { return section == 0 ? state.chapter : "Chapters" }
    return nil
  }
  func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
    if !state.error.isEmpty && section == 0 { return state.error }
    if mode == .appearance && panel == 2 { return "The library and controls use the same palette as your reading theme." }
    return nil
  }
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    if mode == .appearance { return [3, 5, 1][panel] }
    if mode == .contents { return section == 0 ? 1 : chapters.count }
    return 2
  }
  private func cell(_ title: String, detail: String = "") -> UITableViewCell {
    let cell = UITableViewCell(style: .value1, reuseIdentifier: nil)
    cell.textLabel?.text = title
    cell.textLabel?.numberOfLines = 0
    cell.textLabel?.textColor = state.colors.ink
    cell.textLabel?.font = ReaderFont.body(15)
    cell.textLabel?.adjustsFontForContentSizeCategory = true
    cell.detailTextLabel?.text = detail
    cell.detailTextLabel?.textColor = state.colors.detail
    cell.detailTextLabel?.font = ReaderFont.body(13)
    cell.backgroundColor = state.colors.soft
    cell.selectionStyle = .none
    return cell
  }
  func tableView(_ tableView: UITableView, cellForRowAt path: IndexPath) -> UITableViewCell {
    if mode == .book { return cell(path.row == 0 ? state.title : state.author) }
    if mode == .contents {
      if path.section == 0 {
        let row = cell("Page \(state.page) of \(state.totalPages)")
        let slider = UISlider(frame: CGRect(x: 0, y: 0, width: 170, height: 44))
        slider.minimumValue = 1
        slider.maximumValue = Float(max(2, state.totalPages))
        slider.value = Float(state.page)
        slider.isEnabled = state.paginationReady
        slider.accessibilityLabel = "Reading page"
        slider.addAction(UIAction { [weak self, weak slider] _ in
          guard let self, let slider else { return }
          _ = self.command(["action": "page", "page": Int(slider.value.rounded())])
        }, for: [.touchUpInside, .touchUpOutside, .touchCancel])
        row.accessoryView = slider
        return row
      }
      let chapter = chapters[path.row]
      let row = cell(chapter.title, detail: chapter.page > 0 ? "\(chapter.page)" : "")
      row.indentationLevel = chapter.depth
      row.indentationWidth = 12
      row.selectionStyle = .default
      return row
    }
    if panel == 2 {
      return ReaderThemeCell(themes: state.themes, selected: state.settings.theme) { [weak self] id in self?.setting("theme", id) }
    }
    if panel == 0 {
      if path.row == 0 {
        let row = cell("Text size", detail: "\(Int(state.settings.fontSize))")
        let stepper = UIStepper()
        stepper.minimumValue = 8; stepper.maximumValue = 32; stepper.value = state.settings.fontSize
        stepper.accessibilityLabel = "Text size"
        stepper.addAction(UIAction { [weak self, weak stepper] _ in
          if let stepper { self?.setting("fontSize", stepper.value) }
        }, for: .valueChanged)
        row.accessoryView = stepper
        return row
      }
      if path.row == 1 { return menuCell("Font", key: "fontFamily", value: state.settings.fontFamily, choices: fonts) }
      return menuCell("Line spacing", key: "lineHeight", value: String(state.settings.lineHeight), choices: [("1.2", "Compact"), ("1.5", "Normal"), ("1.8", "Relaxed"), ("2.0", "Spacious")], numeric: true)
    }
    if path.row == 0 {
      return menuCell("Alignment", key: "textAlign", value: state.settings.textAlign, choices: [("left", "Left"), ("justify", "Justified"), ("justify-knuth-plass", "Balanced justified"), ("center", "Center"), ("right", "Right")])
    }
    let switches: [(String, String, Bool)] = [
      ("Publisher styling", "publisherBookStylingEnabled", state.settings.publisherBookStylingEnabled),
      ("Publisher text size", "matchPublisherBodyTextSize", state.settings.matchPublisherBodyTextSize),
      ("Page animations", "pageAnimationsEnabled", state.settings.pageAnimationsEnabled),
      ("Page numbers", "showPageNumbers", state.settings.showPageNumbers),
    ]
    let (title, key, value) = switches[path.row - 1]
    let row = cell(title)
    let toggle = UISwitch()
    toggle.isOn = value
    toggle.accessibilityLabel = title
    toggle.onTintColor = state.colors.accent
    toggle.addAction(UIAction { [weak self, weak toggle] _ in
      if let toggle { self?.setting(key, toggle.isOn) }
    }, for: .valueChanged)
    row.accessoryView = toggle
    return row
  }
  private func menuCell(_ title: String, key: String, value: String, choices: [(String, String)], numeric: Bool = false) -> UITableViewCell {
    let row = cell(title)
    let button = UIButton(type: .system)
    button.setTitle(choices.first { $0.0 == value }?.1 ?? value, for: .normal)
    button.accessibilityLabel = title
    button.menu = UIMenu(children: choices.map { choice in
      UIAction(title: choice.1, state: value == choice.0 ? .on : .off) { [weak self] _ in
        self?.setting(key, numeric ? (Double(choice.0) ?? 1.5) as Any : choice.0)
      }
    })
    button.showsMenuAsPrimaryAction = true
    button.sizeToFit()
    button.frame.size.height = 44
    row.accessoryView = button
    return row
  }
  private func setting(_ key: String, _ value: Any) { _ = command(["action": "settings", "patch": [key: value]]) }
  func tableView(_ tableView: UITableView, didSelectRowAt path: IndexPath) {
    tableView.deselectRow(at: path, animated: true)
    if mode == .contents && path.section == 1 {
      _ = command(["action": "chapter", "href": chapters[path.row].href])
      dismiss(animated: true)
    }
  }
}

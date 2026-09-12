import UIKit

/// Standard iOS navigation, search, lists, menus, steppers, and switches. Only
/// settled slider values cross the bridge and cause a book layout change.
final class ReaderToolsController: UITableViewController, UISearchResultsUpdating {
  enum Mode { case contents, appearance, book }
  private let mode: Mode
  private var state: ReaderNativeState
  private let command: ReaderNativeCommand
  private var search = ""
  private let themes = [("flexoki-light", "Flexoki Light"), ("flexoki-dark", "Flexoki Dark"), ("light", "Light"), ("dark", "Dark"), ("night", "Night")]
  private let fonts = [("lora", "Lora"), ("iowan", "Iowan"), ("garamond", "Garamond"), ("inter", "Inter"), ("monospace", "Mono"), ("serif", "System Serif"), ("sans-serif", "System Sans")]

  init(mode: Mode, state: ReaderNativeState, command: @escaping ReaderNativeCommand) {
    self.mode = mode
    self.state = state
    self.command = command
    super.init(style: .insetGrouped)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func viewDidLoad() {
    super.viewDidLoad()
    title = mode == .contents ? "Contents" : mode == .appearance ? "Reading appearance" : "About this book"
    navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
    if mode == .contents {
      let controller = UISearchController(searchResultsController: nil)
      controller.searchResultsUpdater = self
      controller.obscuresBackgroundDuringPresentation = false
      controller.searchBar.placeholder = "Find a chapter"
      navigationItem.searchController = controller
      navigationItem.hidesSearchBarWhenScrolling = false
      definesPresentationContext = true
    }
    update(state)
  }
  func update(_ next: ReaderNativeState) {
    state = next
    guard isViewLoaded else { return }
    navigationController?.overrideUserInterfaceStyle = next.colors.dark ? .dark : .light
    navigationController?.view.tintColor = next.colors.ink
    tableView.backgroundColor = next.colors.canvas
    tableView.tintColor = next.colors.ink
    tableView.reloadData()
  }
  func updateSearchResults(for searchController: UISearchController) {
    search = searchController.searchBar.text ?? ""
    tableView.reloadData()
  }
  private var chapters: [ReaderNativeChapter] {
    state.contents.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }
  }
  override func numberOfSections(in tableView: UITableView) -> Int {
    mode == .appearance ? 3 : mode == .contents ? 2 : 1
  }
  override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
    if mode == .appearance { return ["Typography", "Layout", "Theme"][section] }
    if mode == .contents { return section == 0 ? state.chapter : "Chapters" }
    return nil
  }
  override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
    if !state.error.isEmpty && section == 0 { return state.error }
    if mode == .appearance && section == 2 { return "The library and native controls use the same palette as your reading theme." }
    return nil
  }
  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    if mode == .appearance { return [3, 5, themes.count][section] }
    if mode == .contents { return section == 0 ? 1 : chapters.count }
    return 2
  }
  private func cell(_ title: String, detail: String = "") -> UITableViewCell {
    let cell = UITableViewCell(style: .value1, reuseIdentifier: nil)
    cell.textLabel?.text = title
    cell.textLabel?.numberOfLines = 0
    cell.textLabel?.textColor = state.colors.ink
    cell.textLabel?.adjustsFontForContentSizeCategory = true
    cell.detailTextLabel?.text = detail
    cell.detailTextLabel?.textColor = state.colors.detail
    cell.backgroundColor = state.colors.soft
    cell.selectionStyle = .none
    return cell
  }
  override func tableView(_ tableView: UITableView, cellForRowAt path: IndexPath) -> UITableViewCell {
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
    if path.section == 2 {
      let (value, title) = themes[path.row]
      let row = cell(title)
      row.accessoryType = value == state.settings.theme ? .checkmark : .none
      row.selectionStyle = .default
      return row
    }
    if path.section == 0 {
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
  override func tableView(_ tableView: UITableView, didSelectRowAt path: IndexPath) {
    tableView.deselectRow(at: path, animated: true)
    if mode == .contents && path.section == 1 {
      _ = command(["action": "chapter", "href": chapters[path.row].href])
      dismiss(animated: true)
    }
    if mode == .appearance && path.section == 2 { setting("theme", themes[path.row].0) }
  }
}

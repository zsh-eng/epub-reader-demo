import UIKit

final class ReaderSettingsController: UITableViewController {
  private let runtime: ReaderRuntime
  private var colors = ReaderNativeColors.paper
  init(runtime: ReaderRuntime) { self.runtime = runtime; super.init(style: .insetGrouped) }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func viewDidLoad() { super.viewDidLoad(); apply(colors) }
  func apply(_ colors: ReaderNativeColors) {
    self.colors = colors
    guard isViewLoaded else { return }
    tableView.backgroundColor = colors.canvas
    tableView.tintColor = colors.ink
    tableView.reloadData()
  }
  override func numberOfSections(in tableView: UITableView) -> Int { 2 }
  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 1 }
  override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { section == 0 ? "Reading" : "Your library" }
  override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
    section == 0 ? "Change fonts, page layout, and theme from the controls inside a book." : "Keep a copy of your original EPUB files. Removing the app also removes its library. Account access and sync are not available in this version."
  }
  override func tableView(_ tableView: UITableView, cellForRowAt path: IndexPath) -> UITableViewCell {
    let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
    cell.backgroundColor = colors.soft
    cell.selectionStyle = .none
    cell.textLabel?.font = ReaderFont.body()
    cell.textLabel?.textColor = colors.ink
    cell.detailTextLabel?.font = ReaderFont.body(14)
    cell.detailTextLabel?.textColor = colors.detail
    cell.detailTextLabel?.numberOfLines = 0
    if path.section == 0 {
      cell.textLabel?.text = "Keep screen awake"
      cell.detailTextLabel?.text = "While a book is open."
      let toggle = UISwitch()
      toggle.isOn = runtime.keepAwake
      toggle.onTintColor = colors.ink
      toggle.accessibilityLabel = "Keep screen awake"
      toggle.addAction(UIAction { [weak self, weak toggle] _ in
        if let toggle { self?.runtime.keepAwake = toggle.isOn }
      }, for: .valueChanged)
      cell.accessoryView = toggle
    } else {
      cell.textLabel?.text = "Read anywhere"
      cell.detailTextLabel?.text = "Imported books, highlights, and notes stay on this device and work offline."
    }
    return cell
  }
}

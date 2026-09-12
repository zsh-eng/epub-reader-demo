import UIKit

/// Ports the existing Type / Layout / Theme panels and Contents list. No stock
/// grouped form replaces their cards, font samples, labels, or information order.
final class ReaderToolsController: UIViewController, UITextFieldDelegate {
  enum Mode { case contents, appearance, book }
  var onBack: (() -> Void)?
  private let mode: Mode
  private var state: ReaderNativeState
  private let command: ReaderNativeCommand
  private var panel = 0
  private let scroll = UIScrollView()
  private let content = UIStackView()
  private let segments = ReaderSegments(["Type", "Layout", "Theme"], icons: ["type", "align-left", "palette"])
  private let search = UISearchTextField()
  private let heading = UIView()
  private let caption = readerCaption("")
  private lazy var back = readerButton("Back to reader tools", symbol: "chevron-left") { [weak self] in self?.dismiss(animated: true, completion: self?.onBack) }
  private lazy var close = readerButton("Close reading settings", symbol: "x") { [weak self] in self?.dismiss(animated: true) }
  private let fonts = [("lora", "Lora"), ("iowan", "Iowan"), ("garamond", "Garamond"), ("inter", "Inter"), ("monospace", "Mono")]

  init(mode: Mode, state: ReaderNativeState, command: @escaping ReaderNativeCommand) {
    self.mode = mode; self.state = state; self.command = command
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func viewDidLoad() {
    super.viewDidLoad()
    let stack = UIStackView(); stack.axis = .vertical; stack.spacing = 12
    content.axis = .vertical; content.spacing = 20
    scroll.keyboardDismissMode = .interactive
    scroll.alwaysBounceVertical = true
    for item in [back, caption, close] { heading.addSubview(item); item.translatesAutoresizingMaskIntoConstraints = false }
    caption.textAlignment = .center
    caption.text = mode == .appearance ? "" : mode == .contents ? "CONTENTS" : "BOOK STATUS"
    search.placeholder = "Find a chapter"; search.accessibilityLabel = "Find a chapter"
    search.font = ReaderFont.body(16); search.delegate = self
    search.addTarget(self, action: #selector(filterContents), for: .editingChanged)
    search.isHidden = mode != .contents
    segments.isHidden = mode != .appearance
    segments.onSelect = { [weak self] index in self?.panel = index; self?.render() }
    let segmentRow = UIView()
    segmentRow.addSubview(segments); segments.translatesAutoresizingMaskIntoConstraints = false
    let segmentWidth = segments.widthAnchor.constraint(equalToConstant: UIFontMetrics.default.scaledValue(for: 260))
    segmentWidth.priority = .defaultHigh
    NSLayoutConstraint.activate([segments.centerXAnchor.constraint(equalTo: segmentRow.centerXAnchor), segments.topAnchor.constraint(equalTo: segmentRow.topAnchor), segments.bottomAnchor.constraint(equalTo: segmentRow.bottomAnchor), segments.widthAnchor.constraint(lessThanOrEqualTo: segmentRow.widthAnchor), segmentWidth])
    segmentRow.isHidden = mode != .appearance
    for item in [heading, search, segmentRow, scroll] { stack.addArrangedSubview(item) }
    view.addSubview(stack); scroll.addSubview(content)
    stack.translatesAutoresizingMaskIntoConstraints = false; content.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16), stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16), stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 24), stack.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
      heading.heightAnchor.constraint(equalToConstant: 32),
      back.leadingAnchor.constraint(equalTo: heading.leadingAnchor, constant: -6), back.centerYAnchor.constraint(equalTo: heading.centerYAnchor), back.widthAnchor.constraint(equalToConstant: 44), back.heightAnchor.constraint(equalToConstant: 44),
      close.trailingAnchor.constraint(equalTo: heading.trailingAnchor, constant: 6), close.centerYAnchor.constraint(equalTo: heading.centerYAnchor), close.widthAnchor.constraint(equalToConstant: 44), close.heightAnchor.constraint(equalToConstant: 44),
      caption.centerXAnchor.constraint(equalTo: heading.centerXAnchor), caption.centerYAnchor.constraint(equalTo: heading.centerYAnchor),
      search.heightAnchor.constraint(equalToConstant: 44),
      content.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor), content.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor), content.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 4), content.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -16), content.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
    ])
    render()
  }
  func update(_ next: ReaderNativeState) {
    let changed = state.settings != next.settings || state.colors.background != next.colors.background || state.readingStatus != next.readingStatus || state.statusPending != next.statusPending || state.error != next.error || (mode == .contents && state.page != next.page)
    state = next
    if isViewLoaded && changed { render() }
  }
  @objc private func filterContents() { render() }
  func textFieldShouldReturn(_ textField: UITextField) -> Bool { textField.resignFirstResponder(); return true }
  private func render() {
    let colors = state.colors
    overrideUserInterfaceStyle = colors.dark ? .dark : .light
    view.backgroundColor = colors.canvas; view.tintColor = colors.ink
    caption.textColor = colors.detail
    for button in [back, close] { button.style(colors, fill: 0.2, border: 0.6, size: CGSize(width: 32, height: 32)) }
    segments.apply(colors)
    search.backgroundColor = colors.soft.withAlphaComponent(0.4); search.textColor = colors.ink
    for item in content.arrangedSubviews { item.removeFromSuperview() }
    if mode == .contents { renderContents() }
    else if mode == .book { renderBook() }
    else if panel == 0 { renderType() }
    else if panel == 1 { renderLayout() }
    else {
      content.addArrangedSubview(label("Theme"))
      content.addArrangedSubview(ReaderThemeGrid(themes: state.themes, selected: state.settings.theme, font: state.settings.fontFamily) { [weak self] in self?.setting("theme", $0) })
    }
    if !state.error.isEmpty {
      let error = UILabel(); error.text = state.error; error.font = ReaderFont.body(12); error.textColor = colors.ink; error.numberOfLines = 0
      content.addArrangedSubview(error)
    }
  }
  private func label(_ text: String) -> UILabel { let label = readerCaption(text); label.textColor = state.colors.detail; return label }
  private func group(_ title: String, rows: [UIView]) -> UIStackView {
    let group = UIStackView(); group.axis = .vertical; group.spacing = 12
    group.isLayoutMarginsRelativeArrangement = true
    group.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12)
    readerCard(group, colors: state.colors)
    group.addArrangedSubview(label(title))
    for row in rows { group.addArrangedSubview(row) }
    return group
  }
  private func toggle(_ title: String, key: String, value: Bool, enabled: Bool = true) -> UIView {
    let label = UILabel(); label.text = title; label.font = ReaderFont.body(14, weight: .medium); label.textColor = state.colors.ink; label.numberOfLines = 0; label.adjustsFontForContentSizeCategory = true
    let toggle = ReaderSwitch(colors: state.colors); toggle.isOn = value; toggle.isEnabled = enabled; toggle.accessibilityLabel = title
    toggle.addAction(UIAction { [weak self, weak toggle] _ in if let toggle { self?.setting(key, toggle.isOn) } }, for: .valueChanged)
    let row = UIStackView(arrangedSubviews: [label, toggle]); row.alignment = .center; row.spacing = 16
    row.heightAnchor.constraint(greaterThanOrEqualToConstant: 24).isActive = true
    if !enabled { row.alpha = 0.5 }
    return row
  }
  private func renderType() {
    let family = UIStackView(); family.axis = .vertical; family.spacing = 10
    family.addArrangedSubview(label("Font Family"))
    let rail = UIScrollView(); rail.showsHorizontalScrollIndicator = false
    let cards = UIStackView(); cards.spacing = 8
    for (value, title) in fonts {
      let selected = value == state.settings.fontFamily
      let button = readerButton(title) { [weak self] in self?.setting("fontFamily", value) }
      button.configuration?.title = nil
      readerCard(button.surface, colors: state.colors, fill: selected ? 0 : 0.2, border: selected ? 1 : 0.4)
      button.surface.layer.borderWidth = selected ? 2 : 1
      button.accessibilityTraits = selected ? [.button, .selected] : [.button]
      let sample = UILabel(); sample.text = "Aa"; sample.font = ReaderFont.reading(value, size: 30); sample.textColor = state.colors.ink
      let name = readerCaption(title, tracking: 1.2); name.textColor = state.colors.detail
      for item in [sample, name] { button.addSubview(item); item.translatesAutoresizingMaskIntoConstraints = false; item.isUserInteractionEnabled = false }
      NSLayoutConstraint.activate([
        button.widthAnchor.constraint(equalToConstant: 112), button.heightAnchor.constraint(greaterThanOrEqualToConstant: 96),
        sample.topAnchor.constraint(equalTo: button.topAnchor, constant: 12), sample.leadingAnchor.constraint(equalTo: button.leadingAnchor, constant: 12),
        name.leadingAnchor.constraint(equalTo: button.leadingAnchor, constant: 12), name.bottomAnchor.constraint(equalTo: button.bottomAnchor, constant: -12),
      ])
      cards.addArrangedSubview(button)
    }
    rail.addSubview(cards); cards.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      cards.leadingAnchor.constraint(equalTo: rail.contentLayoutGuide.leadingAnchor), cards.trailingAnchor.constraint(equalTo: rail.contentLayoutGuide.trailingAnchor), cards.topAnchor.constraint(equalTo: rail.contentLayoutGuide.topAnchor), cards.bottomAnchor.constraint(equalTo: rail.contentLayoutGuide.bottomAnchor), cards.heightAnchor.constraint(equalTo: rail.frameLayoutGuide.heightAnchor), rail.heightAnchor.constraint(equalToConstant: 100),
    ])
    family.addArrangedSubview(rail); content.addArrangedSubview(family)
    content.addArrangedSubview(group("Publisher Styling", rows: [
      toggle("Book styles", key: "publisherBookStylingEnabled", value: state.settings.publisherBookStylingEnabled),
      toggle("Match body text size", key: "matchPublisherBodyTextSize", value: state.settings.matchPublisherBodyTextSize, enabled: state.settings.publisherBookStylingEnabled),
    ]))
    let size = UIStackView(); size.axis = .vertical; size.spacing = 8; size.addArrangedSubview(label("Font Size"))
    let minus = readerButton("Decrease font size", symbol: "minus") { [weak self] in guard let self else { return }; self.setting("fontSize", max(8, self.state.settings.fontSize - 1)) }
    let plus = readerButton("Increase font size", symbol: "plus") { [weak self] in guard let self else { return }; self.setting("fontSize", min(32, self.state.settings.fontSize + 1)) }
    for button in [minus, plus] { button.style(state.colors, fill: 0.8, border: 0.6, radius: 20, size: CGSize(width: 40, height: 40)) }
    minus.isEnabled = state.settings.fontSize > 8; plus.isEnabled = state.settings.fontSize < 32
    let value = readerCaption("\(Int(state.settings.fontSize)) px", size: 14, tracking: 1.68); value.textAlignment = .center; value.textColor = state.colors.ink
    let row = UIStackView(arrangedSubviews: [minus, value, plus]); row.alignment = .center
    row.isLayoutMarginsRelativeArrangement = true; row.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
    readerCard(row, colors: state.colors)
    minus.setContentHuggingPriority(.required, for: .horizontal); plus.setContentHuggingPriority(.required, for: .horizontal)
    size.addArrangedSubview(row); content.addArrangedSubview(size)
  }
  private func renderLayout() {
    content.addArrangedSubview(group("Reading", rows: [toggle("Page animations", key: "pageAnimationsEnabled", value: state.settings.pageAnimationsEnabled), toggle("Page numbers", key: "showPageNumbers", value: state.settings.showPageNumbers)]))
    let heights = [1.2, 1.5, 1.8, 2.0]
    let lineHeight = ReaderSegments(["1.2", "1.5", "1.8", "2.0"], height: 36)
    lineHeight.apply(state.colors); lineHeight.select(heights.firstIndex(of: state.settings.lineHeight) ?? 1)
    lineHeight.onSelect = { [weak self] in self?.setting("lineHeight", heights[$0]) }
    content.addArrangedSubview(label("Line Height")); content.setCustomSpacing(8, after: content.arrangedSubviews.last!); content.addArrangedSubview(lineHeight)
    let values = ["left", "center", "right", "justify-knuth-plass"]
    let alignment = ReaderSegments(["Left", "Center", "Right", "Justify"], icons: ["align-left", "align-center", "align-right", "align-justify"], height: 36)
    alignment.apply(state.colors); alignment.select(values.firstIndex(of: state.settings.textAlign) ?? 3)
    for button in alignment.arrangedSubviews.compactMap({ $0 as? UIButton }) { button.configuration?.title = nil }
    alignment.onSelect = { [weak self] in self?.setting("textAlign", values[$0]) }
    content.addArrangedSubview(label("Alignment")); content.setCustomSpacing(8, after: content.arrangedSubviews.last!); content.addArrangedSubview(alignment)
  }
  private func renderContents() {
    content.spacing = 4
    let chapters = state.contents.filter { (search.text ?? "").isEmpty || $0.title.localizedCaseInsensitiveContains(search.text ?? "") }
    let active = state.contents.last(where: { $0.page > 0 && $0.page <= state.page })?.id
    for (index, chapter) in chapters.enumerated() {
      let button = readerButton(chapter.title) { [weak self] in
        guard let self else { return }; _ = self.command(["action": "chapter", "href": chapter.href]); self.dismiss(animated: true)
      }
      button.configuration?.title = nil
      if chapter.id == active { readerCard(button.surface, colors: state.colors, fill: 0.45, border: 0, radius: 12); button.accessibilityTraits = [.button, .selected] }
      let number = readerCaption(String(format: "%02d", index + 1), tracking: 0.5); number.textColor = state.colors.detail
      let title = UILabel(); title.text = chapter.title; title.font = ReaderFont.body(14, weight: .medium); title.textColor = state.colors.ink; title.numberOfLines = 2
      let page = UILabel(); page.text = chapter.page > 0 ? "\(chapter.page)" : ""; page.font = ReaderFont.body(12); page.textColor = state.colors.detail
      let row = UIStackView(arrangedSubviews: [number, title, page]); row.spacing = 12; row.alignment = .firstBaseline; row.isUserInteractionEnabled = false
      button.addSubview(row); row.translatesAutoresizingMaskIntoConstraints = false
      number.widthAnchor.constraint(equalToConstant: 36).isActive = true; page.setContentHuggingPriority(.required, for: .horizontal)
      NSLayoutConstraint.activate([row.leadingAnchor.constraint(equalTo: button.leadingAnchor, constant: 4 + CGFloat(chapter.depth) * 12), row.trailingAnchor.constraint(equalTo: button.trailingAnchor, constant: -4), row.topAnchor.constraint(equalTo: button.topAnchor, constant: 12), row.bottomAnchor.constraint(equalTo: button.bottomAnchor, constant: -12), button.heightAnchor.constraint(greaterThanOrEqualToConstant: 48)])
      content.addArrangedSubview(button)
    }
    if chapters.isEmpty { let empty = UILabel(); empty.text = "No matching chapters"; empty.font = ReaderFont.body(14); empty.textColor = state.colors.detail; content.addArrangedSubview(empty) }
  }
  private func renderBook() {
    let title = UILabel(); title.text = state.title; title.font = ReaderFont.literary(24); title.textColor = state.colors.ink; title.numberOfLines = 0
    let author = UILabel(); author.text = state.author; author.font = ReaderFont.body(14); author.textColor = state.colors.detail
    content.addArrangedSubview(title); content.addArrangedSubview(author)
    for (value, name) in [("want-to-read", "Want to Read"), ("reading", "Reading"), ("finished", "Finished"), ("dnf", "Did Not Finish")] {
      let button = readerButton(name) { [weak self] in _ = self?.command(["action": "reading-status", "status": value]) }
      button.style(state.colors, fill: state.readingStatus == value ? 0 : 0.4, border: 0.6, radius: 20)
      button.surface.backgroundColor = state.colors.soft.withAlphaComponent(state.readingStatus == value ? 0.65 : 0.35)
      button.isEnabled = !state.statusPending
      button.accessibilityTraits = state.readingStatus == value ? [.button, .selected] : [.button]
      content.addArrangedSubview(button)
    }
    let remove = readerButton("Remove from Library", symbol: "trash-2") { [weak self] in self?.confirmRemove() }
    remove.configuration?.title = "Remove from Library"; remove.tintColor = state.colors.detail
    content.addArrangedSubview(remove)
  }
  private func confirmRemove() {
    let alert = UIAlertController(title: "Remove \(state.title)?", message: "This removes the book and its notes from this library.", preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Remove", style: .destructive) { [weak self] _ in _ = self?.command(["action": "remove-book"]) })
    present(alert, animated: true)
  }
  private func setting(_ key: String, _ value: Any) { _ = command(["action": "settings", "patch": [key: value]]) }
}

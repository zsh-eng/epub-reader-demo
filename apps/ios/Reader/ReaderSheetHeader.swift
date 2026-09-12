import UIKit

/// Matches the notebook's small DM Sans heading and plain icon actions.
final class ReaderSheetHeader: UIStackView {
  private let label = UILabel()
  private let close: ReaderButton
  init(title: String, onClose: @escaping () -> Void) {
    close = readerButton("Close notebook", symbol: "x", action: onClose)
    super.init(frame: .zero)
    axis = .horizontal; alignment = .center; spacing = 0
    label.text = title; label.font = ReaderFont.body(14, weight: .medium)
    label.adjustsFontForContentSizeCategory = true
    addArrangedSubview(label); addArrangedSubview(close)
    close.setContentHuggingPriority(.required, for: .horizontal)
  }
  required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  func setTitle(_ title: String) { label.text = title }
  func insertAction(_ button: UIButton) { button.setContentHuggingPriority(.required, for: .horizontal); insertArrangedSubview(button, at: arrangedSubviews.count - 1) }
  func apply(_ colors: ReaderNativeColors) { label.textColor = colors.ink; tintColor = colors.detail }
}

final class ReaderSegments: UIStackView {
  var onSelect: ((Int) -> Void)?
  private(set) var selected = 0
  private var colors = ReaderNativeColors.paper
  init(_ titles: [String], icons: [String] = [], height: CGFloat = 40) {
    super.init(frame: .zero)
    axis = .horizontal; distribution = .fillEqually; spacing = 0
    isLayoutMarginsRelativeArrangement = true
    directionalLayoutMargins = NSDirectionalEdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4)
    layer.cornerRadius = 24
    for (index, title) in titles.enumerated() {
      let button = readerButton(title, minimumHeight: height) { [weak self] in self?.select(index); ReaderHaptics.selection(); self?.onSelect?(index) }
      button.configuration?.title = title.uppercased()
      if icons.indices.contains(index) { button.configuration?.image = readerIcon(icons[index]); button.configuration?.imagePadding = 6 }
      button.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
        var attributes = attributes; attributes.font = ReaderFont.body(10, weight: .medium); attributes.kern = 1.2; return attributes
      }
      addArrangedSubview(button)
    }
    select(0)
  }
  required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  func apply(_ colors: ReaderNativeColors) { self.colors = colors; select(selected) }
  func select(_ index: Int) {
    selected = index; backgroundColor = colors.soft.withAlphaComponent(0.5)
    for (key, view) in arrangedSubviews.enumerated() {
      guard let button = view as? ReaderButton else { continue }
      button.style(colors, fill: key == index ? 1 : 0, border: 0, radius: 22)
      button.tintColor = key == index ? colors.ink : colors.detail
      button.accessibilityTraits = key == index ? [.button, .selected] : [.button]
    }
  }
}

import UIKit

/// A solid sheet surface with Reader typography. Presentation and dragging stay
/// with UISheetPresentationController; content does not inherit glass toolbars.
final class ReaderSheetHeader: UIStackView {
  private let label = UILabel()
  private let close: UIButton
  init(title: String, onClose: @escaping () -> Void) {
    close = readerButton("Close", symbol: "xmark", action: onClose)
    super.init(frame: .zero)
    axis = .horizontal
    alignment = .center
    spacing = 8
    label.text = title
    label.font = ReaderFont.literary(26)
    label.adjustsFontForContentSizeCategory = true
    label.setContentHuggingPriority(.defaultLow, for: .horizontal)
    addArrangedSubview(label)
    addArrangedSubview(close)
    close.setContentHuggingPriority(.required, for: .horizontal)
  }
  required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  func setTitle(_ title: String) { label.text = title }
  func insertAction(_ button: UIButton) {
    button.setContentHuggingPriority(.required, for: .horizontal)
    insertArrangedSubview(button, at: arrangedSubviews.count - 1)
  }
  func apply(_ colors: ReaderNativeColors) {
    label.textColor = colors.ink
    tintColor = colors.detail
    close.backgroundColor = colors.soft
    close.layer.cornerRadius = 22
  }
}

final class ReaderSegments: UIStackView {
  var onSelect: ((Int) -> Void)?
  private var selected = 0
  private var colors = ReaderNativeColors.paper
  init(_ titles: [String]) {
    super.init(frame: .zero)
    axis = .horizontal
    distribution = .fillEqually
    spacing = 4
    isLayoutMarginsRelativeArrangement = true
    directionalLayoutMargins = NSDirectionalEdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4)
    layer.cornerRadius = 26
    for (index, title) in titles.enumerated() {
      let button = readerButton(title) { [weak self] in
        self?.select(index)
        self?.onSelect?(index)
      }
      button.configuration?.title = title.uppercased()
      button.layer.cornerRadius = 22
      addArrangedSubview(button)
    }
    select(0)
  }
  required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  func apply(_ colors: ReaderNativeColors) { self.colors = colors; select(selected) }
  private func select(_ index: Int) {
    selected = index
    backgroundColor = colors.soft
    for (key, button) in arrangedSubviews.enumerated() {
      button.backgroundColor = key == index ? colors.canvas : .clear
      button.tintColor = key == index ? colors.ink : colors.detail
      button.accessibilityTraits = key == index ? [.button, .selected] : [.button]
    }
  }
}

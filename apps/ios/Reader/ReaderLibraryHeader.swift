import UIKit

/// Library's original pill search and circular navigation trigger. The search
/// field is a native editor; its frame, font, artwork, and colours follow the web.
final class ReaderLibraryHeader: UIView, UITextFieldDelegate {
  var onSearch: ((String) -> Void)?
  var onNavigation: (() -> Void)?
  private let field = UISearchTextField()
  private var scrollOffset: CGFloat = 0
  private lazy var navigation = readerButton("Open navigation", symbol: "ellipsis") { [weak self] in self?.onNavigation?() }
  override init(frame: CGRect) {
    super.init(frame: frame)
    field.font = ReaderFont.body(16)
    field.placeholder = "Search my library…"
    field.accessibilityLabel = "Search library"
    field.accessibilityIdentifier = "library-search"
    field.borderStyle = .none; field.backgroundColor = .clear
    field.autocapitalizationType = .none; field.autocorrectionType = .no
    field.returnKeyType = .search; field.delegate = self
    field.addTarget(self, action: #selector(changed), for: .editingChanged)
    let icon = UIImageView(image: readerIcon("search")); icon.contentMode = .center
    icon.frame = CGRect(x: 0, y: 0, width: 36, height: 40)
    field.leftView = icon; field.leftViewMode = .always
    field.layer.cornerRadius = 28; field.layer.borderWidth = 1
    field.layer.shadowOffset = CGSize(width: 0, height: 3); field.layer.shadowRadius = 4; field.layer.shadowOpacity = 0.1
    addSubview(field); addSubview(navigation)
    heightAnchor.constraint(equalToConstant: 173).isActive = true
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func layoutSubviews() {
    super.layoutSubviews()
    let compact = scrollOffset > 64 && !UIAccessibility.isReduceMotionEnabled
    let width = min(bounds.width - 32, 768) * (compact ? 0.94 : 1)
    let x = (bounds.width - width) / 2
    let y = max(12, 77 - scrollOffset)
    let size: CGFloat = compact ? 52.64 : 56
    field.frame = CGRect(x: x, y: y, width: max(0, width - size - 12), height: size)
    navigation.frame = CGRect(x: x + width - size, y: y, width: size, height: size)
  }
  func updateScroll(_ offset: CGFloat) { scrollOffset = offset; setNeedsLayout() }
  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    field.frame.contains(point) || navigation.frame.contains(point)
  }
  func apply(_ colors: ReaderNativeColors) {
    field.textColor = colors.ink
    field.tintColor = colors.detail
    field.leftView?.tintColor = colors.detail
    field.attributedPlaceholder = NSAttributedString(string: "Search my library…", attributes: [.font: ReaderFont.body(16), .foregroundColor: colors.detail])
    field.backgroundColor = colors.canvas.withAlphaComponent(0.75)
    field.layer.borderColor = colors.rule.cgColor
    field.layer.shadowColor = colors.ink.cgColor
    navigation.style(colors, fill: 0.75, border: 0.6, radius: 28)
    navigation.surface.layer.shadowColor = colors.ink.cgColor; navigation.surface.layer.shadowOpacity = 0.1
    navigation.surface.layer.shadowRadius = 4; navigation.surface.layer.shadowOffset = CGSize(width: 0, height: 3)
  }
  @objc private func changed() { onSearch?(field.text ?? "") }
  func textFieldShouldReturn(_ textField: UITextField) -> Bool { textField.resignFirstResponder(); return true }
}

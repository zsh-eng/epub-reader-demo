import UIKit

/// These views reproduce the web components. Only their input handling belongs
/// to UIKit. Small visual buttons keep a 44 pt touch and accessibility target.
final class ReaderButton: UIButton {
  let surface = UIView()
  var visualSize: CGSize? { didSet { setNeedsLayout() } }
  override init(frame: CGRect) {
    super.init(frame: frame)
    surface.isUserInteractionEnabled = false
    insertSubview(surface, at: 0)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func layoutSubviews() {
    super.layoutSubviews()
    sendSubviewToBack(surface)
    let size = visualSize ?? bounds.size
    surface.frame = CGRect(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2, width: size.width, height: size.height)
  }
  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    bounds.insetBy(dx: -max(0, (44 - bounds.width) / 2), dy: -max(0, (44 - bounds.height) / 2)).contains(point)
  }
  override var isHighlighted: Bool {
    didSet {
      let scale: CGFloat = isHighlighted && !UIAccessibility.isReduceMotionEnabled ? 0.97 : 1
      UIView.animate(withDuration: 0.16, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
        self.transform = CGAffineTransform(scaleX: scale, y: scale)
        self.alpha = self.isHighlighted ? 0.7 : self.isEnabled ? 1 : 0.35
      }
    }
  }
  override var isEnabled: Bool { didSet { alpha = isEnabled ? 1 : 0.35 } }
  func style(_ colors: ReaderNativeColors, fill: CGFloat = 0.7, border: CGFloat = 0.7, radius: CGFloat = 16, size: CGSize? = nil) {
    backgroundColor = .clear
    tintColor = colors.detail
    visualSize = size
    surface.backgroundColor = colors.canvas.withAlphaComponent(fill)
    surface.layer.cornerRadius = radius
    surface.layer.borderWidth = border > 0 ? 1 : 0
    surface.layer.borderColor = colors.rule.withAlphaComponent(border).cgColor
  }
}

func readerIcon(_ name: String, size: CGFloat = 16) -> UIImage? {
  let aliases = ["chevron.left": "chevron-left", "chevron.right": "chevron-right", "xmark": "x", "list.bullet": "list", "square.and.pencil": "pencil-line", "textformat.size": "type", "slider.horizontal.3": "arrow-down-up", "arrow.up": "arrow-up", "checkmark": "check"]
  guard let image = UIImage(named: "reader-\(aliases[name] ?? name)") else { return UIImage(systemName: name) }
  return UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { _ in image.draw(in: CGRect(x: 0, y: 0, width: size, height: size)) }.withRenderingMode(.alwaysTemplate)
}

func readerButton(_ title: String, symbol: String? = nil, minimumHeight: CGFloat = 44, action: @escaping () -> Void) -> ReaderButton {
  let button = ReaderButton(type: .custom)
  var config = UIButton.Configuration.plain()
  config.title = symbol == nil ? title : nil
  config.image = symbol.flatMap { readerIcon($0) }
  config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 6, bottom: 6, trailing: 6)
  config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
    var attributes = attributes; attributes.font = ReaderFont.body(14, weight: .medium); return attributes
  }
  button.configuration = config
  button.accessibilityLabel = title
  button.addAction(UIAction { _ in action() }, for: .touchUpInside)
  button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
  button.heightAnchor.constraint(greaterThanOrEqualToConstant: minimumHeight).isActive = true
  return button
}

func readerCaption(_ text: String, size: CGFloat = 10, tracking: CGFloat = 1.8) -> UILabel {
  let label = UILabel()
  label.attributedText = NSAttributedString(string: text.uppercased(), attributes: [.font: ReaderFont.body(size, weight: .medium), .kern: tracking])
  label.adjustsFontForContentSizeCategory = true
  return label
}

func readerCard(_ view: UIView, colors: ReaderNativeColors, fill: CGFloat = 0.2, border: CGFloat = 0.5, radius: CGFloat = 20) {
  view.backgroundColor = colors.soft.withAlphaComponent(fill)
  view.layer.cornerRadius = radius
  view.layer.cornerCurve = .continuous
  view.layer.borderWidth = 1
  view.layer.borderColor = colors.rule.withAlphaComponent(border).cgColor
}

/// Optional, short feedback is generated locally; a web render or bridge round
/// trip cannot delay the tactile response. No haptic represents an unsaved write.
enum ReaderHaptics {
  static var enabled: Bool {
    get { UserDefaults.standard.object(forKey: "reader.haptics") as? Bool ?? true }
    set { UserDefaults.standard.set(newValue, forKey: "reader.haptics") }
  }
  static func selection() { if enabled { UISelectionFeedbackGenerator().selectionChanged() } }
  static func boundary() { if enabled { UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.65) } }
}

/// The web switch's small visual track with native activation and accessibility.
final class ReaderSwitch: UIControl {
  var isOn = false { didSet { update(animated: window != nil) } }
  private let track = UIView()
  private let thumb = UIView()
  private let colors: ReaderNativeColors
  init(colors: ReaderNativeColors) {
    self.colors = colors
    super.init(frame: .zero)
    addSubview(track); track.addSubview(thumb)
    track.isUserInteractionEnabled = false
    track.layer.cornerRadius = 9; thumb.layer.cornerRadius = 7
    thumb.backgroundColor = colors.canvas
    isAccessibilityElement = true
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(toggle)))
    widthAnchor.constraint(equalToConstant: 44).isActive = true
    heightAnchor.constraint(equalToConstant: 24).isActive = true
    update(animated: false)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func layoutSubviews() { super.layoutSubviews(); track.frame = CGRect(x: bounds.midX - 16, y: bounds.midY - 9, width: 32, height: 18); update(animated: false) }
  private func update(animated: Bool) {
    accessibilityValue = isOn ? "On" : "Off"
    accessibilityTraits = isOn ? [.button, .selected] : [.button]
    UIView.animate(withDuration: animated && !UIAccessibility.isReduceMotionEnabled ? 0.16 : 0, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
      self.track.backgroundColor = self.isOn ? self.colors.ink : self.colors.rule
      self.thumb.frame = CGRect(x: self.isOn ? 16 : 2, y: 2, width: 14, height: 14)
    }
  }
  @objc private func toggle() { guard isEnabled else { return }; isOn.toggle(); ReaderHaptics.selection(); sendActions(for: .valueChanged) }
  override func accessibilityActivate() -> Bool { toggle(); return isEnabled }
}

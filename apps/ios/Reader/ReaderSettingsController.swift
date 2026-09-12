import UIKit

/// Device preferences use the web Settings page's compact type and rounded card.
final class ReaderSettingsController: UIViewController {
  var onBack: (() -> Void)?
  private let runtime: ReaderRuntime
  private var colors = ReaderNativeColors.paper
  private let stack = UIStackView()
  init(runtime: ReaderRuntime) { self.runtime = runtime; super.init(nibName: nil, bundle: nil) }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func viewDidLoad() {
    super.viewDidLoad()
    let scroll = UIScrollView(); scroll.alwaysBounceVertical = true
    view.addSubview(scroll); scroll.translatesAutoresizingMaskIntoConstraints = false
    stack.axis = .vertical; stack.spacing = 24
    scroll.addSubview(stack); stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor), scroll.topAnchor.constraint(equalTo: view.topAnchor), scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 16), stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -16), stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 64), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24), stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -32),
    ])
    apply(colors)
  }
  func apply(_ colors: ReaderNativeColors) {
    self.colors = colors
    guard isViewLoaded else { return }
    view.backgroundColor = colors.canvas; view.tintColor = colors.ink
    for view in stack.arrangedSubviews { view.removeFromSuperview() }
    let back = readerButton("Back to library", symbol: "chevron-left") { [weak self] in self?.onBack?() }
    back.style(colors, size: CGSize(width: 32, height: 32))
    let title = UILabel(); title.text = "Settings"; title.font = ReaderFont.body(24, weight: .semibold); title.textColor = colors.ink; title.textAlignment = .center
    let space = UIView(); space.widthAnchor.constraint(equalToConstant: 44).isActive = true
    let heading = UIStackView(arrangedSubviews: [back, title, space]); heading.alignment = .center
    stack.addArrangedSubview(heading)
    let description = UILabel(); description.text = "Preferences for this device."; description.font = ReaderFont.body(14); description.textColor = colors.detail; description.textAlignment = .center
    stack.setCustomSpacing(4, after: heading); stack.addArrangedSubview(description)
    let section = UIStackView(); section.axis = .vertical; section.spacing = 8
    let label = readerCaption("This Device", size: 12, tracking: 0.6); label.textColor = colors.detail; section.addArrangedSubview(label)
    let card = UIStackView(); card.axis = .vertical; card.spacing = 8
    card.isLayoutMarginsRelativeArrangement = true; card.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16)
    readerCard(card, colors: colors, fill: 0.5, border: 0, radius: 24)
    card.addArrangedSubview(row("Keep screen awake", detail: "While a book is open.", icon: "sun", value: runtime.keepAwake) { [weak self] in self?.runtime.keepAwake = $0 })
    card.addArrangedSubview(row("Haptic feedback", detail: "Subtle feedback while using reading controls.", icon: "move-vertical", value: ReaderHaptics.enabled) { ReaderHaptics.enabled = $0 })
    section.addArrangedSubview(card); stack.addArrangedSubview(section)
  }
  private func row(_ title: String, detail: String, icon: String, value: Bool, changed: @escaping (Bool) -> Void) -> UIView {
    let image = UIImageView(image: readerIcon(icon, size: 20)); image.tintColor = colors.detail; image.contentMode = .center
    image.widthAnchor.constraint(equalToConstant: 40).isActive = true; image.heightAnchor.constraint(equalToConstant: 40).isActive = true
    image.backgroundColor = colors.soft; image.layer.cornerRadius = 20
    let name = UILabel(); name.text = title; name.font = ReaderFont.body(14, weight: .medium); name.textColor = colors.ink
    let subtitle = UILabel(); subtitle.text = detail; subtitle.font = ReaderFont.body(12); subtitle.textColor = colors.detail; subtitle.numberOfLines = 0
    let text = UIStackView(arrangedSubviews: [name, subtitle]); text.axis = .vertical; text.spacing = 2
    let toggle = UISwitch(); toggle.isOn = value; toggle.onTintColor = colors.ink; toggle.accessibilityLabel = title
    toggle.addAction(UIAction { [weak toggle] _ in if let toggle { changed(toggle.isOn) } }, for: .valueChanged)
    let row = UIStackView(arrangedSubviews: [image, text, toggle]); row.alignment = .center; row.spacing = 16
    row.heightAnchor.constraint(greaterThanOrEqualToConstant: 64).isActive = true
    return row
  }
}

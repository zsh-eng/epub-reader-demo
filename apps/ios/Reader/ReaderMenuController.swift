import UIKit

/// Native version of the web command sheets: numbered, softly bordered rows.
/// System presentation supplies dismissal; content keeps Reader's visual order.
final class ReaderMenuController: UIViewController {
  struct Item {
    let title, icon: String
    var enabled = true
    var selected = false
    let action: () -> Void
  }
  private let titleText: String
  private let items: [Item]
  private let colors: ReaderNativeColors
  private let utilities: [Item]
  private let recent: ReaderRecentBook?
  private let onContinue: ((String) -> Void)?
  init(title: String, items: [Item], colors: ReaderNativeColors, utilities: [Item] = [], recent: ReaderRecentBook? = nil, onContinue: ((String) -> Void)? = nil) {
    titleText = title; self.items = items; self.colors = colors; self.utilities = utilities
    self.recent = recent; self.onContinue = onContinue
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .pageSheet
    let height = CGFloat(items.count * 72 + (title.isEmpty ? 28 : 60) + (utilities.isEmpty ? 0 : 76) + (recent == nil ? 0 : 208))
    sheetPresentationController?.detents = [.custom { context in min(height, context.maximumDetentValue) }]
    sheetPresentationController?.prefersGrabberVisible = true
    sheetPresentationController?.preferredCornerRadius = 28
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = colors.canvas
    overrideUserInterfaceStyle = colors.dark ? .dark : .light
    let scroll = UIScrollView()
    let stack = UIStackView()
    stack.axis = .vertical; stack.spacing = 8
    if let recent {
      stack.addArrangedSubview(readerContinueCard(recent, colors: colors) { [weak self] in
        guard let self else { return }
        let action = self.onContinue
        self.dismiss(animated: true) { action?(recent.id) }
      })
    }
    if !titleText.isEmpty {
      let title = readerCaption(titleText)
      title.textColor = colors.detail; title.textAlignment = .center
      title.heightAnchor.constraint(equalToConstant: 32).isActive = true
      stack.addArrangedSubview(title)
    }
    for (index, item) in items.enumerated() {
      let button = readerButton(item.title) { [weak self] in self?.dismiss(animated: true, completion: item.action) }
      button.configuration?.title = nil
      button.isEnabled = item.enabled
      button.accessibilityTraits = item.selected ? [.button, .selected] : [.button]
      readerCard(button.surface, colors: colors, fill: item.selected ? 0.65 : 0.35, border: item.selected ? 1 : 0.6)
      let indexLabel = readerCaption(String(format: "%02d", index + 1), tracking: 1.4)
      indexLabel.textColor = colors.detail
      let label = UILabel(); label.text = item.title; label.font = ReaderFont.body(14, weight: .medium); label.textColor = colors.ink
      label.adjustsFontForContentSizeCategory = true
      let text = UIStackView(arrangedSubviews: [indexLabel, label]); text.axis = .vertical; text.spacing = 4
      let icon = UIImageView(image: readerIcon(item.icon)); icon.tintColor = colors.detail
      for subview in [text, icon] { subview.isUserInteractionEnabled = false; subview.translatesAutoresizingMaskIntoConstraints = false; button.addSubview(subview) }
      NSLayoutConstraint.activate([
        text.leadingAnchor.constraint(equalTo: button.leadingAnchor, constant: 16), text.topAnchor.constraint(equalTo: button.topAnchor, constant: 12), text.bottomAnchor.constraint(equalTo: button.bottomAnchor, constant: -12),
        text.trailingAnchor.constraint(lessThanOrEqualTo: icon.leadingAnchor, constant: -12),
        icon.trailingAnchor.constraint(equalTo: button.trailingAnchor, constant: -16), icon.centerYAnchor.constraint(equalTo: button.centerYAnchor), icon.widthAnchor.constraint(equalToConstant: 16), icon.heightAnchor.constraint(equalToConstant: 16),
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 64),
      ])
      stack.addArrangedSubview(button)
    }
    if !utilities.isEmpty {
      let row = UIStackView(); row.distribution = .fillEqually
      readerCard(row, colors: colors, border: 0.6)
      for item in utilities {
        let button = readerButton(item.title, symbol: item.icon) { [weak self] in self?.dismiss(animated: true, completion: item.action) }
        button.configuration?.title = item.title.uppercased()
        button.configuration?.imagePlacement = .top
        button.configuration?.imagePadding = 6
        button.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
          var attributes = attributes; attributes.font = ReaderFont.body(10, weight: .medium); attributes.kern = 1.2; return attributes
        }
        button.tintColor = colors.detail; button.isEnabled = item.enabled
        row.addArrangedSubview(button)
      }
      row.heightAnchor.constraint(equalToConstant: 64).isActive = true
      stack.setCustomSpacing(12, after: stack.arrangedSubviews.last!)
      stack.addArrangedSubview(row)
    }
    view.addSubview(scroll); scroll.addSubview(stack)
    for item in [scroll, stack] { item.translatesAutoresizingMaskIntoConstraints = false }
    NSLayoutConstraint.activate([
      scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor), scroll.topAnchor.constraint(equalTo: view.topAnchor, constant: 24), scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 16), stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -16), stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -16), stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -32),
    ])
  }
}

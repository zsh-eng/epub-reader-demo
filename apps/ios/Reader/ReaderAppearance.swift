import UIKit

/// CSS is authoritative. This cache preserves the first frame before WebKit is
/// ready, including across the Expo-to-Swift app upgrade.
final class ReaderAppearance {
  private(set) var colors: ReaderNativeColors
  init() {
    let cached = UserDefaults.standard.string(forKey: "reader.appearance") ?? ""
    colors = Self.decode(cached.data(using: .utf8)) ?? .paper
  }
  @discardableResult func update(_ value: [String: Any]) -> Bool {
    guard let data = try? JSONSerialization.data(withJSONObject: value), let next = Self.decode(data) else { return false }
    colors = next
    UserDefaults.standard.set(String(decoding: data, as: UTF8.self), forKey: "reader.appearance")
    return true
  }
  private static func decode(_ data: Data?) -> ReaderNativeColors? {
    guard let data, let colors = try? JSONDecoder().decode(ReaderNativeColors.self, from: data),
          [colors.background, colors.foreground, colors.secondary, colors.muted, colors.primary, colors.border].allSatisfy({ $0.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil }) else { return nil }
    return colors
  }
}

extension ReaderNativeColors {
  // Existing Flexoki Light tokens in src/index.css; web snapshots replace this
  // fresh-install fallback as soon as the first screen loads.
  static let paper = ReaderNativeColors(background: "#fffcf0", foreground: "#100f0f", secondary: "#f1efe4", muted: "#6e6d68", primary: "#100f0f", border: "#e7e5da", dark: false)
  var rule: UIColor { UIColor(readerHex: border) }
}

enum ReaderFont {
  static func body(_ size: CGFloat = 16, weight: UIFont.Weight = .regular) -> UIFont {
    let name = weight == .regular ? "DMSans-Regular" : "DMSans-SemiBold"
    return UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: weight))
  }
  static func literary(_ size: CGFloat = 22) -> UIFont {
    UIFontMetrics(forTextStyle: .title2).scaledFont(for: UIFont(name: "EBGaramond-Regular", size: size) ?? UIFont(descriptor: UIFont.systemFont(ofSize: size).fontDescriptor.withDesign(.serif)!, size: size))
  }
}

/// Plain, themed buttons keep the web app's quiet chrome. UIKit still supplies
/// accessibility, context menus, and touch tracking without a glass toolbar.
func readerButton(_ title: String, symbol: String? = nil, action: @escaping () -> Void) -> UIButton {
  let button = UIButton(type: .system)
  var config = UIButton.Configuration.plain()
  config.title = symbol == nil ? title : nil
  config.image = symbol.flatMap { UIImage(systemName: $0) }
  config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 18, weight: .regular)
  config.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
  config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
    var attributes = attributes; attributes.font = ReaderFont.body(14); return attributes
  }
  button.configuration = config
  button.accessibilityLabel = title
  button.addAction(UIAction { _ in action() }, for: .touchUpInside)
  button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
  button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
  return button
}

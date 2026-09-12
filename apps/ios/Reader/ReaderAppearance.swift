import UIKit

/// CSS is authoritative. This cache preserves the first frame before WebKit is
/// ready, including across app upgrades.
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
  static let paper = ReaderNativeColors(background: "#fffcf0", foreground: "#100f0f", secondary: "#f1efe4", muted: "#6e6d68", primary: "#100f0f", border: "#e7e5da", dark: false, marks: [:])
  var rule: UIColor { UIColor(readerHex: border) }
}

enum ReaderFont {
  static func body(_ size: CGFloat = 16, weight: UIFont.Weight = .regular) -> UIFont {
    let name = weight == .regular ? "DMSans-Regular" : weight == .medium ? "DMSans-Medium" : "DMSans-SemiBold"
    return UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: weight))
  }
  static func literary(_ size: CGFloat = 22) -> UIFont { reading("garamond", size: size) }
  static func reading(_ family: String, size: CGFloat) -> UIFont {
    let names = ["lora": "Lora-Regular", "garamond": "EBGaramond-Regular", "inter": "Inter-Regular", "iowan": "IowanOldStyle-Roman", "monospace": "Menlo-Regular"]
    let font = names[family].flatMap { UIFont(name: $0, size: size) } ?? .systemFont(ofSize: size)
    return UIFontMetrics(forTextStyle: .body).scaledFont(for: font)
  }
}

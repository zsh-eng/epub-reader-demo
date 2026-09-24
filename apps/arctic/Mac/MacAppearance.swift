import AppKit
import Observation
import SwiftUI
import WebKit

/// One persisted reading recipe is applied before first paint and to every warm
/// reader. Changing tabs does not reset the user's typography or colour choice.
@MainActor @Observable final class MacAppearance {
  static let shared = MacAppearance()
  var theme: String { didSet { save() } }
  var font: String { didSet { save() } }
  var size: Int { didSet { save() } }
  var leading: Double { didSet { save() } }
  var width: Int { didSet { save() } }
  var highRefresh: Bool { didSet { save() } }
  static let changed = Notification.Name("ArcticMacAppearanceChanged")
  private init() {
    let d = UserDefaults.standard
    theme = d.string(forKey: "mac.reader.theme") ?? "System"
    font = d.string(forKey: "mac.reader.font") ?? "System"
    size = d.object(forKey: "mac.reader.size") as? Int ?? 18
    leading = d.object(forKey: "mac.reader.leading") as? Double ?? 1.6
    width = d.object(forKey: "mac.reader.width") as? Int ?? 640
    highRefresh = d.object(forKey: "mac.reader.highRefresh") as? Bool ?? true
  }
  private func save() {
    let values: [String: Any] = [
      "theme": theme, "font": font, "size": size,
      "leading": leading, "width": width, "highRefresh": highRefresh,
    ]
    for (key, value) in values { UserDefaults.standard.set(value, forKey: "mac.reader." + key) }
    NotificationCenter.default.post(name: Self.changed, object: nil)
  }
  var css: String {
    let family =
      font == "Serif"
      ? "'EB Garamond', Georgia, serif"
      : font == "DM Sans" ? "'DM Sans', sans-serif" : "-apple-system, sans-serif"
    let palette: String
    switch theme {
    case "Paper":
      palette =
        "color-scheme:light;--background:hsl(48 100% 97%);--foreground:hsl(0 3% 6%);--muted:hsl(48 30% 92%);--border:hsl(48 20% 84%);"
    case "Ink":
      palette =
        "color-scheme:dark;--background:#171717;--foreground:#cecec4;--muted:#252525;--border:#383838;"
    case "Light":
      palette =
        "color-scheme:light;--background:#fff;--foreground:rgb(10,10,10);--muted:rgb(245,245,245);--border:#ddd;"
    default: palette = ""
    }
    return
      ":root:root {--reader-font:\(family);--reader-size:\(size)px;--reader-leading:\(leading);\(palette)} main {width:min(\(width)px,calc(100% - 64px));}"
  }
}

struct MacAppearancePanel: View {
  @Bindable private var appearance = MacAppearance.shared
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Text("Make room to read").font(.system(size: 21, weight: .medium, design: .rounded))
      Picker("Page", selection: $appearance.theme) {
        ForEach(["System", "Light", "Paper", "Ink"], id: \.self) { Text($0) }
      }.pickerStyle(.segmented)
      Picker("Typeface", selection: $appearance.font) {
        ForEach(["System", "DM Sans", "Serif"], id: \.self) { Text($0) }
      }.pickerStyle(.segmented)
      HStack {
        Text("Text size")
        Spacer()
        Button {
          appearance.size = max(14, appearance.size - 1)
        } label: {
          Image(systemName: "minus")
        }
        .accessibilityLabel("Smaller text")
        Text("\(appearance.size)").monospacedDigit().frame(width: 28)
        Button {
          appearance.size = min(28, appearance.size + 1)
        } label: {
          Image(systemName: "plus")
        }
        .accessibilityLabel("Larger text")
      }
      Picker("Line spacing", selection: $appearance.leading) {
        Text("Close").tag(1.45)
        Text("Easy").tag(1.6)
        Text("Airy").tag(1.8)
      }.pickerStyle(.segmented)
      Picker("Text column", selection: $appearance.width) {
        Text("Narrow").tag(560)
        Text("Balanced").tag(640)
        Text("Wide").tag(720)
      }.pickerStyle(.segmented)
      Divider()
      Toggle("High refresh · experimental", isOn: $appearance.highRefresh)
        .help(
          "Removes WebKit's preference for 60 fps. Actual cadence depends on the display and power settings."
        )
    }.font(.system(size: 12)).padding(22).frame(width: 310)
  }
}

/// WebKit has no public equivalent. This local-build experiment is isolated and
/// guarded by runtime feature discovery; do not ship this SPI to the App Store.
/// Source: WebKit/WKPreferencesPrivate.h and UnifiedWebPreferences.yaml.
enum MacWebRefresh {
  @MainActor static func configure(_ preferences: WKPreferences) -> Bool {
    let list = NSSelectorFromString("_features")
    let set = NSSelectorFromString("_setEnabled:forFeature:")
    let get = NSSelectorFromString("_isEnabledForFeature:")
    guard WKPreferences.responds(to: list), preferences.responds(to: set),
      preferences.responds(to: get),
      let features = WKPreferences.perform(list)?.takeUnretainedValue() as? [NSObject],
      let feature = features.first(where: {
        ($0.value(forKey: "key") as? String) == "PreferPageRenderingUpdatesNear60FPSEnabled"
      })
    else { return false }
    typealias Setter = @convention(c) (AnyObject, Selector, Bool, AnyObject) -> Void
    let setter = unsafeBitCast(preferences.method(for: set), to: Setter.self)
    setter(preferences, set, !MacAppearance.shared.highRefresh, feature)
    typealias Getter = @convention(c) (AnyObject, Selector, AnyObject) -> Bool
    let getter = unsafeBitCast(preferences.method(for: get), to: Getter.self)
    return getter(preferences, get, feature) == !MacAppearance.shared.highRefresh
  }
}

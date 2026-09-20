import SwiftUI

/// Adaptive native roles for the library; reading palettes map to src/index.css.
/// Keep the palette neutral; hierarchy comes from type, spacing and surface tone.
enum ReaderTheme {
  static let background = Color(uiColor: .systemBackground)
  static let foreground = Color(uiColor: .label)
  static let secondary = Color(uiColor: .secondarySystemBackground)
  static let muted = Color(uiColor: .secondaryLabel)
  static let border = Color(uiColor: .separator)

  static func sans(
    _ size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body
  ) -> Font {
    .system(size: UIFontMetrics(forTextStyle: .body).scaledValue(for: size), weight: weight)
  }

  static let webFonts: String = {
    [("DM Sans", "DMSans"), ("EB Garamond", "EBGaramond")].map { family, name in
      let url = Bundle.main.url(forResource: name, withExtension: "ttf", subdirectory: "Fonts")!
      let data = try! Data(contentsOf: url)
      return
        "@font-face { font-family: '\(family)'; font-style: normal; font-weight: 100 900; src: url(data:font/ttf;base64,\(data.base64EncodedString())) format('truetype'); }"
    }.joined(separator: "\n")
  }()
}

/// Use the system glass material on iOS 26; retain native material on older iOS.
extension View {
  /// Native bars extend the scroll edge blur behind controls, without a solid strip.
  @ViewBuilder func readerBar<Content: View>(
    edge: VerticalEdge, @ViewBuilder content: () -> Content
  ) -> some View {
    if #available(iOS 26.0, *) {
      self.safeAreaBar(edge: edge, spacing: 0, content: content)
        .scrollEdgeEffectStyle(.soft, for: edge == .top ? .top : .bottom)
    } else {
      self.safeAreaInset(edge: edge, spacing: 0) { content().background(.regularMaterial) }
    }
  }

  @ViewBuilder func readerGlass() -> some View {
    if #available(iOS 26.0, *) {
      self.glassEffect(.regular.interactive(), in: .capsule)
    } else {
      self.background(.regularMaterial, in: Capsule())
    }
  }
}

/// Reuse the neutral and Flexoki palettes from the parent Reader.
enum ReadingPalette: String, CaseIterable {
  case system = "System"
  case light = "White"
  case paper = "Paper"
  case dark = "Ink"
  case night = "Night"
  var scheme: ColorScheme? {
    switch self {
    case .system: nil
    case .light, .paper: .light
    case .dark, .night: .dark
    }
  }
  var background: Color {
    switch self {
    case .system: ReaderTheme.background
    case .light: .white
    case .paper: Color(red: 1, green: 0.988, blue: 0.94)
    case .dark: Color(red: 0.062, green: 0.058, blue: 0.058)
    case .night: .black
    }
  }
  var foreground: Color {
    switch self {
    case .system: ReaderTheme.foreground
    case .light, .paper: Color(white: 0.039)
    case .dark: Color(red: 0.811, green: 0.807, blue: 0.769)
    case .night: Color(white: 0.718)
    }
  }
}

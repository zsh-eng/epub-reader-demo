import SwiftUI

#if os(iOS)
  import UIKit
#else
  import AppKit
#endif

/// Glacier blue is reserved for actions and small identity details.
enum ArcticBrand {
  #if os(macOS)
    static let onAccent = Color(nsColor: .windowBackgroundColor)
    static let accent = Color(
      nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
          ? NSColor(red: 0.45, green: 0.82, blue: 0.95, alpha: 1)
          : NSColor(red: 0.13, green: 0.49, blue: 0.71, alpha: 1)
      })
  #else
    static let onAccent = Color(uiColor: .systemBackground)

    static let accent = Color(
      uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
          ? UIColor(red: 0.45, green: 0.82, blue: 0.95, alpha: 1)
          : UIColor(red: 0.13, green: 0.49, blue: 0.71, alpha: 1)
      })
  #endif
}

/// Three preserved pages form an ice shelf; the small ribbon identifies a saved read.
struct ArcticMark: View {
  var body: some View {
    GeometryReader { geometry in
      let size = min(geometry.size.width, geometry.size.height)
      ZStack {
        ForEach(0..<3) { layer in
          ShelfFace()
            .fill(ArcticBrand.accent.opacity(0.45 + Double(layer) * 0.25))
            .frame(width: size, height: size * 0.52)
            .offset(y: size * (0.22 - Double(layer) * 0.21))
        }
        BookmarkRibbon()
          .fill(ArcticBrand.accent)
          .frame(width: size * 0.2, height: size * 0.4)
          .offset(x: size * 0.22, y: size * 0.19)
      }.frame(width: size, height: size)
    }
    .aspectRatio(1, contentMode: .fit)
    .accessibilityHidden(true)
  }
}

private struct ShelfFace: Shape {
  func path(in rect: CGRect) -> Path {
    Path { path in
      path.move(to: CGPoint(x: rect.midX, y: rect.minY))
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.height * 0.43))
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.height * 0.59))
      path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
      path.addLine(to: CGPoint(x: rect.minX, y: rect.height * 0.59))
      path.addLine(to: CGPoint(x: rect.minX, y: rect.height * 0.43))
      path.closeSubpath()
    }
  }
}

private struct BookmarkRibbon: Shape {
  func path(in rect: CGRect) -> Path {
    Path { path in
      path.move(to: .zero)
      path.addLine(to: CGPoint(x: rect.maxX, y: 0))
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
      path.addLine(to: CGPoint(x: rect.midX, y: rect.height * 0.76))
      path.addLine(to: CGPoint(x: 0, y: rect.maxY))
      path.closeSubpath()
    }
  }
}

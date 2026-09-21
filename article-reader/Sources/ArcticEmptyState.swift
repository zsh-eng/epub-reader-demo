import SwiftUI

/// Small native illustrations share the app's paper-and-ice identity. They are
/// static, use semantic colours, and yield their space before enlarged text does.
struct ArcticEmptyState: View {
  enum Kind {
    case saved, favourites, downloaded, history, archive, tag, passages, highlights, notes, search

    fileprivate var symbol: String {
      switch self {
      case .saved: "bookmark"
      case .favourites: "star"
      case .downloaded: "arrow.down"
      case .history: "clock.arrow.circlepath"
      case .archive: "archivebox"
      case .tag: "tag"
      case .passages: "quote.opening"
      case .highlights: "highlighter"
      case .notes: "pencil.tip"
      case .search: "magnifyingglass"
      }
    }
  }

  let kind: Kind
  let title: String
  let detail: String
  var eyebrow: String? = nil

  var body: some View {
    ViewThatFits(in: .vertical) {
      composition(artwork: true)
      composition(artwork: false)
    }
    .frame(maxWidth: .infinity)
  }

  private func composition(artwork: Bool) -> some View {
    VStack(spacing: 0) {
      if artwork {
        ArcticPaperScene(kind: kind).frame(width: 224, height: 168)
          .padding(.bottom, 24).accessibilityHidden(true)
      }
      if let eyebrow {
        Text(eyebrow.uppercased()).font(.caption2.weight(.medium)).tracking(2)
          .foregroundStyle(ReaderTheme.muted).padding(.bottom, 10)
      }
      Text(title).font(.system(.title2, design: .rounded, weight: .semibold))
        .foregroundStyle(ReaderTheme.foreground)
        .multilineTextAlignment(.center).padding(.bottom, 10)
        .fixedSize(horizontal: false, vertical: true)
      Text(detail).font(.subheadline).lineSpacing(3)
        .multilineTextAlignment(.center).foregroundStyle(ReaderTheme.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: 300).padding(24)
  }
}

private struct ArcticPaperScene: View {
  let kind: ArcticEmptyState.Kind
  private var isPassage: Bool { kind == .passages || kind == .highlights || kind == .notes }

  var body: some View {
    ZStack {
      // A small ice shelf grounds the paper without a blurred drop shadow.
      Ellipse().fill(ArcticBrand.accent.opacity(0.06))
        .frame(width: 212, height: 25).offset(y: 71)
      if kind == .archive {
        paper.frame(width: 146, height: 135).rotationEffect(.degrees(-6)).offset(x: -16, y: 10)
        paper.frame(width: 144, height: 141).rotationEffect(.degrees(5)).offset(x: 12, y: 6)
      } else {
        paper.frame(width: 126, height: 143).rotationEffect(.degrees(-13)).offset(x: -27, y: 7)
        if kind == .saved || kind == .tag {
          paper.frame(width: 126, height: 143).rotationEffect(.degrees(10)).offset(x: 25, y: -1)
        }
      }
      page.rotationEffect(.degrees(kind == .archive ? 0 : -3))
      if kind == .history {
        ForEach(0..<3) { index in
          Circle().fill(ArcticBrand.accent.opacity(0.14 + Double(index) * 0.1))
            .frame(width: 5, height: 5)
            .offset(x: -91 + CGFloat(index) * 8, y: 41 - CGFloat(index) * 16)
        }
      }
      if kind == .search {
        Image(systemName: "magnifyingglass").font(.system(size: 51, weight: .ultraLight))
          .foregroundStyle(ArcticBrand.accent).rotationEffect(.degrees(-8))
          .offset(x: 61, y: 34)
      } else {
        Image(systemName: kind.symbol).font(.system(size: 19, weight: .light))
          .foregroundStyle(ArcticBrand.accent)
          .frame(width: 44, height: 44)
          .background(ReaderTheme.background, in: RoundedRectangle(cornerRadius: 14))
          .overlay {
            RoundedRectangle(cornerRadius: 14)
              .strokeBorder(ArcticBrand.accent.opacity(0.22), lineWidth: 1)
          }
          .rotationEffect(.degrees(8)).offset(x: 70, y: 40)
      }
    }
  }

  private var paper: some View {
    RoundedRectangle(cornerRadius: 10).fill(ReaderTheme.secondary)
      .overlay {
        RoundedRectangle(cornerRadius: 10).strokeBorder(
          ReaderTheme.border.opacity(0.35), lineWidth: 0.5)
      }
  }

  private var page: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Capsule().fill(ReaderTheme.muted.opacity(0.25)).frame(width: 26, height: 3)
        Spacer()
        ArcticMark().frame(width: 15, height: 15)
      }
      if isPassage {
        Image(systemName: "quote.opening").font(.system(size: 23, weight: .light))
          .foregroundStyle(ArcticBrand.accent.opacity(0.7))
        VStack(alignment: .leading, spacing: 8) {
          line(width: 87, emphasis: kind == .highlights || kind == .passages)
          line(width: 69, emphasis: kind == .highlights)
          line(width: 82, emphasis: false)
        }
        if kind == .notes {
          Rectangle().fill(ArcticBrand.accent.opacity(0.2)).frame(height: 0.5)
          line(width: 57, emphasis: false)
        }
      } else {
        ZStack {
          RoundedRectangle(cornerRadius: 5).fill(ArcticBrand.accent.opacity(0.07))
          ArcticMark().frame(width: 44, height: 44)
        }.frame(height: 54)
        line(width: 83, emphasis: false)
        line(width: 65, emphasis: false)
        if kind != .search { line(width: 74, emphasis: false) }
      }
      Spacer(minLength: 0)
    }
    .padding(15).frame(width: 134, height: 158)
    .background(ReaderTheme.background, in: RoundedRectangle(cornerRadius: 10))
    .overlay {
      RoundedRectangle(cornerRadius: 10).strokeBorder(
        ReaderTheme.border.opacity(0.45), lineWidth: 0.5)
    }
  }

  private func line(width: CGFloat, emphasis: Bool) -> some View {
    Capsule().fill(ReaderTheme.muted.opacity(0.27)).frame(width: width, height: 3)
      .padding(.vertical, 2)
      .background(alignment: .leading) {
        if emphasis {
          RoundedRectangle(cornerRadius: 2).fill(ArcticBrand.accent.opacity(0.15))
            .padding(.horizontal, -3)
        }
      }
  }
}

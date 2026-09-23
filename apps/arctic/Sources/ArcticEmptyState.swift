import SwiftUI

/// Sparse ink washes let the surrounding app surface become the canvas.
/// Multiply/screen remove paper tones on light/dark surfaces; alpha preserves
/// broken brush edges. These local, static assets never animate during scrolling.
struct ArcticEmptyState: View {
  enum Kind {
    case saved, favourites, downloaded, history, archive, tag, passages, highlights, notes, search

    fileprivate var artwork: String {
      switch self {
      case .saved: "EmptySaved"
      case .favourites: "EmptyFavourites"
      case .downloaded: "EmptyDownloaded"
      case .history: "EmptyHistory"
      case .archive: "EmptyArchive"
      case .tag, .search: "EmptySearch"
      case .passages, .notes: "EmptyNotes"
      case .highlights: "EmptyHighlights"
      }
    }

    fileprivate var artworkHeight: CGFloat {
      switch self {
      case .passages, .notes, .highlights: 128
      default: 224
      }
    }
  }

  @Environment(\.colorScheme) private var colourScheme
  let kind: Kind
  let title: String
  let detail: String
  var eyebrow: String? = nil
  var compact = false
  private var isCompact: Bool { compact || kind.artworkHeight < 224 }

  var body: some View {
    ViewThatFits(in: .vertical) {
      composition(artwork: true)
      composition(artwork: false)
    }
    .frame(maxWidth: .infinity)
  }

  @ViewBuilder private var inkArtwork: some View {
    let width: CGFloat = isCompact ? 240 : 300
    let painting = Image(kind.artwork).resizable().scaledToFit()
      .frame(width: width, height: width).saturation(0.15)
    if colourScheme == .dark {
      painting.colorInvert().blendMode(.screen).opacity(0.48)
    } else {
      painting.blendMode(.multiply).opacity(0.7)
    }
  }

  private func composition(artwork: Bool) -> some View {
    VStack(spacing: 0) {
      if artwork {
        inkArtwork
          .frame(width: isCompact ? 240 : 300, height: isCompact ? 128 : 172).clipped()
          .mask {
            LinearGradient(stops: [.init(color: .clear, location: 0),
              .init(color: .black, location: 0.08), .init(color: .black, location: 0.92),
              .init(color: .clear, location: 1)], startPoint: .leading, endPoint: .trailing)
          }
          .padding(.bottom, isCompact ? 8 : 16).accessibilityHidden(true)
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
    .frame(maxWidth: 300).padding(isCompact ? 8 : 24)
  }
}

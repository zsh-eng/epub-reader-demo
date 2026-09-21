import SwiftUI

/// Each empty state has its own Arctic scene. Transparent, bounded local assets
/// work on both themes and yield their space before enlarged text does.
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

  private func composition(artwork: Bool) -> some View {
    VStack(spacing: 0) {
      if artwork {
        Image(kind.artwork).resizable().scaledToFit()
          .frame(width: 240, height: isCompact ? 128 : 224)
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

import SwiftUI
import UIKit

/// The image stays intact. Small material panels keep text readable on any cover.
struct ArticleCard: View {
  let article: SavedArticle

  var body: some View {
    Group {
      // Imports start with a title. Reserve the eventual cover's space while
      // metadata is pending so arriving images do not push cards under a finger.
      if article.imageURL != nil || (article.taggingText == nil && !article.previewFailed) {
        ArticleThumbnail(url: article.imageURL)
          .aspectRatio(1.65, contentMode: .fit)
          .overlay(alignment: .topLeading) {
            source.padding(.horizontal, 10).padding(.vertical, 7)
              .background(.regularMaterial, in: Capsule()).padding(10)
          }
          .overlay(alignment: .bottomLeading) {
            GeometryReader { geometry in
              caption(width: geometry.size.width - 40).padding(10)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                .padding(10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            }
          }
          .clipShape(RoundedRectangle(cornerRadius: 18)).padding(6)
      } else {
        VStack(alignment: .leading, spacing: 20) {
          source
          ViewThatFits(in: .horizontal) {
            VStack(alignment: .leading, spacing: 6) {
              Text(article.title).font(.title3.weight(.semibold))
                .fixedSize(horizontal: true, vertical: false)
              if !article.subtitle.isEmpty {
                Text(article.subtitle).font(.subheadline).foregroundStyle(ReaderTheme.muted)
                  .lineLimit(2).accessibilityIdentifier("card-caption-subtitle")
              }
            }
            LibraryTitle(text: article.title, style: .title3)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }.padding(20)
      }
    }
    .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 24))
    .contentShape(RoundedRectangle(cornerRadius: 24))
  }

  private var source: some View {
    HStack(spacing: 6) {
      if let favicon = article.faviconURL {
        ArticleThumbnail(url: favicon, label: "Site icon", pixels: 96)
          .frame(width: 16, height: 16).clipShape(Circle())
      }
      Text(article.url.host?.replacingOccurrences(of: "www.", with: "") ?? "")
        .font(.caption.weight(.medium)).lineLimit(1)
    }.foregroundStyle(ReaderTheme.foreground)
  }

  private func caption(width: CGFloat) -> some View {
    ViewThatFits(in: .horizontal) {
      // Only keep the subtitle when the entire title fits on one line.
      VStack(alignment: .leading, spacing: 4) {
        Text(article.title).font(.headline).fixedSize(horizontal: true, vertical: false)
        if !article.subtitle.isEmpty {
          Text(article.subtitle).font(.subheadline).foregroundStyle(ReaderTheme.muted)
            .lineLimit(1).accessibilityIdentifier("card-caption-subtitle")
            .frame(width: width, alignment: .leading)
        }
      }
      LibraryTitle(text: article.title)
    }.frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// Native push-out wrapping avoids a short orphan at the end of a heading.
/// Keep the complete title accessible while limiting its visible layout to two lines.
struct LibraryTitle: UIViewRepresentable {
  let text: String
  var style: UIFont.TextStyle = .headline
  var pointSize: CGFloat? = nil
  var weight: UIFont.Weight = .semibold
  var query = ""
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.colorScheme) private var colourScheme

  struct Configuration: Equatable {
    var text: String
    var query: String
    var style: UIFont.TextStyle
    var pointSize: CGFloat?
    var weight: UIFont.Weight
    var category: UIContentSizeCategory
    var colourScheme: ColorScheme
  }
  final class Coordinator {
    var configuration: Configuration?
    var sizes: [CGFloat: CGSize] = [:]
  }
  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> UILabel {
    let label = UILabel()
    label.numberOfLines = 2
    label.lineBreakMode = .byTruncatingTail
    label.lineBreakStrategy = .pushOut
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    label.accessibilityIdentifier = "article-title-two-lines"
    return label
  }

  func updateUIView(_ label: UILabel, context: Context) {
    let configuration = Configuration(
      text: text, query: query, style: style, pointSize: pointSize, weight: weight,
      category: LibraryTextFormatting.category(dynamicTypeSize), colourScheme: colourScheme)
    guard context.coordinator.configuration != configuration else { return }
    context.coordinator.configuration = configuration
    context.coordinator.sizes.removeAll(keepingCapacity: true)
    label.font = LibraryTextFormatting.font(
      style: style, pointSize: pointSize, weight: weight, category: configuration.category)
    label.textColor = .label
    LibraryTextFormatting.apply(text, query: query, to: label)
    label.accessibilityLabel = text
  }

  func sizeThatFits(_ proposal: ProposedViewSize, uiView: UILabel, context: Context) -> CGSize? {
    let width =
      proposal.width.flatMap { $0.isFinite ? max(0, $0) : nil }
      ?? max(0, uiView.intrinsicContentSize.width)
    if let size = context.coordinator.sizes[width] { return size }
    let fitting = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    let size = CGSize(width: width, height: fitting.height)
    if context.coordinator.sizes.count >= 4 {
      context.coordinator.sizes.removeAll(keepingCapacity: true)
    }
    context.coordinator.sizes[width] = size
    return size
  }
}

/// Shared native text formatting. Content, query and Dynamic Type are stable
/// between scroll frames, so callers apply this only when their key changes.
enum LibraryTextFormatting {
  static func apply(_ text: String, query: String, to label: UILabel) {
    let words = query.split(whereSeparator: \.isWhitespace)
    guard !words.isEmpty else {
      label.attributedText = nil
      label.text = text
      return
    }
    let attributed = NSMutableAttributedString(string: text)
    for word in words {
      var search = text.startIndex..<text.endIndex
      while let range = text.range(
        of: String(word), options: [.caseInsensitive, .diacriticInsensitive], range: search)
      {
        attributed.addAttributes(
          [.backgroundColor: UIColor.secondarySystemBackground, .foregroundColor: UIColor.label],
          range: NSRange(range, in: text))
        search = range.upperBound..<text.endIndex
      }
    }
    label.attributedText = attributed
  }

  static func font(
    style: UIFont.TextStyle, pointSize: CGFloat?, weight: UIFont.Weight,
    category: UIContentSizeCategory
  ) -> UIFont {
    let traits = UITraitCollection(preferredContentSizeCategory: category)
    guard let pointSize else {
      let size = UIFont.preferredFont(forTextStyle: style, compatibleWith: traits).pointSize
      return .systemFont(ofSize: size, weight: weight)
    }
    return UIFontMetrics(forTextStyle: style).scaledFont(
      for: .systemFont(ofSize: pointSize, weight: weight), compatibleWith: traits)
  }

  static func category(_ size: DynamicTypeSize) -> UIContentSizeCategory {
    switch size {
    case .xSmall: .extraSmall
    case .small: .small
    case .medium: .medium
    case .large: .large
    case .xLarge: .extraLarge
    case .xxLarge: .extraExtraLarge
    case .xxxLarge: .extraExtraExtraLarge
    case .accessibility1: .accessibilityMedium
    case .accessibility2: .accessibilityLarge
    case .accessibility3: .accessibilityExtraLarge
    case .accessibility4: .accessibilityExtraExtraLarge
    case .accessibility5: .accessibilityExtraExtraExtraLarge
    @unknown default: .large
    }
  }
}

/// Retained alternative; the library currently uses ArticleCard.
/// A wide image fades into the card surface. The title remains on an opaque
/// surface, so its contrast does not depend on the publisher's photograph.
struct GradientArticleCard: View {
  let article: SavedArticle
  private let shape = RoundedRectangle(cornerRadius: 24)

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let image = article.imageURL {
        ArticleThumbnail(url: image)
          .aspectRatio(1.8, contentMode: .fit)
          .overlay(alignment: .bottom) {
            LinearGradient(
              stops: (0...16).map { step in
                let progress = Double(step) / 16
                let opacity = (1 - cos(progress * .pi)) / 2
                return .init(color: ReaderTheme.secondary.opacity(opacity), location: progress)
              }, startPoint: .top, endPoint: .bottom
            ).frame(height: 90)
          }
          .clipShape(RoundedRectangle(cornerRadius: 18))
          .padding(6).padding(.bottom, -20)
      }
      VStack(alignment: .leading, spacing: 10) {
        Text(article.title).font(.title3.weight(.semibold)).lineLimit(3)
          .frame(maxWidth: .infinity, alignment: .leading)
        if !article.subtitle.isEmpty {
          Text(article.subtitle).font(.subheadline).foregroundStyle(ReaderTheme.muted).lineLimit(2)
        }
        HStack(spacing: 7) {
          if let favicon = article.faviconURL {
            ArticleThumbnail(url: favicon, label: "Site icon", pixels: 96)
              .frame(width: 18, height: 18).clipShape(Circle())
          }
          Text(article.url.host?.replacingOccurrences(of: "www.", with: "") ?? "")
            .font(.caption).lineLimit(1)
          if !article.tagNames.isEmpty {
            Text("· " + article.tagNames.joined(separator: " · "))
              .font(.caption).lineLimit(1)
          }
        }.foregroundStyle(ReaderTheme.muted)
      }.padding(20)
    }
    .background(ReaderTheme.secondary, in: shape)
    .clipShape(shape).contentShape(shape)
  }
}

/// The existing paper still-life gains a small Arctic detail for each folder.
struct LibraryEmptyState: View {
  let folder: ArticleFolder

  private var kind: ArcticEmptyState.Kind {
    switch folder {
    case .saved: .saved
    case .downloaded: .downloaded
    case .history: .history
    case .archive: .archive
    case .tag: .tag
    }
  }

  private var detail: String {
    switch folder {
    case .saved: "Share to Arctic, or open a copied link."
    case .downloaded: "Articles ready to read offline appear here."
    case .history: "Find your opened articles here."
    case .archive: "Finished for now. Kept for later."
    case .tag: "Add this tag to a saved article to find it here."
    }
  }

  var body: some View {
    ArcticEmptyState(kind: kind, title: folder.emptyTitle, detail: detail, eyebrow: folder.title)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

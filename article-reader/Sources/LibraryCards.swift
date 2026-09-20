import SwiftUI

/// A wide image fades into the card surface. The title remains on an opaque
/// surface, so its contrast does not depend on the publisher's photograph.
struct ArticleCard: View {
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
            ArticleThumbnail(url: favicon, label: "Site icon")
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

/// Quiet editorial artwork, drawn in native shapes so it stays crisp at any
/// scale and uses the same adaptive colours as the rest of the library.
struct LibraryEmptyState: View {
  let folder: ArticleFolder

  var body: some View {
    ViewThatFits(in: .vertical) {
      composition(showArtwork: true)
      composition(showArtwork: false)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private func composition(showArtwork: Bool) -> some View {
    VStack(spacing: 0) {
      if showArtwork {
        ReadingStillLife().frame(width: 240, height: 174).padding(.bottom, 28)
          .accessibilityHidden(true)
      }
      Text(folder.title.uppercased()).font(.caption2.weight(.medium)).tracking(2.5)
        .foregroundStyle(ReaderTheme.muted).padding(.bottom, 12)
      Text(folder.emptyTitle).font(.title2.weight(.semibold))
        .multilineTextAlignment(.center).padding(.bottom, 12)
      Text(folder.emptyDescription).font(.subheadline).lineSpacing(4)
        .multilineTextAlignment(.center).foregroundStyle(ReaderTheme.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: 285).padding(24)
  }
}

private struct ReadingStillLife: View {
  var body: some View {
    ZStack {
      Ellipse().fill(ReaderTheme.muted.opacity(0.08)).frame(width: 210, height: 18)
        .blur(radius: 8).offset(y: 77)
      paper.rotationEffect(.degrees(-13)).offset(x: -32, y: 5)
      paper.rotationEffect(.degrees(10)).offset(x: 30, y: -2)
      VStack(alignment: .leading, spacing: 9) {
        HStack {
          Capsule().fill(ReaderTheme.muted.opacity(0.35)).frame(width: 28, height: 3)
          Spacer()
          BookmarkRibbon().fill(ReaderTheme.foreground.opacity(0.65)).frame(width: 12, height: 24)
        }.padding(.top, -15)
        // A horizon on the cover, followed by the rhythm of a few typeset lines.
        ZStack(alignment: .bottom) {
          RoundedRectangle(cornerRadius: 5).fill(ReaderTheme.muted.opacity(0.08))
          Circle().fill(ReaderTheme.muted.opacity(0.18)).frame(width: 20, height: 20)
            .offset(x: 24, y: -22)
          Horizon().fill(ReaderTheme.muted.opacity(0.18))
        }.frame(height: 54).clipShape(RoundedRectangle(cornerRadius: 5))
        Capsule().fill(ReaderTheme.foreground.opacity(0.5)).frame(width: 77, height: 4)
        Capsule().fill(ReaderTheme.muted.opacity(0.2)).frame(height: 3)
        Capsule().fill(ReaderTheme.muted.opacity(0.2)).frame(width: 61, height: 3)
      }
      .padding(16).frame(width: 136, height: 164)
      .background(ReaderTheme.background, in: RoundedRectangle(cornerRadius: 10))
      .overlay(
        RoundedRectangle(cornerRadius: 10).stroke(ReaderTheme.border.opacity(0.45), lineWidth: 0.5)
      )
      .rotationEffect(.degrees(-3))
    }
  }

  private var paper: some View {
    RoundedRectangle(cornerRadius: 10).fill(ReaderTheme.secondary)
      .overlay(
        RoundedRectangle(cornerRadius: 10).stroke(ReaderTheme.border.opacity(0.35), lineWidth: 0.5)
      )
      .frame(width: 130, height: 156)
  }
}

private struct BookmarkRibbon: Shape {
  func path(in rect: CGRect) -> Path {
    Path { path in
      path.move(to: .zero)
      path.addLine(to: CGPoint(x: rect.maxX, y: 0))
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
      path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY - 5))
      path.addLine(to: CGPoint(x: 0, y: rect.maxY))
      path.closeSubpath()
    }
  }
}

private struct Horizon: Shape {
  func path(in rect: CGRect) -> Path {
    Path { path in
      path.move(to: CGPoint(x: 0, y: rect.height * 0.7))
      path.addCurve(
        to: CGPoint(x: rect.maxX, y: rect.height * 0.5),
        control1: CGPoint(x: rect.width * 0.35, y: 0),
        control2: CGPoint(x: rect.width * 0.6, y: rect.maxY))
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
      path.addLine(to: CGPoint(x: 0, y: rect.maxY))
      path.closeSubpath()
    }
  }
}

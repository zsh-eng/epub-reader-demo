import SwiftUI
import UIKit

enum StoryFormat: String, CaseIterable, Identifiable {
  case story = "Story"
  case square = "Square"
  var id: Self { self }
  var height: CGFloat { self == .story ? 640 : 360 }
}
enum StoryFlow: String, CaseIterable, Identifiable {
  case single = "One image"
  case pages = "Pages"
  var id: Self { self }
}

/// One layout contract drives text measurement, preview and export. Format and
/// image changes reflow the full quote instead of cropping a portrait bitmap.
struct StoryCardLayout {
  var format: StoryFormat = .story
  var hasImage = false
  var single = false
  var minimumFontSize: CGFloat {
    if single { return format == .story ? 18 : 16 }
    return format == .story && !hasImage ? 28 : (hasImage && format == .square ? 20 : 22)
  }
  var headerY: CGFloat { format == .story ? 58 : 25 }
  func quoteRect(for style: StoryStyle) -> CGRect {
    if format == .square {
      return CGRect(x: 24, y: hasImage ? 164 : 68, width: 312, height: hasImage ? 110 : 206)
    }
    if hasImage { return CGRect(x: 32, y: 278, width: 296, height: 226) }
    let height = single ? (style == .folio ? 284 : 460 - style.quoteY) : 232
    return CGRect(x: 32, y: style.quoteY, width: 296, height: height)
  }
  var imageRect: CGRect {
    format == .story
      ? CGRect(x: 32, y: 96, width: 296, height: 158)
      : CGRect(x: 24, y: 58, width: 312, height: 92)
  }
  func sourceY(for style: StoryStyle) -> CGFloat {
    if format == .square { return 292 }
    if hasImage { return 530 }
    return style == .folio ? 106 : 484
  }
  func textHeight(_ text: String, font: UIFont, width: CGFloat) -> CGFloat {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 4
    return (text as NSString).boundingRect(
      with: CGSize(width: width, height: CGFloat.greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin, .usesFontLeading],
      attributes: [.font: font, .paragraphStyle: paragraph], context: nil
    ).height
  }
  func fits(_ text: String, style: StoryStyle) -> Bool {
    let rect = quoteRect(for: style)
    return textHeight(text, font: style.typeface(size: minimumFontSize), width: rect.width) <= rect
      .height - 4
  }
}

/// Ten print traditions interpreted as reusable layouts, not baked-in quote images.
/// Artwork colours are independent of the app chrome. All paper assets are local.
enum StoryStyle: String, CaseIterable, Identifiable {
  case paper = "Biblioteca"
  case ink = "Theatre"
  case ice = "Xuan"
  case folio = "Modern"
  case field = "Jade"
  case signal = "Swiss"
  case index = "Sumi"
  case dusk = "Hanji"
  case cutout = "Offset"
  case ribbon = "Seoul"
  var id: String { rawValue }
  var supportsArticleImage: Bool { [.paper, .folio, .signal, .cutout].contains(self) }

  var background: Color {
    switch self {
    case .paper: return Color(red: 0.95, green: 0.91, blue: 0.80)
    case .ink: return Color(red: 0.91, green: 0.84, blue: 0.63)
    case .ice: return Color(red: 0.96, green: 0.94, blue: 0.88)
    case .folio: return Color(red: 0.96, green: 0.32, blue: 0.23)
    case .field: return Color(red: 0.82, green: 0.88, blue: 0.80)
    case .signal: return Color(red: 0.95, green: 0.93, blue: 0.86)
    case .index: return Color(red: 0.06, green: 0.10, blue: 0.20)
    case .dusk: return Color(red: 0.93, green: 0.88, blue: 0.82)
    case .cutout: return Color(red: 0.92, green: 0.96, blue: 0.28)
    case .ribbon: return Color(red: 0.14, green: 0.19, blue: 0.68)
    }
  }
  var foreground: Color {
    switch self {
    case .paper: return Color(red: 0.13, green: 0.20, blue: 0.46)
    case .field: return Color(red: 0.34, green: 0.15, blue: 0.25)
    case .index: return Color(red: 0.98, green: 0.95, blue: 0.85)
    case .dusk: return Color(red: 0.33, green: 0.20, blue: 0.27)
    case .ribbon: return Color(red: 0.95, green: 0.98, blue: 0.37)
    default: return Color(red: 0.02, green: 0.025, blue: 0.02)
    }
  }
  var accent: Color {
    switch self {
    case .paper, .ice, .signal: return Color(red: 0.77, green: 0.20, blue: 0.13)
    case .ink: return Color(red: 0.47, green: 0.10, blue: 0.17)
    case .folio: return Color(red: 0.98, green: 0.91, blue: 0.77)
    case .field: return Color(red: 0.44, green: 0.59, blue: 0.44)
    case .index: return Color(red: 0.73, green: 0.77, blue: 0.84)
    case .dusk: return Color(red: 0.74, green: 0.61, blue: 0.59)
    case .cutout: return Color(red: 0.15, green: 0.23, blue: 0.67)
    case .ribbon: return Color(red: 0.99, green: 0.43, blue: 0.26)
    }
  }
  var font: UIFont { typeface(size: 28) }
  func typeface(size: CGFloat) -> UIFont {
    switch self {
    case .signal, .cutout:
      return UIFont(name: "HelveticaNeue-CondensedBlack", size: size)
        ?? .systemFont(ofSize: size, weight: .black)
    case .ribbon: return .systemFont(ofSize: size, weight: .heavy)
    case .ink:
      return UIFont(name: "Baskerville-Bold", size: size)
        ?? .systemFont(ofSize: size, weight: .bold)
    case .paper: return UIFont(name: "Didot", size: size) ?? .systemFont(ofSize: size)
    case .field:
      return UIFont(name: "Baskerville-Italic", size: size) ?? .italicSystemFont(ofSize: size)
    default: return UIFont(name: "Baskerville", size: size) ?? .systemFont(ofSize: size)
    }
  }
  var centered: Bool { [.paper, .field, .dusk].contains(self) }
  var quoteY: CGFloat {
    switch self {
    case .paper: return 177
    case .ink: return 139
    case .ice: return 157
    case .folio: return 217
    case .field: return 171
    case .signal: return 148
    case .index: return 166
    case .dusk: return 157
    case .cutout: return 132
    case .ribbon: return 171
    }
  }

  /// Short selections become display typography. Long pages use the same measured
  /// region and minimum font as pagination, so no style drops or clips words.
  func displayFont(for text: String, layout: StoryCardLayout) -> UIFont {
    let rect = layout.quoteRect(for: self)
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 4
    for size in stride(from: 44.0, through: layout.minimumFontSize, by: -1) {
      let font = typeface(size: size)
      let measured = (text as NSString).boundingRect(
        with: CGSize(width: rect.width, height: CGFloat.greatestFiniteMagnitude),
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        attributes: [.font: font, .paragraphStyle: paragraph], context: nil)
      if measured.height <= rect.height - 4 { return font }
    }
    return typeface(size: layout.minimumFontSize)
  }
}

/// A fixed export canvas keeps decorative bleeds out of text measurement. Print
/// textures are shared assets; ornaments are vector paths and remain sharp at 3x.
struct PassageStoryCard: View {
  let story: PassageStory
  let style: StoryStyle
  let text: String
  let page: Int
  let count: Int
  var layout = StoryCardLayout()
  var articleImage: UIImage?

  var body: some View {
    style.background.frame(width: 360, height: layout.format.height)
      .overlay { artwork.frame(width: 360, height: layout.format.height) }
      .overlay(alignment: .topLeading) { typography }
      .clipped()
      .environment(\.dynamicTypeSize, .medium)
      .environment(\.colorScheme, [.index, .ribbon].contains(style) ? .dark : .light)
  }

  private var typography: some View {
    let rect = layout.quoteRect(for: style)
    return ZStack(alignment: .topLeading) {
      header.frame(width: rect.width).offset(x: rect.minX, y: layout.headerY)
      if layout.hasImage {
        Group {
          if let articleImage {
            Image(uiImage: articleImage).resizable().scaledToFill()
          } else {
            Rectangle().fill(style.foreground.opacity(0.06))
          }
        }.frame(width: layout.imageRect.width, height: layout.imageRect.height)
          .clipped().overlay(Rectangle().stroke(style.foreground.opacity(0.25), lineWidth: 0.5))
          .offset(x: layout.imageRect.minX, y: layout.imageRect.minY)
      }
      quote.frame(
        width: rect.width, height: rect.height, alignment: style.centered ? .top : .topLeading
      )
      .clipped().offset(x: rect.minX, y: rect.minY)
      source.frame(
        width: layout.format == .square ? 312 : (style == .index ? 180 : 284),
        alignment: style.centered ? .center : .leading
      )
      .background(layout.format == .square ? style.background.opacity(0.95) : .clear)
      .offset(x: layout.format == .square ? 24 : 38, y: layout.sourceY(for: style))
    }.frame(width: 360, height: layout.format.height, alignment: .topLeading)
  }
  /// A short opening sentence can act as the poster headline. The combined
  /// block must fit before using this hierarchy; otherwise render one full quote.
  private var lead: (String, String, UIFont)? {
    let passage = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard passage.count <= 180, layout.format == .story, !layout.hasImage,
      let stop = passage.firstIndex(where: { ".!?。！？".contains($0) }),
      passage.distance(from: passage.startIndex, to: stop) <= 40
    else { return nil }
    let end = passage.index(after: stop)
    let first = String(passage[..<end])
    let rest = String(passage[end...]).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !rest.isEmpty else { return nil }
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 4
    func height(_ string: String, _ font: UIFont) -> CGFloat {
      (string as NSString).boundingRect(
        with: CGSize(width: 296, height: CGFloat.greatestFiniteMagnitude),
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        attributes: [.font: font, .paragraphStyle: paragraph], context: nil
      ).height
    }
    let bodyHeight = height(rest, style.typeface(size: 27))
    for size in stride(from: 62.0, through: 44.0, by: -2) {
      let font = style.typeface(size: size)
      if height(first, font) + bodyHeight + 16 <= layout.quoteRect(for: style).height - 4 {
        return (first, rest, font)
      }
    }
    return nil
  }
  @ViewBuilder private var quote: some View {
    Group {
      if let (first, rest, font) = lead {
        VStack(alignment: style.centered ? .center : .leading, spacing: 16) {
          Text(first).font(Font(font))
          Text(rest).font(Font(style.typeface(size: 27)))
        }
      } else {
        Text(text.trimmingCharacters(in: .whitespacesAndNewlines))
          .font(Font(style.displayFont(for: text, layout: layout)))
      }
    }.lineSpacing(4).multilineTextAlignment(style.centered ? .center : .leading)
      .foregroundStyle(style.foreground).fixedSize(horizontal: false, vertical: true)
  }
  private var header: some View {
    HStack(spacing: 16) {
      style.foreground.mask(ArcticMark()).frame(width: 15, height: 15)
      if count > 1 {
        Text(String(format: "%02d / %02d", page + 1, count))
          .font(.system(size: 9, weight: .medium, design: .monospaced)).tracking(2)
          .foregroundStyle(style.foreground)
      }
      Spacer()
    }
  }
  private var source: some View {
    VStack(
      alignment: style.centered ? .center : .leading, spacing: layout.format == .square ? 4 : 8
    ) {
      Rectangle().fill(style.foreground).frame(width: 24, height: 1)
      Text(story.title).font(
        .system(size: layout.format == .square ? 10 : 13, weight: .medium, design: .serif)
      )
      .lineLimit(layout.format == .square ? 2 : 3).multilineTextAlignment(
        style.centered ? .center : .leading)
      Text(story.url.host?.replacingOccurrences(of: "www.", with: "") ?? "")
        .font(.system(size: 8, weight: .medium, design: .monospaced)).tracking(0.6)
        .lineLimit(1)
    }.foregroundStyle(style.foreground)
  }

  @ViewBuilder private var artwork: some View {
    ZStack {
      if style == .ice {
        Image("StoryXuan").resizable().frame(width: 360, height: layout.format.height).clipped()
      } else if style == .index {
        Image("StoryIndigo").resizable().frame(width: 360, height: layout.format.height).clipped()
      } else if style == .ink {
        Image("StoryTheatre").resizable().frame(width: 360, height: layout.format.height).clipped()
      } else if style == .field {
        Image("StoryJade").resizable().frame(width: 360, height: layout.format.height).clipped()
      } else if style == .dusk {
        Image("StoryHanji").resizable().frame(width: 360, height: layout.format.height).clipped()
      }
      if layout.format == .square || layout.hasImage {
        Rectangle().fill(style.accent).frame(width: 24, height: 3)
          .offset(x: 145, y: -layout.format.height / 2 + 30)
        if style == .paper {
          Rectangle().stroke(style.foreground.opacity(0.35), lineWidth: 0.5).padding(12)
        }
      } else {
        motifs
      }
      // Substrate sits over the printed shapes as well as the paper field.
      // Multiply leaves type colours intact; no full-size blurred layers or timer.
      Image("StoryPaper").resizable().frame(width: 360, height: layout.format.height).clipped()
        .blendMode(.multiply).opacity(style == .index ? 0.09 : 0.55)
    }.frame(width: 360, height: layout.format.height).clipped()
  }

  @ViewBuilder private var motifs: some View {
    switch style {
    case .paper:
      Rectangle().stroke(style.foreground, lineWidth: 0.65).padding(.horizontal, 19).padding(
        .vertical, 37)
      Text("“").font(.custom("Didot", size: 86)).foregroundStyle(style.accent).offset(y: -199)
      arch.fill(style.accent).frame(width: 168, height: 82).offset(y: 292)
    case .ink:
      Text("“").font(.custom("Baskerville-Bold", size: 110)).foregroundStyle(style.accent)
        .offset(x: -128, y: -208)
    case .ice:
      Rectangle().fill(style.accent).frame(width: 13, height: 18).offset(x: 145, y: 136)
      Rectangle().stroke(style.background, lineWidth: 0.7).frame(width: 7, height: 12).offset(
        x: 145, y: 136)
    case .folio:
      Circle().stroke(style.accent, lineWidth: 23).frame(width: 190, height: 190).offset(
        x: 165, y: -218)
      Rectangle().fill(style.foreground).frame(width: 296, height: 2).offset(y: -122)
      Text("”").font(.custom("Didot", size: 166)).foregroundStyle(style.accent).offset(
        x: 102, y: 238)
      Rectangle().fill(style.foreground).frame(width: 12).offset(x: -174)
    case .field:
      Text("“").font(.custom("Baskerville-Italic", size: 72)).foregroundStyle(style.foreground)
        .offset(y: -211)
    case .signal:
      Rectangle().fill(style.accent).frame(width: 360, height: 30).offset(y: -305)
      Text("“").font(.system(size: 160, weight: .black)).foregroundStyle(style.accent).offset(
        x: 106, y: -218)
      Circle().fill(style.accent).frame(width: 160, height: 160).offset(x: 161, y: 268)
      Circle().fill(Color(red: 0.12, green: 0.25, blue: 0.64)).frame(width: 104, height: 104)
        .blendMode(.multiply).offset(x: 107, y: 294)
      Rectangle().fill(style.foreground).frame(width: 1, height: 52).offset(x: -148, y: 267)
    case .index:
      Rectangle().fill(style.foreground.opacity(0.45)).frame(width: 1, height: 104).offset(
        x: 150, y: -172)
      Text("“").font(.custom("Baskerville", size: 64)).foregroundStyle(style.foreground).offset(
        x: -131, y: -204)
    case .dusk:
      Circle().fill(style.foreground).frame(width: 5, height: 5).offset(y: -196)
      Rectangle().fill(style.foreground.opacity(0.3)).frame(width: 68, height: 0.5).offset(y: 275)
    case .cutout:
      Rectangle().fill(style.accent).frame(width: 104, height: 490).rotationEffect(.degrees(19))
        .offset(x: 197, y: 159)
      tornStrip.fill(style.accent).frame(width: 330, height: 39).rotationEffect(.degrees(-6))
        .offset(x: -99, y: 297)
      Text("“").font(.system(size: 120, weight: .black)).foregroundStyle(style.accent)
        .rotationEffect(.degrees(9)).offset(x: 104, y: -228)
      Rectangle().stroke(style.foreground, lineWidth: 1).frame(width: 296, height: 1).offset(y: 134)
    case .ribbon:
      Rectangle().fill(style.foreground).frame(width: 226, height: 13).offset(x: -67, y: -213)
      Rectangle().fill(style.accent).frame(width: 62, height: 62).offset(x: 149, y: -225)
      Rectangle().fill(style.foreground).frame(width: 10, height: 147).offset(x: -174, y: -132)
      Rectangle().stroke(style.foreground.opacity(0.45), lineWidth: 1).frame(
        width: 296, height: 392
      ).offset(y: 25)
      Text("↗").font(.system(size: 93, weight: .black)).foregroundStyle(style.accent).offset(
        x: 121, y: 258)
    }
  }

  private var arch: Path {
    Path { p in
      p.move(to: CGPoint(x: 0, y: 82))
      p.addLine(to: CGPoint(x: 0, y: 65))
      p.addCurve(
        to: CGPoint(x: 168, y: 65), control1: CGPoint(x: 0, y: -22),
        control2: CGPoint(x: 168, y: -22))
      p.addLine(to: CGPoint(x: 168, y: 82))
      p.closeSubpath()
    }
  }
  private var tornStrip: Path {
    Path { p in
      p.move(to: .zero)
      for x in stride(from: 0.0, through: 390, by: 13) {
        p.addLine(to: CGPoint(x: x, y: 5 + sin(x * 0.7) * 4))
      }
      p.addLine(to: CGPoint(x: 390, y: 91))
      p.addLine(to: CGPoint(x: 0, y: 91))
      p.closeSubpath()
    }
  }
}

#if DEBUG
  /// Opt-in design proof output from the real ImageRenderer path. UI tests provide
  /// synthetic data only. Nothing runs in Release or on an ordinary share action.
  extension PassageStoryCard {
    @MainActor static func writeDesignProofs(longStory: PassageStory) async throws {
      let directory = URL.documentsDirectory.appending(
        path: "PosterProofs", directoryHint: .isDirectory)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let annotation = ReaderAnnotation(
        id: UUID(), articleURL: URL(string: "https://example.com/attention")!, quote: nil,
        note: "Pay attention. The ordinary world is full of extraordinary things.",
        isHighlighted: false, createdAt: .distantPast, updatedAt: .distantPast)
      let shortStory = PassageStory(annotation: annotation, title: "A practice of attention")
      var wholeAnnotation = annotation
      wholeAnnotation.note =
        "Pay attention. The ordinary world is full of extraordinary things. A good passage asks us to pause, then look again. Keep the sentences that change what you notice; return to them when the familiar starts to feel invisible. There is no hurry. Let a little room for wonder remain in the day, and carry that attention back into the world."
      let wholeStory = PassageStory(annotation: wholeAnnotation, title: "A practice of attention")
      for style in StoryStyle.allCases {
        for format in StoryFormat.allCases {
          for photo in [false, true] where !photo || style.supportsArticleImage {
            let layout = StoryCardLayout(format: format, hasImage: photo)
            let pages = longStory.pages(for: layout)
            guard pages.joined() == longStory.text,
              pages.allSatisfy({ layout.fits($0, style: style) })
            else { throw CocoaError(.coderInvalidValue) }
            let single = StoryCardLayout(format: format, hasImage: photo, single: true)
            let full = single.fits(wholeStory.text, style: style) ? wholeStory : shortStory
            let renderer = ImageRenderer(
              content: PassageStoryCard(
                story: full, style: style, text: full.text, page: 0, count: 1,
                layout: single, articleImage: photo ? UIImage(named: "OnboardingArticle") : nil))
            renderer.scale = 3
            guard let image = renderer.uiImage, let data = image.pngData(),
              image.cgImage?.width == 1080, image.cgImage?.height == Int(format.height * 3)
            else { throw CocoaError(.coderInvalidValue) }
            try data.write(
              to: directory.appending(
                path:
                  "\(format.rawValue.lowercased())-\(photo ? "photo" : "whole")-\(style.rawValue.lowercased()).png"
              ), options: .atomic)
            await Task.yield()
          }
        }
        for (prefix, story) in [("short", shortStory), ("long", longStory)] {
          let renderer = ImageRenderer(
            content: PassageStoryCard(
              story: story, style: style, text: story.pages[0], page: 0, count: story.pages.count))
          renderer.scale = 3
          guard let image = renderer.uiImage, let data = image.pngData() else {
            throw CocoaError(.fileWriteUnknown)
          }
          guard image.cgImage?.width == 1080, image.cgImage?.height == 1920 else {
            throw CocoaError(.coderInvalidValue)
          }
          try data.write(
            to: directory.appending(path: "\(prefix)-\(style.rawValue.lowercased()).png"),
            options: .atomic)
          await Task.yield()
        }
      }
    }
  }
#endif

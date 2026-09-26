import SwiftUI
import UIKit

/// A local export snapshot. Sharing does not mutate the highlight or send it to a service.
struct PassageStory: Identifiable {
  let id = UUID()
  let text: String
  let title: String
  let url: URL
  let pages: [String]

  init(annotation: ReaderAnnotation, title: String?) {
    text = annotation.quote?.exact ?? annotation.note
    self.title = title ?? annotation.articleURL.host ?? "Article"
    url = annotation.articleURL
    pages = Self.paginate(annotation.quote?.exact ?? annotation.note)
  }

  /// Preserve the complete passage across cards, including CJK and long words.
  /// A bounded page keeps the smallest type readable at story size.
  private static func paginate(_ text: String) -> [String] {
    var remaining = text[...]
    var result: [String] = []
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 4
    // The largest actual font metrics decide shared pagination. Binary search
    // bounds shaping work, including long notes and explicit paragraph breaks.
    let fonts = StoryStyle.allCases.map(\.font)
    while !remaining.isEmpty {
      let candidate = Array(remaining.prefix(300))
      var lower = 1
      var upper = candidate.count
      while lower < upper {
        let middle = (lower + upper + 1) / 2
        let sample = String(candidate.prefix(middle)) as NSString
        let fits = fonts.allSatisfy { font in
          sample.boundingRect(
            with: CGSize(width: 296, height: CGFloat.greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font, .paragraphStyle: paragraph], context: nil
          ).height <= 232
        }
        if fits { lower = middle } else { upper = middle - 1 }
      }
      var end = remaining.index(remaining.startIndex, offsetBy: lower)
      if end != remaining.endIndex,
        let space = remaining[..<end].lastIndex(where: \.isWhitespace),
        remaining.distance(from: remaining.startIndex, to: space) > 100
      {
        end = remaining.index(after: space)
      }
      result.append(String(remaining[..<end]))
      remaining = remaining[end...]
    }
    return result.isEmpty ? [""] : result
  }
}

/// Editorial treatments are local vector layouts, not full-size bitmap backgrounds.
/// Type and source attribution remain crisp in every exported card.
enum StoryStyle: String, CaseIterable, Identifiable {
  case paper = "Paper"
  case ink = "Ink"
  case ice = "Ice"
  case folio = "Folio"
  case field = "Field"
  case signal = "Signal"
  case index = "Index"
  case dusk = "Dusk"
  case cutout = "Cutout"
  case ribbon = "Ribbon"
  var id: String { rawValue }

  var background: Color {
    switch self {
    case .paper: return Color(red: 0.97, green: 0.95, blue: 0.89)
    case .ink: return Color(red: 0.10, green: 0.11, blue: 0.12)
    case .ice: return Color(red: 0.90, green: 0.96, blue: 0.96)
    case .folio: return Color(red: 0.90, green: 0.90, blue: 0.98)
    case .field: return Color(red: 0.91, green: 0.92, blue: 0.82)
    case .signal: return Color(red: 0.94, green: 0.23, blue: 0.13)
    case .index: return Color(red: 0.95, green: 0.93, blue: 0.86)
    case .dusk: return Color(red: 0.19, green: 0.15, blue: 0.32)
    case .cutout: return Color(red: 0.83, green: 0.89, blue: 0.98)
    case .ribbon: return Color(red: 0.98, green: 0.76, blue: 0.79)
    }
  }
  var foreground: Color {
    switch self {
    case .ink, .dusk: return Color(red: 0.98, green: 0.96, blue: 0.91)
    case .signal: return Color(red: 0.02, green: 0.02, blue: 0.02)
    case .folio: return Color(red: 0.24, green: 0.22, blue: 0.52)
    case .field: return Color(red: 0.17, green: 0.28, blue: 0.20)
    case .cutout: return Color(red: 0.12, green: 0.24, blue: 0.50)
    case .ribbon: return Color(red: 0.46, green: 0.12, blue: 0.27)
    default: return Color(red: 0.13, green: 0.14, blue: 0.13)
    }
  }
  var accent: Color {
    switch self {
    case .paper, .index: return Color(red: 0.67, green: 0.24, blue: 0.18)
    case .ink: return Color(red: 0.81, green: 0.97, blue: 0.49)
    case .ice: return Color(red: 0.22, green: 0.48, blue: 0.55)
    case .folio: return Color(red: 0.55, green: 0.33, blue: 0.60)
    case .field: return Color(red: 0.44, green: 0.49, blue: 0.22)
    case .signal: return Color(red: 0.98, green: 0.94, blue: 0.85)
    case .dusk: return Color(red: 0.91, green: 0.62, blue: 0.58)
    case .cutout: return Color(red: 0.91, green: 0.35, blue: 0.24)
    case .ribbon: return Color(red: 0.88, green: 0.23, blue: 0.11)
    }
  }
  var font: UIFont {
    switch self {
    case .ink: return .systemFont(ofSize: 27, weight: .medium)
    case .signal: return .systemFont(ofSize: 28, weight: .bold)
    case .index: return .monospacedSystemFont(ofSize: 23, weight: .regular)
    case .ribbon: return .systemFont(ofSize: 28, weight: .heavy)
    case .folio, .dusk:
      let descriptor = UIFont.systemFont(ofSize: 28).fontDescriptor.withDesign(.serif)!
      return UIFont(descriptor: descriptor.withSymbolicTraits(.traitItalic) ?? descriptor, size: 28)
    default:
      return UIFont(
        descriptor: UIFont.systemFont(ofSize: 28).fontDescriptor.withDesign(.serif)!, size: 28)
    }
  }
}

/// All themes share a measured 296 × 232 passage region and a fixed 360 × 640
/// canvas. Their composition differs, but changing style never changes pagination.
struct PassageStoryCard: View {
  let story: PassageStory
  let style: StoryStyle
  let text: String
  let page: Int
  let count: Int

  var body: some View {
    // Background ornaments must not enlarge the text's layout proposal. Oversized
    // ellipses and rotated paper may bleed, but the reading canvas stays fixed.
    style.background.frame(width: 360, height: 640)
      .overlay { decoration.frame(width: 360, height: 640) }
      .overlay { composition.frame(width: 360, height: 640) }
      .clipped()
      .environment(\.dynamicTypeSize, .medium)
      .environment(\.colorScheme, [.ink, .dusk].contains(style) ? .dark : .light)
  }

  @ViewBuilder private var composition: some View {
    switch style {
    case .folio:
      VStack(alignment: .leading, spacing: 0) {
        header
        source(serif: true).padding(.top, 20)
        Rectangle().fill(style.foreground.opacity(0.25)).frame(height: 1).padding(.vertical, 20)
        quote
        Spacer(minLength: 10)
        Text("A PASSAGE TO KEEP").font(.system(size: 8, weight: .medium)).tracking(3)
      }.padding(.horizontal, 32).padding(.vertical, 64)
    case .index:
      VStack(alignment: .leading, spacing: 0) {
        header
        Text("EXCERPT / \(String(format: "%03d", page + 1))")
          .font(.system(size: 10, design: .monospaced)).tracking(1).padding(.top, 28)
        Rectangle().fill(style.foreground.opacity(0.3)).frame(height: 1).padding(.vertical, 16)
        quote
        Spacer(minLength: 14)
        source(serif: false)
      }.padding(.horizontal, 32).padding(.vertical, 66)
    case .signal:
      VStack(alignment: .leading, spacing: 0) {
        header
        Text("READ / RETAIN.").font(.system(size: 28, weight: .black)).tracking(-1.4)
          .padding(.top, 24).padding(.bottom, 24)
        quote
        Spacer(minLength: 14)
        source(serif: false)
      }.padding(.horizontal, 32).padding(.vertical, 54)
    case .cutout:
      VStack(alignment: .leading, spacing: 0) {
        header
        Spacer(minLength: 20)
        quote.padding(.vertical, 15).background(style.background.opacity(0.97))
        Spacer(minLength: 20)
        source(serif: true).padding(.vertical, 12)
      }.padding(.horizontal, 32).padding(.vertical, 70)
    default:
      VStack(alignment: .leading, spacing: 0) {
        header
        Spacer(minLength: 14)
        if style == .ink {
          Rectangle().fill(style.accent).frame(width: 48, height: 4).padding(.bottom, 20)
        } else if style == .ribbon {
          Text("A GOOD LINE.").font(.system(size: 11, weight: .black)).tracking(2)
            .padding(.bottom, 18)
        } else {
          Text("“").font(.system(size: 62, design: .serif)).foregroundStyle(style.accent)
            .frame(height: 42, alignment: .topLeading).padding(.bottom, 10)
        }
        quote
        Spacer(minLength: 16)
        source(serif: style == .paper || style == .field)
      }.padding(.horizontal, 32).padding(.vertical, 64)
    }
  }

  private var quote: some View {
    Text(text.trimmingCharacters(in: .whitespacesAndNewlines))
      .font(Font(style.font)).lineSpacing(4)
      .foregroundStyle(style.foreground)
      .fixedSize(horizontal: false, vertical: true)
      .frame(width: 296, alignment: .leading)
  }

  private var header: some View {
    HStack {
      // Reuse the real mark's silhouette while applying this edition's ink colour.
      style.foreground.opacity(0.72).mask(ArcticMark()).frame(width: 17, height: 17)
      Spacer()
      if count > 1 {
        Text(String(format: "%02d / %02d", page + 1, count))
          .font(.system(size: 10, design: .monospaced)).foregroundStyle(
            style.foreground.opacity(0.85))
      }
    }
  }

  private func source(serif: Bool) -> some View {
    VStack(alignment: .leading, spacing: 7) {
      Text(story.title).font(
        .system(size: serif ? 14 : 12, weight: .medium, design: serif ? .serif : .default)
      )
      .lineLimit(3).foregroundStyle(style.foreground)
      Text(story.url.host?.replacingOccurrences(of: "www.", with: "") ?? "")
        .font(.system(size: 9, design: style == .index ? .monospaced : .default))
        .foregroundStyle(style.foreground.opacity(0.85))
    }
  }

  @ViewBuilder private var decoration: some View {
    switch style {
    case .paper:
      Rectangle().stroke(style.accent.opacity(0.35), lineWidth: 0.5).padding(18)
      Rectangle().fill(style.accent).frame(width: 26, height: 2).offset(x: -135, y: 251)
    case .ink:
      Text("”").font(.system(size: 300, weight: .black, design: .serif))
        .foregroundStyle(style.foreground.opacity(0.035)).offset(x: 98, y: -164)
    case .ice:
      LinearGradient(
        colors: [style.background, Color.white.opacity(0.4), style.accent.opacity(0.16)],
        startPoint: .topLeading, endPoint: .bottomTrailing)
      Image("EmptySaved").resizable().scaledToFit().frame(width: 360)
        .opacity(0.18).blendMode(.multiply).offset(y: 215)
    case .folio:
      Rectangle().fill(style.foreground.opacity(0.055)).frame(width: 118).offset(x: 122)
      Rectangle().fill(style.accent).frame(width: 360, height: 10).offset(y: 315)
    case .field:
      Image("EmptyFavourites").resizable().scaledToFit().frame(width: 240)
        .saturation(0).opacity(0.13).blendMode(.multiply).offset(x: 115, y: 208)
      Path { path in
        path.move(to: CGPoint(x: 20, y: 48))
        path.addLine(to: CGPoint(x: 20, y: 592))
      }.stroke(style.accent.opacity(0.5), lineWidth: 0.75)
    case .signal:
      Rectangle().fill(style.accent).frame(width: 45, height: 6).rotationEffect(.degrees(-45))
        .offset(x: 128, y: -199)
    case .index:
      Canvas { context, size in
        for y in stride(from: 30.0, through: 610.0, by: 24) {
          var line = Path()
          line.move(to: CGPoint(x: 0, y: y))
          line.addLine(to: CGPoint(x: size.width, y: y))
          context.stroke(line, with: .color(style.foreground.opacity(0.055)), lineWidth: 0.5)
        }
      }
      Rectangle().fill(style.accent.opacity(0.4)).frame(width: 1).offset(x: -158)
    case .dusk:
      LinearGradient(
        colors: [style.background, Color(red: 0.45, green: 0.26, blue: 0.38), style.background],
        startPoint: .topLeading, endPoint: .bottomTrailing)
      Circle().fill(
        RadialGradient(
          colors: [style.accent.opacity(0.24), .clear], center: .center,
          startRadius: 0, endRadius: 160)
      ).frame(width: 320, height: 320).offset(x: 110, y: 190)
      Circle().stroke(style.foreground.opacity(0.12), lineWidth: 0.7)
        .frame(width: 430, height: 430).offset(x: 155, y: -245)
    case .cutout:
      Rectangle().fill(style.accent).frame(width: 400, height: 122).rotationEffect(.degrees(-9))
        .offset(y: -229)
      Rectangle().fill(Color(red: 0.98, green: 0.94, blue: 0.85)).frame(width: 326, height: 466)
        .rotationEffect(.degrees(2)).offset(y: 15)
      Rectangle().fill(style.foreground.opacity(0.15)).frame(width: 64, height: 21)
        .rotationEffect(.degrees(-12)).offset(x: 107, y: -220)
    case .ribbon:
      Rectangle().fill(style.accent).frame(width: 360, height: 42).offset(y: -299)
      Rectangle().fill(style.foreground).frame(width: 360, height: 38).offset(y: 301)
      Circle().fill(style.accent.opacity(0.18)).frame(width: 170, height: 170).offset(
        x: 177, y: -150)
    }
  }
}

struct PassageStorySheet: View {
  let story: PassageStory
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var style = StoryStyle.paper
  @State private var page = 0
  @State private var export: StoryExport?
  @State private var rendering = false
  @State private var error: String?

  var body: some View {
    let pages = story.pages
    NavigationStack {
      VStack(spacing: 16) {
        GeometryReader { geometry in
          let scale = min(geometry.size.width / 360, geometry.size.height / 640)
          card(pages).id("\(style.rawValue)-\(page)")
            .scaleEffect(scale, anchor: .topLeading)
            .frame(width: 360 * scale, height: 640 * scale, alignment: .topLeading)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: .black.opacity(0.09), radius: 16, y: 6)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.opacity)
            .animation(.easeOut(duration: reduceMotion ? 0.1 : 0.18), value: style)
        }.accessibilityElement(children: .ignore)
          .accessibilityLabel(pages[page])
          .accessibilityValue("\(style.rawValue), card \(page + 1) of \(pages.count)")
          .accessibilityIdentifier("story-preview")
        if pages.count > 1 {
          HStack(spacing: 24) {
            Button("Previous card", systemImage: "chevron.left") { page -= 1 }
              .disabled(page == 0).labelStyle(.iconOnly).frame(width: 44, height: 36)
            Text("\(page + 1) / \(pages.count)").font(.caption.monospacedDigit()).foregroundStyle(
              .secondary)
            Button("Next card", systemImage: "chevron.right") { page += 1 }
              .disabled(page + 1 == pages.count).labelStyle(.iconOnly).frame(width: 44, height: 36)
          }
        }
        ScrollView(.horizontal) {
          HStack(spacing: 12) {
            ForEach(StoryStyle.allCases) { item in
              Button {
                withAnimation(.easeOut(duration: reduceMotion ? 0.1 : 0.18)) { style = item }
              } label: {
                VStack(spacing: 7) {
                  ZStack(alignment: .bottomLeading) {
                    item.background
                    Rectangle().fill(item.accent).frame(width: 22, height: 3).padding(7)
                    Text("Aa").font(Font(item.font).bold()).foregroundStyle(item.foreground)
                      .frame(maxWidth: .infinity, maxHeight: .infinity)
                  }.frame(width: 58, height: 58).clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                      RoundedRectangle(cornerRadius: 12).strokeBorder(
                        style == item ? ArcticBrand.accent : .clear, lineWidth: 2))
                  Text(item.rawValue).font(.caption2).foregroundStyle(.secondary)
                }
              }.buttonStyle(ArcticPressStyle()).accessibilityLabel(item.rawValue)
                .accessibilityAddTraits(style == item ? .isSelected : [])
                .accessibilityIdentifier("story-style-" + item.rawValue)
            }
          }.padding(.vertical, 2)
        }.scrollIndicators(.hidden).fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("story-styles")
        Button {
          render(pages)
        } label: {
          Label(rendering ? "Preparing…" : "Share image", systemImage: "square.and.arrow.up")
            .font(.headline).frame(maxWidth: .infinity).frame(height: 52)
        }.buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
          .disabled(rendering).accessibilityIdentifier("story-export")
      }.padding(.horizontal, 24).padding(.vertical, 12)
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("Share a passage").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }.tint(ArcticBrand.accent)
      .sheet(item: $export) { item in StoryActivity(image: item.image) }
      .alert(
        "Could not create image",
        isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })
      ) {
        Button("OK") { error = nil }
      } message: {
        Text(error ?? "")
      }
  }

  private func card(_ pages: [String]) -> PassageStoryCard {
    PassageStoryCard(story: story, style: style, text: pages[page], page: page, count: pages.count)
  }

  @MainActor private func render(_ pages: [String]) {
    rendering = true
    // Only the selected card is rasterized. Browsing templates retains no bitmap queue.
    Task { @MainActor in
      await Task.yield()
      let renderer = ImageRenderer(content: card(pages))
      renderer.scale = 3
      if let image = renderer.uiImage {
        export = StoryExport(image: image)
      } else {
        error = "Please try again."
      }
      rendering = false
    }
  }
}

private struct StoryExport: Identifiable {
  let id = UUID()
  let image: UIImage
}
private struct StoryActivity: UIViewControllerRepresentable {
  let image: UIImage
  func makeUIViewController(context: Context) -> UIActivityViewController {
    UIActivityViewController(activityItems: [image], applicationActivities: nil)
  }
  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Feedback only: no looping or scrolling-dependent animation, with a gentle
/// opacity alternative for Reduce Motion. Native sheets own presentation motion.
struct ArcticPressStyle: ButtonStyle {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
      .opacity(configuration.isPressed ? 0.8 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

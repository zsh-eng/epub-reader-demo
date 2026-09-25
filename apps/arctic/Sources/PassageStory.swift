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
    while !remaining.isEmpty {
      var end =
        remaining.index(remaining.startIndex, offsetBy: 300, limitedBy: remaining.endIndex)
        ?? remaining.endIndex
      let paragraph = NSMutableParagraphStyle()
      paragraph.lineSpacing = 4
      let descriptor = UIFont.systemFont(ofSize: 28).fontDescriptor.withDesign(.serif)!
      // Size for the larger serif face used by Paper/Ice. Newlines and emoji
      // consume height too; character count alone cannot prevent clipped cards.
      let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont(descriptor: descriptor, size: 28), .paragraphStyle: paragraph,
      ]
      while remaining.distance(from: remaining.startIndex, to: end) > 1,
        (String(remaining[..<end]) as NSString).boundingRect(
          with: CGSize(width: 296, height: CGFloat.greatestFiniteMagnitude),
          options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil
        ).height > 300
      {
        end = remaining.index(before: end)
      }
      if end != remaining.endIndex,
        let space = remaining[..<end].lastIndex(where: \.isWhitespace),
        remaining.distance(from: remaining.startIndex, to: space) > 180
      {
        end = remaining.index(after: space)
      }
      result.append(String(remaining[..<end]))
      remaining = remaining[end...]
    }
    return result.isEmpty ? [""] : result
  }
}

enum StoryStyle: String, CaseIterable, Identifiable {
  case paper = "Paper"
  case ink = "Ink"
  case ice = "Ice"
  var id: String { rawValue }
  var background: Color {
    self == .ink ? ReadingPalette.dark.background : ReadingPalette.paper.background
  }
  var foreground: Color {
    self == .ink ? ReadingPalette.dark.foreground : ReadingPalette.light.foreground
  }
}

/// All typography and layout use a fixed 360 × 640 canvas. Preview and export
/// share this exact view; only the render scale changes (3× = 1080 × 1920).
struct PassageStoryCard: View {
  let story: PassageStory
  let style: StoryStyle
  let text: String
  let page: Int
  let count: Int

  var body: some View {
    ZStack {
      style.background
      if style == .ice {
        LinearGradient(
          colors: [
            ArcticBrand.accent.opacity(0.28), style.background, ArcticBrand.accent.opacity(0.09),
          ], startPoint: .topLeading, endPoint: .bottomTrailing)
        Image("EmptySaved").resizable().scaledToFit()
          .frame(width: 360).opacity(0.22).blendMode(.multiply).offset(y: 180)
      }
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 6) {
          ArcticMark().frame(width: 15, height: 15)
          Text("ARCTIC  /  MARGINALIA").font(.system(size: 9, weight: .semibold)).tracking(2)
          Spacer()
          if count > 1 {
            Text(String(format: "%02d / %02d", page + 1, count)).font(
              .system(size: 10).monospacedDigit())
          }
        }.foregroundStyle(style.foreground.opacity(0.6))
        Spacer(minLength: 20)
        if style == .ink {
          Rectangle().fill(ArcticBrand.accent).frame(width: 34, height: 3).padding(.bottom, 22)
        } else {
          Text("“").font(.system(size: 64, weight: .regular, design: .serif))
            .foregroundStyle(ArcticBrand.accent).frame(height: 46, alignment: .topLeading)
            .padding(.bottom, 12)
        }
        Text(text.trimmingCharacters(in: .whitespacesAndNewlines))
          .font(
            .system(
              size: text.count > 220 ? 23 : 28, weight: style == .ink ? .medium : .regular,
              design: style == .ink ? .default : .serif)
          )
          .lineSpacing(4).fixedSize(horizontal: false, vertical: true)
          .foregroundStyle(style.foreground)
        Spacer(minLength: 24)
        Rectangle().fill(style.foreground.opacity(0.18)).frame(height: 0.5).padding(.bottom, 14)
        Text(story.title).font(.system(size: 12, weight: .medium)).lineLimit(3)
          .foregroundStyle(style.foreground)
        Text(story.url.host?.replacingOccurrences(of: "www.", with: "") ?? "")
          .font(.system(size: 10)).foregroundStyle(style.foreground.opacity(0.6)).padding(.top, 6)
      }.padding(.horizontal, 32).padding(.vertical, 72)
    }.frame(width: 360, height: 640).clipped()
      .environment(\.dynamicTypeSize, .medium)
      .environment(\.colorScheme, style == .ink ? .dark : .light)
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
        HStack(spacing: 12) {
          ForEach(StoryStyle.allCases) { item in
            Button {
              withAnimation(.easeOut(duration: reduceMotion ? 0.1 : 0.18)) { style = item }
            } label: {
              VStack(spacing: 7) {
                Text("Aa").font(.system(size: 21, design: item == .ink ? .default : .serif))
                  .foregroundStyle(item.foreground).frame(width: 58, height: 44)
                  .background(
                    item == .ice ? ArcticBrand.accent.opacity(0.3) : item.background,
                    in: RoundedRectangle(cornerRadius: 12)
                  )
                  .overlay(
                    RoundedRectangle(cornerRadius: 12).strokeBorder(
                      style == item ? ArcticBrand.accent : .clear, lineWidth: 2))
                Text(item.rawValue).font(.caption2).foregroundStyle(.secondary)
              }
            }.buttonStyle(ArcticPressStyle()).accessibilityLabel(item.rawValue)
              .accessibilityAddTraits(style == item ? .isSelected : [])
              .accessibilityIdentifier("story-style-" + item.rawValue)
          }
        }
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

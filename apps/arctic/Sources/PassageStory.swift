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
          ).height <= 228
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
                  PassageStoryCard(
                    story: story, style: item, text: pages[page], page: page, count: pages.count
                  )
                  .scaleEffect(0.16, anchor: .topLeading)
                  .frame(width: 57.6, height: 102.4, alignment: .topLeading)
                  .clipShape(RoundedRectangle(cornerRadius: 6))
                  .overlay(
                    RoundedRectangle(cornerRadius: 6).strokeBorder(
                      style == item ? ArcticBrand.accent : .clear, lineWidth: 2)
                  )
                  .accessibilityHidden(true)
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
      .task {
        #if DEBUG
          if TestMode.enabled, ProcessInfo.processInfo.arguments.contains("-test-story-gallery") {
            do { try await PassageStoryCard.writeDesignProofs(longStory: story) } catch {
              self.error = "Design proof failed: \(error.localizedDescription)"
            }
          }
        #endif
      }
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

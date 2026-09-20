import SwiftUI

/// Completion feedback stays available for editing without blocking the reader.
/// The beam runs once; keeping the notice visible never keeps an animation alive.
struct TaggingFeedback: View {
  let title: String
  let tags: [String]
  let edit: () -> Void
  let dismiss: () -> Void
  @State private var glowing = true

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: "sparkles").font(.title3).padding(.top, 2)
      VStack(alignment: .leading, spacing: 5) {
        Text("Tagged for you").font(.subheadline.weight(.semibold))
        Text(title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        Text(tags.joined(separator: " · ")).font(.subheadline).lineLimit(3)
        Button("Edit tags", action: edit).font(.subheadline.weight(.semibold))
          .padding(.vertical, 5).accessibilityIdentifier("edit-automatic-tags")
      }.frame(maxWidth: .infinity, alignment: .leading)
      Button("Dismiss", systemImage: "xmark", action: dismiss)
        .labelStyle(.iconOnly).font(.caption.weight(.semibold))
        .frame(width: 32, height: 32).contentShape(Rectangle())
        .accessibilityIdentifier("dismiss-tagging-notice")
    }
    .padding(18)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
    .overlay {
      RoundedRectangle(cornerRadius: 24).strokeBorder(.primary.opacity(0.1), lineWidth: 0.5)
    }
    .tagBeam(active: glowing)
    .shadow(color: .black.opacity(0.08), radius: 18, y: 6)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("tagging-notice")
    .task {
      try? await Task.sleep(for: .seconds(2.4))
      glowing = false
    }
  }
}

import SwiftUI

/// Completion feedback stays available for editing without blocking the reader.
/// The beam runs once; keeping the notice visible never keeps an animation alive.
struct TaggingFeedback: View {
  let title: String
  let tags: [String]
  let edit: () -> Void
  let dismiss: () -> Void

  var body: some View {
    ConnectedTagReveal(isProcessing: false, tags: tags) {
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 5) {
          Text(title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 125), alignment: .leading)], alignment: .leading,
            spacing: 6
          ) {
            ForEach(Array(tags.enumerated()), id: \.element) { index, tag in
              TagRevealPill(name: tag, index: index)
            }
          }
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
      .shadow(color: .black.opacity(0.08), radius: 18, y: 6)
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("tagging-notice")
    }
  }
}

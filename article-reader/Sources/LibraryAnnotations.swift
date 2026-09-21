import SwiftUI

/// A library-wide index. Records remain owned by AnnotationStore; the same note
/// editor is used here and in Reader, so edits never fork into a second draft.
struct LibraryAnnotations: View {
  let articles: [SavedArticle]
  let open: (ReaderAnnotation) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  @State private var filter = PassageFilter.all
  @State private var editing: ReaderAnnotation?
  @State private var errorMessage: String?

  private enum PassageFilter: String, CaseIterable {
    case all = "All"
    case highlights = "Highlights"
    case notes = "Notes"
  }

  private var articleTitles: [URL: String] {
    Dictionary(articles.map { ($0.url, $0.title) }, uniquingKeysWith: { first, _ in first })
  }

  private var passages: [ReaderAnnotation] {
    let titles = articleTitles
    let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return AnnotationStore.shared.records.filter { record in
      guard record.deletedAt == nil else { return false }
      if filter == .highlights && !record.isHighlighted { return false }
      if filter == .notes && record.note.isEmpty { return false }
      guard !search.isEmpty else { return true }
      return [
        record.quote.exact, record.note, titles[record.articleURL] ?? "",
        record.articleURL.host ?? "",
      ]
      .contains { $0.localizedStandardContains(search) }
    }.sorted { $0.updatedAt > $1.updatedAt }
  }

  var body: some View {
    let titles = articleTitles
    let matching = passages
    return NavigationStack {
      ScrollView {
        LazyVStack(spacing: 14) {
          if let loadError = AnnotationStore.shared.loadError {
            Text(loadError).font(.caption).foregroundStyle(.secondary)
          }
          if matching.isEmpty {
            ContentUnavailableView(
              query.isEmpty ? "Keep a thought" : "No passages found",
              systemImage: "highlighter",
              description: query.isEmpty
                ? Text("Select text in Reader to highlight or add a note.") : nil
            )
            .padding(.top, 36)
          }
          ForEach(matching) { annotation in
            passageCard(annotation, title: titles[annotation.articleURL])
          }
        }.padding(20)
      }
      .background(Color(uiColor: .systemGroupedBackground))
      .safeAreaInset(edge: .top, spacing: 0) {
        Picker("Passages", selection: $filter) {
          ForEach(PassageFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented).padding(.horizontal, 20).padding(.vertical, 8)
        .background(.bar)
      }
      .searchable(text: $query, prompt: "Passage, note, or article")
      .navigationTitle("Highlights & notes").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
      }
    }
    .tint(ArcticBrand.accent)
    .presentationDetents([.large]).presentationDragIndicator(.visible)
    .sheet(item: $editing) { annotation in
      NavigationStack { AnnotationEditor(annotation: annotation) }
        .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
    .alert(
      "Could not save passage",
      isPresented: Binding(
        get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
      )
    ) {
      Button("OK") { errorMessage = nil }
    } message: {
      Text(errorMessage ?? "")
    }
  }

  private func passageCard(_ annotation: ReaderAnnotation, title: String?) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Button {
        editing = annotation
      } label: {
        VStack(alignment: .leading, spacing: 12) {
          AnnotationQuote(quote: annotation.quote.exact, colour: annotation.highlightColour)
          if !annotation.note.isEmpty {
            Text(annotation.note).font(.body).lineLimit(5)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }.contentShape(Rectangle())
      }.buttonStyle(.plain).accessibilityIdentifier("library-passage-" + annotation.id.uuidString)
      HStack(alignment: .bottom, spacing: 12) {
        Button {
          open(annotation)
        } label: {
          VStack(alignment: .leading, spacing: 4) {
            Text(title ?? annotation.articleURL.host ?? "Article")
              .font(.subheadline.weight(.medium)).lineLimit(2)
            Text(annotation.articleURL.host ?? annotation.articleURL.absoluteString)
              .font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }.frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain).accessibilityLabel("Show in article")
        .accessibilityIdentifier("library-passage-open-" + annotation.id.uuidString)
        Menu {
          Button(
            annotation.note.isEmpty ? "Add note" : "Edit note", systemImage: "square.and.pencil"
          ) {
            editing = annotation
          }
          if annotation.isHighlighted {
            Button("Remove highlight", systemImage: "highlighter", role: .destructive) {
              perform { try AnnotationStore.shared.removeHighlight(annotation.id) }
            }
          }
          if !annotation.note.isEmpty || !annotation.isHighlighted {
            Button("Delete note", systemImage: "trash", role: .destructive) {
              perform { try AnnotationStore.shared.deleteNote(annotation.id) }
            }
          }
        } label: {
          Image(systemName: "ellipsis").frame(width: 44, height: 44)
        }.accessibilityLabel("Passage options")
      }
    }
    .padding(18)
    .background(
      Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22))
  }

  private func perform(_ action: () throws -> Void) {
    do { try action() } catch { errorMessage = error.localizedDescription }
  }
}

/// Each capsule is one glass surface. Increased contrast and reduced
/// transparency receive an opaque semantic surface with a clear boundary.
struct LibraryGlass: ViewModifier {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast

  @ViewBuilder func body(content: Content) -> some View {
    if reduceTransparency || contrast == .increased {
      content.background(ReaderTheme.secondary, in: Capsule())
        .overlay { Capsule().strokeBorder(ReaderTheme.border, lineWidth: 0.5) }
    } else if #available(iOS 26.0, *) {
      content.glassEffect(.regular, in: .capsule)
    } else {
      content.background(.regularMaterial, in: Capsule())
    }
  }
}

/// A short scroll-edge fade keeps the title readable as cards pass beneath it;
/// the lower edge is transparent, without a full-width opaque header slab.
struct LibraryScrollEdge: View {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  var body: some View {
    Rectangle()
      .fill(
        reduceTransparency ? AnyShapeStyle(ReaderTheme.background) : AnyShapeStyle(.regularMaterial)
      )
      .mask {
        LinearGradient(
          stops: [
            .init(color: .black, location: 0),
            .init(color: .black.opacity(0.9), location: 0.45),
            .init(color: .clear, location: 1),
          ], startPoint: .top, endPoint: .bottom)
      }
      .allowsHitTesting(false)
  }
}

/// Native phase changes avoid per-frame offset writes solely to detect scrolling.
struct LibraryScrollActivity: ViewModifier {
  let changed: (Bool) -> Void
  @ViewBuilder func body(content: Content) -> some View {
    if #available(iOS 18.0, *) {
      content.onScrollPhaseChange { _, phase in changed(phase != .idle) }
    } else {
      content
    }
  }
}

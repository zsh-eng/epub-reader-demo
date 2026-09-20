import SwiftUI

struct AnnotationPresentation: Identifiable {
  let id = UUID()
  var editing: UUID?
}

/// A quiet collection of passages, with the quoted source kept above each draft.
/// The native sheet and editor preserve familiar selection, keyboard and dismissal.
struct ReaderAnnotations: View {
  let browser: ArticleBrowser
  let presentation: AnnotationPresentation
  @Environment(\.dismiss) private var dismiss
  @State private var path: [UUID]
  @State private var errorMessage: String?

  init(browser: ArticleBrowser, presentation: AnnotationPresentation) {
    self.browser = browser
    self.presentation = presentation
    _path = State(initialValue: presentation.editing.map { [$0] } ?? [])
  }

  var body: some View {
    NavigationStack(path: $path) {
      ScrollView {
        LazyVStack(spacing: 14) {
          if let loadError = AnnotationStore.shared.loadError {
            Text(loadError).font(.caption).foregroundStyle(.secondary)
          }
          if browser.annotations.isEmpty {
            ContentUnavailableView(
              "Keep a thought", systemImage: "highlighter",
              description: Text("Select text in Reader to highlight or add a note.")
            )
            .padding(.top, 48)
          }
          ForEach(browser.annotations) { annotation in
            VStack(alignment: .leading, spacing: 12) {
              Button {
                path.append(annotation.id)
              } label: {
                VStack(alignment: .leading, spacing: 12) {
                  AnnotationQuote(quote: annotation.quote.exact)
                  if !annotation.note.isEmpty {
                    Text(annotation.note).font(.body).lineLimit(4).foregroundStyle(.primary)
                      .frame(maxWidth: .infinity, alignment: .leading)
                  }
                }
                .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              .accessibilityIdentifier("annotation-" + annotation.id.uuidString)
              HStack {
                if browser.unmatchedAnnotations.contains(annotation.id.uuidString) {
                  Text("Passage changed").font(.caption).foregroundStyle(.secondary)
                } else {
                  Button("Show in article", systemImage: "arrow.up.right") {
                    dismiss()
                    browser.revealAnnotation(annotation.id)
                  }.font(.caption.weight(.medium))
                }
                Spacer()
                Menu {
                  Button(
                    annotation.note.isEmpty ? "Add note" : "Edit note",
                    systemImage: "square.and.pencil"
                  ) {
                    path.append(annotation.id)
                  }
                  if annotation.isHighlighted {
                    Button("Remove highlight", systemImage: "highlighter", role: .destructive) {
                      perform { try AnnotationStore.shared.removeHighlight(annotation.id) }
                    }
                  }
                  if !annotation.note.isEmpty {
                    Button("Delete note", systemImage: "trash", role: .destructive) {
                      perform { try AnnotationStore.shared.updateNote("", id: annotation.id) }
                    }
                  }
                } label: {
                  Image(systemName: "ellipsis").frame(width: 44, height: 32)
                }.accessibilityLabel("Passage options")
              }
            }
            .padding(18)
            .background(
              Color(uiColor: .secondarySystemGroupedBackground),
              in: RoundedRectangle(cornerRadius: 22))
          }
        }.padding(20)
      }
      .background(Color(uiColor: .systemGroupedBackground))
      .navigationTitle("Notes")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
      }
      .navigationDestination(for: UUID.self) { id in
        if let annotation = browser.annotations.first(where: { $0.id == id }) {
          AnnotationEditor(annotation: annotation, browser: browser)
        }
      }
    }
    .tint(ArcticBrand.accent)
    .presentationDetents([.large])
    .presentationDragIndicator(.visible)
    .alert(
      "Could not save note",
      isPresented: Binding(
        get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
      )
    ) {
      Button("OK") { errorMessage = nil }
    } message: {
      Text(errorMessage ?? "")
    }
  }

  private func perform(_ action: () throws -> Void) {
    do {
      try action()
      browser.refreshAnnotations()
    } catch { errorMessage = error.localizedDescription }
  }
}

private struct AnnotationQuote: View {
  let quote: String
  var body: some View {
    HStack(alignment: .top, spacing: 13) {
      RoundedRectangle(cornerRadius: 2).fill(ArcticBrand.accent).frame(width: 3)
      Text(quote).font(.system(.body, design: .serif)).lineSpacing(4)
        .foregroundStyle(.primary).frame(maxWidth: .infinity, alignment: .leading)
    }
    .fixedSize(horizontal: false, vertical: true)
  }
}

private struct AnnotationEditor: View {
  let annotation: ReaderAnnotation
  let browser: ArticleBrowser
  @State private var text: String
  @State private var quoteHeight: CGFloat = 60
  @State private var errorMessage: String?
  @FocusState private var focused: Bool
  @Environment(\.dismiss) private var dismiss

  init(annotation: ReaderAnnotation, browser: ArticleBrowser) {
    self.annotation = annotation
    self.browser = browser
    _text = State(initialValue: annotation.note)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      ScrollView {
        AnnotationQuote(quote: annotation.quote.exact).padding(18)
          .onGeometryChange(for: CGFloat.self) {
            $0.size.height
          } action: {
            quoteHeight = $0
          }
      }
      .frame(height: min(170, max(60, quoteHeight)))
      .background(ArcticBrand.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 20))
      ZStack(alignment: .topLeading) {
        if text.isEmpty {
          Text("Your thought…").foregroundStyle(.tertiary).padding(.top, 8).padding(.leading, 5)
            .allowsHitTesting(false)
        }
        TextEditor(text: $text).scrollContentBackground(.hidden)
          .focused($focused).accessibilityLabel("Note").accessibilityIdentifier("annotation-note")
      }
      .font(.body)
      if let errorMessage {
        Text(errorMessage).font(.caption).foregroundStyle(.red)
      }
    }
    .padding(20).background(Color(uiColor: .systemBackground))
    .navigationTitle("Note").navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button("Done") {
          save()
          if errorMessage == nil { dismiss() }
        }
      }
    }
    .interactiveDismissDisabled(errorMessage != nil)
    .onAppear { focused = text.isEmpty }
    .onChange(of: text) { _, _ in save() }
  }

  private func save() {
    do {
      try AnnotationStore.shared.updateNote(text, id: annotation.id)
      errorMessage = nil
    } catch { errorMessage = "Not saved: " + error.localizedDescription }
  }
}

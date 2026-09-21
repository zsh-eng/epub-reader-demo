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
  @State private var detent: PresentationDetent

  init(browser: ArticleBrowser, presentation: AnnotationPresentation) {
    self.browser = browser
    self.presentation = presentation
    _path = State(initialValue: presentation.editing.map { [$0] } ?? [])
    _detent = State(initialValue: presentation.editing == nil ? .large : .medium)
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
                  AnnotationQuote(quote: annotation.quote.exact, colour: annotation.highlightColour)
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
                  if !annotation.note.isEmpty || !annotation.isHighlighted {
                    Button("Delete note", systemImage: "trash", role: .destructive) {
                      perform { try AnnotationStore.shared.deleteNote(annotation.id) }
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
          AnnotationEditor(annotation: annotation, onChange: browser.refreshAnnotations)
        }
      }
    }
    .tint(ArcticBrand.accent)
    .presentationDetents(path.isEmpty ? [.large] : [.medium, .large], selection: $detent)
    .onChange(of: path) { _, value in detent = value.isEmpty ? .large : .medium }
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

extension HighlightColour {
  var tint: Color {
    switch self {
    case .yellow: Color(uiColor: .systemYellow)
    case .sage: Color(uiColor: .systemGreen)
    case .rose: Color(uiColor: .systemPink)
    case .blue: Color(uiColor: .systemCyan)
    }
  }
}

struct AnnotationQuote: View {
  let quote: String
  var colour: HighlightColour = .yellow
  var body: some View {
    HStack(alignment: .top, spacing: 13) {
      RoundedRectangle(cornerRadius: 2).fill(colour.tint).frame(width: 3)
      Text(quote).font(.system(.body, design: .serif)).lineSpacing(4)
        .foregroundStyle(.primary).frame(maxWidth: .infinity, alignment: .leading)
    }
    .fixedSize(horizontal: false, vertical: true)
  }
}

struct AnnotationEditor: View {
  let annotation: ReaderAnnotation
  var onChange: () -> Void
  @State private var text: String
  @State private var quoteHeight: CGFloat = 60
  @State private var errorMessage: String?
  @FocusState private var focused: Bool
  @Environment(\.dismiss) private var dismiss

  init(annotation: ReaderAnnotation, onChange: @escaping () -> Void = {}) {
    self.annotation = annotation
    self.onChange = onChange
    _text = State(initialValue: annotation.note)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      ScrollView {
        AnnotationQuote(quote: annotation.quote.exact, colour: annotation.highlightColour).padding(
          18
        )
        .onGeometryChange(for: CGFloat.self) {
          $0.size.height
        } action: {
          quoteHeight = $0
        }
      }
      .frame(height: min(110, max(60, quoteHeight)))
      .background(
        annotation.highlightColour.tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 20))
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
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
    .interactiveDismissDisabled(errorMessage != nil)
    .onAppear { focused = text.isEmpty }
    .onChange(of: text) { _, _ in save() }
  }

  private func save() {
    do {
      try AnnotationStore.shared.updateNote(text, id: annotation.id)
      onChange()
      errorMessage = nil
    } catch { errorMessage = "Not saved: " + error.localizedDescription }
  }
}

/// A compact, one-tap palette keeps recolouring next to the reading controls.
/// The ring and check identify selection without relying on colour alone.
struct HighlightToolbar: View {
  let annotation: ReaderAnnotation
  let browser: ArticleBrowser

  var body: some View {
    HStack(spacing: 0) {
      ForEach(HighlightColour.allCases) { colour in
        Button {
          perform { try AnnotationStore.shared.recolour(annotation.id, colour: colour) }
          UISelectionFeedbackGenerator().selectionChanged()
        } label: {
          ZStack {
            Circle().fill(colour.tint.opacity(0.65)).frame(width: 26, height: 26)
            if annotation.isHighlighted && annotation.highlightColour == colour {
              Circle().strokeBorder(.primary.opacity(0.7), lineWidth: 1.5)
                .frame(width: 33, height: 33)
              Image(systemName: "checkmark").font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color.black.opacity(0.8))
            }
          }.frame(width: 44, height: 44)
        }
        .accessibilityLabel(colour.name + " highlight")
        .accessibilityAddTraits(
          annotation.isHighlighted && annotation.highlightColour == colour ? .isSelected : []
        )
        .accessibilityIdentifier("highlight-colour-" + colour.rawValue)
      }
      Divider().frame(height: 22).padding(.horizontal, 3)
      Button {
        browser.annotationPresentation = AnnotationPresentation(editing: annotation.id)
      } label: {
        Image(systemName: "square.and.pencil").frame(width: 44, height: 44)
      }
      .accessibilityLabel(annotation.note.isEmpty ? "Add note" : "Edit note")
      .accessibilityIdentifier("highlight-note")
      if annotation.isHighlighted {
        Button {
          perform { try AnnotationStore.shared.removeHighlight(annotation.id) }
          browser.selectedAnnotationID = nil
        } label: {
          Image(systemName: "eraser").frame(width: 44, height: 44)
        }
        .accessibilityLabel("Remove highlight").accessibilityIdentifier("highlight-remove")
      }
      Button {
        browser.selectedAnnotationID = nil
      } label: {
        Image(systemName: "xmark").frame(width: 44, height: 44)
      }.accessibilityLabel("Close highlight controls")
    }
    .font(.body.weight(.medium)).buttonStyle(.plain)
    .padding(.horizontal, 8).padding(.vertical, 5).readerGlass()
  }

  private func perform(_ action: () throws -> Void) {
    do {
      try action()
      browser.refreshAnnotations()
    } catch { browser.errorMessage = "Could not update passage: " + error.localizedDescription }
  }
}

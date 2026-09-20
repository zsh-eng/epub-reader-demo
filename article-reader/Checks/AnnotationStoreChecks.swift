// swiftc Sources/AnnotationStore.swift Checks/AnnotationStoreChecks.swift -o /tmp/arctic-annotations-check
import Foundation

enum TestMode { static let enabled = false }

@main struct AnnotationStoreChecks {
  @MainActor static func main() throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = URL(string: "https://fixture.example/article")!
    let quote = ReaderQuote(
      exact: "“Keep this” — 日本語", prefix: "Before ", suffix: " after", start: 7)
    let store = AnnotationStore(directory: directory)
    let annotation = try store.highlight(quote, in: url)
    try store.updateNote("A thought to keep", id: annotation.id)
    let restored = AnnotationStore(directory: directory)
    precondition(restored.annotations(for: url).first?.note == "A thought to keep")
    precondition(restored.annotations(for: url).first?.quote == quote)
    let repeated = try restored.highlight(quote, in: url)
    precondition(repeated.id == annotation.id)
    try restored.removeHighlight(annotation.id)
    precondition(restored.annotations(for: url).first?.note == "A thought to keep")
    precondition(restored.annotations(for: url).first?.isHighlighted == false)
    try restored.updateNote("", id: annotation.id)
    precondition(restored.annotations(for: url).first?.id == annotation.id)
    let emptyDraft = AnnotationStore(directory: directory)
    precondition(emptyDraft.annotations(for: url).first?.note == "")
    try emptyDraft.updateNote("Replacement thought", id: annotation.id)
    let replacement = AnnotationStore(directory: directory)
    precondition(replacement.annotations(for: url).first?.note == "Replacement thought")
    precondition(replacement.annotations(for: url).first?.id == annotation.id)
    try replacement.deleteNote(annotation.id)
    precondition(replacement.annotations(for: url).isEmpty)
    let deleted = AnnotationStore(directory: directory)
    precondition(deleted.records.first?.deletedAt != nil)
    try deleted.merge([annotation])
    precondition(deleted.annotations(for: url).isEmpty)
    // Deleting a note on a highlighted passage keeps its highlight.
    let highlighted = try deleted.highlight(quote, in: url)
    try deleted.updateNote("Temporary note", id: highlighted.id)
    try deleted.deleteNote(highlighted.id)
    precondition(deleted.annotations(for: url).first?.isHighlighted == true)
    precondition(deleted.annotations(for: url).first?.note == "")
    try deleted.removeHighlight(highlighted.id)
    precondition(deleted.annotations(for: url).isEmpty)
    // Empty note-only drafts can also be explicitly removed.
    let draft = try deleted.highlight(quote, in: url)
    try deleted.updateNote("A draft", id: draft.id)
    try deleted.removeHighlight(draft.id)
    try deleted.updateNote("", id: draft.id)
    try deleted.deleteNote(draft.id)
    precondition(deleted.annotations(for: url).isEmpty)
    try Data("bad json".utf8).write(to: directory.appending(path: "broken.json"))
    let partial = AnnotationStore(directory: directory)
    precondition(partial.records.count == 3)
    precondition(partial.loadError != nil)
    print(
      "Annotation storage: reopen, Unicode, deduplication, note preservation, clear-and-retype after restart, explicit deletion, stale merge, damaged-record isolation passed"
    )
  }
}

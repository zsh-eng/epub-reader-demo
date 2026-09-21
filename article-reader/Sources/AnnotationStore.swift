import Foundation
import Observation

/// Text and context survive Reader regeneration. `start` is a UTF-16 hint, not identity.
struct ReaderQuote: Codable, Equatable {
  var exact: String
  var prefix: String
  var suffix: String
  var start: Int
}

enum HighlightColour: String, Codable, CaseIterable, Identifiable {
  case yellow, sage, rose, blue
  var id: String { rawValue }
  var name: String { rawValue.capitalized }
}

struct ReaderAnnotation: Codable, Identifiable, Equatable {
  var id: UUID
  var articleURL: URL
  var quote: ReaderQuote
  var note: String
  var isHighlighted: Bool
  var createdAt: Date
  var updatedAt: Date
  var deletedAt: Date?
  // Optional on disk so existing passages decode without a migration.
  var colour: HighlightColour?
  var highlightColour: HighlightColour { colour ?? .yellow }
}

/// Small, atomic record files keep note edits independent of library size.
/// Tombstones and stable IDs let sync merge records without reviving deletions.
@MainActor @Observable final class AnnotationStore {
  static let shared = AnnotationStore()
  private(set) var records: [ReaderAnnotation] = []
  private(set) var loadError: String?
  private let directory: URL

  init(directory: URL? = nil) {
    self.directory =
      directory
      ?? URL.applicationSupportDirectory.appending(
        path: "ArticleReader/\(TestMode.enabled ? "TestAnnotations" : "Annotations")",
        directoryHint: .isDirectory)
    do {
      if directory == nil, TestMode.enabled,
        ProcessInfo.processInfo.arguments.contains("-reset-store")
      {
        try? FileManager.default.removeItem(at: self.directory)
      }
      try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
      let files = try FileManager.default.contentsOfDirectory(
        at: self.directory, includingPropertiesForKeys: nil)
      for file in files where file.pathExtension == "json" {
        do {
          records.append(
            try JSONDecoder().decode(ReaderAnnotation.self, from: Data(contentsOf: file)))
        } catch {
          // Keep damaged files, and continue loading the other passages.
          loadError = "A saved passage could not be read. Its file has been kept."
        }
      }
    } catch { loadError = error.localizedDescription }
  }

  func annotations(for url: URL) -> [ReaderAnnotation] {
    records.filter { $0.articleURL == url && $0.deletedAt == nil }
      .sorted { $0.quote.start < $1.quote.start }
  }

  @discardableResult func highlight(_ quote: ReaderQuote, in url: URL) throws -> ReaderAnnotation {
    if var existing = annotations(for: url).first(where: { $0.quote == quote }) {
      if !existing.isHighlighted {
        existing.isHighlighted = true
        existing.updatedAt = Date()
        try write(existing)
      }
      return existing
    }
    let now = Date()
    let record = ReaderAnnotation(
      id: UUID(), articleURL: url, quote: quote, note: "", isHighlighted: true,
      createdAt: now, updatedAt: now, colour: .yellow)
    try write(record)
    return record
  }

  func recolour(_ id: UUID, colour: HighlightColour) throws {
    guard var record = records.first(where: { $0.id == id && $0.deletedAt == nil }) else { return }
    guard record.highlightColour != colour || !record.isHighlighted else { return }
    record.colour = colour
    record.isHighlighted = true
    record.updatedAt = Date()
    try write(record)
  }

  func updateNote(_ note: String, id: UUID) throws {
    guard var record = records.first(where: { $0.id == id && $0.deletedAt == nil }),
      record.note != note
    else { return }
    record.note = note
    record.updatedAt = Date()
    // An empty draft is still an editable passage. Only an explicit delete can
    // remove its identity, including when editing resumes after an app restart.
    try write(record)
  }

  func deleteNote(_ id: UUID) throws {
    guard var record = records.first(where: { $0.id == id && $0.deletedAt == nil }) else { return }
    record.note = ""
    record.updatedAt = Date()
    if !record.isHighlighted { record.deletedAt = record.updatedAt }
    try write(record)
  }

  func removeHighlight(_ id: UUID) throws {
    guard var record = records.first(where: { $0.id == id && $0.deletedAt == nil }) else { return }
    record.isHighlighted = false
    record.updatedAt = Date()
    if record.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      record.deletedAt = record.updatedAt
    }
    try write(record)
  }

  func merge(_ incoming: [ReaderAnnotation]) throws {
    for record in incoming {
      if let local = records.first(where: { $0.id == record.id }),
        local.updatedAt >= record.updatedAt
      {
        continue
      }
      try write(record)
    }
  }

  private func write(_ record: ReaderAnnotation) throws {
    let data = try JSONEncoder().encode(record)
    try data.write(to: directory.appending(path: record.id.uuidString + ".json"), options: .atomic)
    if let index = records.firstIndex(where: { $0.id == record.id }) {
      records[index] = record
    } else {
      records.append(record)
    }
  }
}

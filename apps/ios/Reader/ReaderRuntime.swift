import Foundation

struct ReaderImport {
  let id, name, url: String
  var message: [String: Any] { ["type": "import", "id": id, "name": name, "url": url] }
}

/// Process-owned services. EPUB bytes stay in files; the bridge carries only a
/// private URL. An import is removed only after the web domain acknowledges it.
final class ReaderRuntime {
  let server = ReaderWebServer()
  private let importQueue = DispatchQueue(label: "app.reader.imports", qos: .userInitiated)
  var origin: String { server.origin }
  var keepAwake: Bool {
    get { UserDefaults.standard.object(forKey: "reader.keepAwake") as? Bool ?? true }
    set { UserDefaults.standard.set(newValue, forKey: "reader.keepAwake") }
  }

  func start(_ completion: @escaping (Result<String, Error>) -> Void) {
    server.start { result in DispatchQueue.main.async { completion(result) } }
  }

  func stage(_ urls: [URL], completion: @escaping (Result<[ReaderImport], Error>) -> Void) {
    importQueue.async {
      let result = Result { try urls.map { try self.stage($0) } }
      DispatchQueue.main.async { completion(result) }
    }
  }

  private func stage(_ source: URL) throws -> ReaderImport {
    guard source.isFileURL, source.pathExtension.lowercased() == "epub" else { throw RuntimeError.invalidImport }
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
    let id = UUID().uuidString
    let directory = try server.importDirectory(id)
    do {
      let coordinator = NSFileCoordinator()
      var coordinationError: NSError?
      var copyError: Error?
      coordinator.coordinate(readingItemAt: source, options: [], error: &coordinationError) { readable in
        do { try FileManager.default.copyItem(at: readable, to: directory.appendingPathComponent("book.epub")) }
        catch { copyError = error }
      }
      if let error = coordinationError ?? copyError { throw error }
      try source.lastPathComponent.write(to: directory.appendingPathComponent("name.txt"), atomically: true, encoding: .utf8)
      return descriptor(id: id, name: source.lastPathComponent)
    } catch {
      try? FileManager.default.removeItem(at: directory)
      throw error
    }
  }

  func pendingImports() throws -> [ReaderImport] {
    guard FileManager.default.fileExists(atPath: server.inbox.path) else { return [] }
    return try FileManager.default.contentsOfDirectory(at: server.inbox, includingPropertiesForKeys: nil)
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
      .filter { UUID(uuidString: $0.lastPathComponent) != nil }
      .compactMap { directory in
        guard FileManager.default.fileExists(atPath: directory.appendingPathComponent("book.epub").path),
              let name = try? String(contentsOf: directory.appendingPathComponent("name.txt"), encoding: .utf8) else { return nil }
        return descriptor(id: directory.lastPathComponent, name: name)
      }
  }

  func finishImport(_ id: String) throws {
    guard UUID(uuidString: id) != nil else { throw RuntimeError.invalidImport }
    try FileManager.default.removeItem(at: server.inbox.appendingPathComponent(id))
  }

  private func descriptor(id: String, name: String) -> ReaderImport {
    ReaderImport(id: id, name: name, url: "\(origin)/native-import/\(id)")
  }
}

enum RuntimeError: LocalizedError {
  case missingWebAssets, invalidImport
  var errorDescription: String? {
    switch self {
    case .missingWebAssets: return "Reader's bundled pages are missing. Build the web resources and rebuild the app."
    case .invalidImport: return "Select an EPUB file to add it to your library."
    }
  }
}

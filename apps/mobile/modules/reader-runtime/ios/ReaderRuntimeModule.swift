import ExpoModulesCore
import Foundation

/// Owns the web server for the app process. The fixed loopback origin keeps
/// WebKit's IndexedDB identity stable across app launches and app updates.
public final class ReaderRuntimeModule: Module {
  private let server = ReaderWebServer()

  public func definition() -> ModuleDefinition {
    Name("ReaderRuntime")

    View(ReaderControlsView.self) {
      Events("onCommand")
      Prop("snapshot") { (view: ReaderControlsView, json: String) in view.update(json: json) }
    }

    Function("getAppearance") { UserDefaults.standard.string(forKey: "reader.appearance") ?? "null" }
    Function("setAppearance") { (value: String) in UserDefaults.standard.set(value, forKey: "reader.appearance") }

    Function("getKeepAwake") {
      UserDefaults.standard.object(forKey: "reader.keepAwake") as? Bool ?? true
    }

    Function("setKeepAwake") { (value: Bool) in
      UserDefaults.standard.set(value, forKey: "reader.keepAwake")
    }

    AsyncFunction("start") { (promise: Promise) in
      self.server.start { result in
        switch result {
        case .success(let origin): promise.resolve(origin)
        case .failure(let error): promise.reject(error)
        }
      }
    }

    AsyncFunction("stageImport") { (uri: String, name: String) -> [String: String] in
      guard let source = URL(string: uri), source.isFileURL else {
        throw RuntimeError.invalidImport
      }
      let scoped = source.startAccessingSecurityScopedResource()
      defer { if scoped { source.stopAccessingSecurityScopedResource() } }
      let id = UUID().uuidString
      let directory = try self.server.importDirectory(id)
      let target = directory.appendingPathComponent("book.epub")
      try FileManager.default.copyItem(at: source, to: target)
      try name.write(to: directory.appendingPathComponent("name.txt"), atomically: true, encoding: .utf8)
      return self.server.importDescriptor(id: id, name: name)
    }

    AsyncFunction("finishImport") { (id: String) in
      guard UUID(uuidString: id) != nil else { throw RuntimeError.invalidImport }
      let directory = self.server.inbox.appendingPathComponent(id)
      if FileManager.default.fileExists(atPath: directory.path) {
        try FileManager.default.removeItem(at: directory)
      }
    }

    AsyncFunction("pendingImports") { () -> [[String: String]] in
      guard FileManager.default.fileExists(atPath: self.server.inbox.path) else { return [] }
      return try FileManager.default.contentsOfDirectory(at: self.server.inbox, includingPropertiesForKeys: nil)
        .filter { UUID(uuidString: $0.lastPathComponent) != nil }
        .compactMap { directory in
          guard FileManager.default.fileExists(atPath: directory.appendingPathComponent("book.epub").path),
                let name = try? String(contentsOf: directory.appendingPathComponent("name.txt"), encoding: .utf8)
          else { return nil }
          return self.server.importDescriptor(id: directory.lastPathComponent, name: name)
        }
    }
  }
}

enum RuntimeError: Error {
  case missingWebAssets
  case invalidImport
}

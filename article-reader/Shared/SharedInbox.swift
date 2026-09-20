import Foundation

/// The extension writes one atomic file per share. The app deletes a file only
/// after its own library commit succeeds; the two processes never edit one JSON file.
enum SharedInbox {
  static let group = "group.com.zsheng.ArticleReader"

  static func webURL(_ text: String) -> URL? {
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.contains(where: \.isWhitespace), let url = URL(string: text),
      ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
      let host = url.host, host.contains(".")
    else { return nil }
    return url
  }

  static func directory() throws -> URL {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else {
      throw InboxError.unavailable
    }
    let directory = root.appending(path: "IncomingLinks", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  static func save(_ url: URL) throws {
    guard webURL(url.absoluteString) != nil else { throw InboxError.invalidLink }
    let file = try directory().appending(path: UUID().uuidString + ".json")
    try JSONEncoder().encode(url).write(to: file, options: .atomic)
  }

  enum InboxError: LocalizedError {
    case unavailable, invalidLink
    var errorDescription: String? {
      switch self {
      case .unavailable:
        "Shared storage is unavailable. Enable the Articles App Group for both targets in Xcode."
      case .invalidLink: "Share a complete HTTP or HTTPS article link."
      }
    }
  }
}

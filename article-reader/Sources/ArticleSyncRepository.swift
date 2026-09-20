import ArcticSync
import CryptoKit
import Foundation

/// Local and authenticated libraries are separate profiles. Signing in does not
/// silently copy the local library, and signing out cannot expose another account.
enum ArticleSyncScope: Equatable, Sendable {
  case local
  case account(server: URL, id: String)

  var identity: String {
    get throws {
      switch self {
      case .local: return "local"
      case .account(let server, let id):
        guard var origin = URLComponents(url: server, resolvingAgainstBaseURL: false),
          origin.scheme?.lowercased() == "https", let host = origin.host, !host.isEmpty,
          origin.user == nil, origin.password == nil, !id.isEmpty
        else { throw ArticleSyncError.invalidScope }
        origin.scheme = "https"
        origin.host = host.lowercased()
        if origin.port == 443 { origin.port = nil }
        origin.path = ""
        origin.query = nil
        origin.fragment = nil
        guard let value = origin.string else { throw ArticleSyncError.invalidScope }
        return value + "\n" + id
      }
    }
  }
}

enum ArticleSyncError: Error, Equatable {
  case invalidScope, invalidValue, localMigrationIntoAccount, localProfileCannotSync
}

/// Versioned record families keep page metadata separate from library actions
/// and explicit tag edits. Credentials, cached-file paths and pending requests
/// never enter these records.
enum ArticleSyncCodec {
  struct Metadata: Codable {
    let url: URL
    let title: String
    let subtitle: String
    let taggingText: String?
    let imageURL: URL?
    let faviconURL: URL?
  }
  struct Library: Codable {
    let url: URL
    let saved: Bool
    let archived: Bool
    let read: Bool
    let savedAt: Date?
    let lastVisitedAt: Date?
    let importBatchID: UUID?
  }
  struct Tags: Codable {
    let url: URL
    let names: [String]
    let generation: UUID
    let automatic: [String]
    let manual: [String]
    let rejected: [String]
    let completedIdentity: String?
  }

  /// Query strings can identify different documents and are retained. Fragments,
  /// default ports and host casing do not identify a different saved article.
  static func canonicalURL(_ url: URL) throws -> URL {
    guard var value = URLComponents(url: url, resolvingAgainstBaseURL: false),
      let scheme = value.scheme?.lowercased(), ["https", "http"].contains(scheme),
      let host = value.host, !host.isEmpty, value.user == nil, value.password == nil
    else { throw ArticleSyncError.invalidValue }
    value.scheme = scheme
    value.host = host.lowercased()
    if (scheme == "https" && value.port == 443) || (scheme == "http" && value.port == 80) {
      value.port = nil
    }
    value.fragment = nil
    if value.path.isEmpty { value.path = "/" }
    guard let result = value.url else { throw ArticleSyncError.invalidValue }
    return result
  }

  static func hash(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  static func identity(_ url: URL) throws -> String { try hash(canonicalURL(url).absoluteString) }

  static func localID(_ identity: String) -> UUID {
    let hex = String(identity.prefix(32))
    let offsets = [0, 8, 12, 16, 20, 32]
    let parts = zip(offsets, offsets.dropFirst()).map { begin, end in
      String(
        hex[hex.index(hex.startIndex, offsetBy: begin)..<hex.index(hex.startIndex, offsetBy: end)])
    }
    return UUID(uuidString: parts.joined(separator: "-"))!
  }

  static func encode<T: Encodable>(_ value: T) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return String(decoding: try encoder.encode(value), as: UTF8.self)
  }

  private static func sharedImageURL(_ url: URL?) -> URL? {
    guard let url, ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return nil }
    return url
  }

  static func values(_ article: SavedArticle) throws -> [String: String] {
    let url = try canonicalURL(article.url)
    let id = try identity(url)
    let state = article.tagging
    return [
      "article/" + id: try encode(
        Metadata(
          url: url, title: article.title, subtitle: article.subtitle,
          taggingText: article.taggingText, imageURL: sharedImageURL(article.imageURL),
          faviconURL: sharedImageURL(article.faviconURL))),
      "library/" + id: try encode(
        Library(
          url: url, saved: article.saved, archived: article.isArchived == true,
          read: article.isRead == true, savedAt: article.savedAt,
          lastVisitedAt: article.lastVisitedAt, importBatchID: article.importBatchID)),
      "tags/" + id: try encode(
        Tags(
          url: url, names: article.tagNames.sorted(), generation: state?.generation ?? localID(id),
          automatic: state?.automatic.sorted() ?? [],
          manual: state?.manual.sorted() ?? article.tagNames.sorted(),
          rejected: state?.rejected.sorted() ?? [], completedIdentity: state?.completedIdentity)),
    ]
  }

  static func validate(_ change: SyncChange) throws {
    guard change.schemaVersion == 1 else { throw ArticleSyncError.invalidValue }
    let data = Data(change.value.utf8)
    let decoder = JSONDecoder()
    let url: URL
    let family: String
    switch change.key.split(separator: "/").first {
    case "article":
      let value = try decoder.decode(Metadata.self, from: data)
      url = value.url
      family = "article"
      for image in [value.imageURL, value.faviconURL].compactMap({ $0 }) {
        _ = try canonicalURL(image)
      }
    case "library":
      let value = try decoder.decode(Library.self, from: data)
      url = value.url
      family = "library"
      guard
        [value.savedAt, value.lastVisitedAt].compactMap({ $0 }).allSatisfy({
          $0.timeIntervalSince1970.isFinite
        })
      else { throw ArticleSyncError.invalidValue }
    case "tags":
      let value = try decoder.decode(Tags.self, from: data)
      url = value.url
      family = "tags"
      for tags in [value.names, value.automatic, value.manual, value.rejected] {
        guard tags.count <= 256, Set(tags).count == tags.count,
          tags.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 })
        else { throw ArticleSyncError.invalidValue }
      }
    default: throw ArticleSyncError.invalidValue
    }
    guard try canonicalURL(url) == url, try change.key == family + "/" + identity(url) else {
      throw ArticleSyncError.invalidValue
    }
  }

  static func project(_ rows: [String: SyncRecord], retaining local: [SavedArticle] = []) throws
    -> [SavedArticle]
  {
    var overlays: [String: SavedArticle] = [:]
    for article in local { overlays[try identity(article.url)] = article }
    let decoder = JSONDecoder()
    var result: [SavedArticle] = []
    for (key, record) in rows where key.hasPrefix("article/") && !record.isDeleted {
      let id = String(key.dropFirst("article/".count))
      guard let membership = rows["library/" + id], !membership.isDeleted else { continue }
      let metadata = try decoder.decode(Metadata.self, from: Data(record.value.utf8))
      let library = try decoder.decode(Library.self, from: Data(membership.value.utf8))
      var article =
        overlays[id] ?? SavedArticle(id: localID(id), url: metadata.url, title: metadata.title)
      article.title = metadata.title
      article.subtitle = metadata.subtitle
      article.taggingText = metadata.taggingText
      article.imageURL =
        metadata.imageURL ?? (article.imageURL?.isFileURL == true ? article.imageURL : nil)
      article.faviconURL =
        metadata.faviconURL ?? (article.faviconURL?.isFileURL == true ? article.faviconURL : nil)
      article.isSaved = library.saved
      article.isArchived = library.archived
      article.isRead = library.read
      article.savedAt = library.savedAt
      article.lastVisitedAt = library.lastVisitedAt
      article.importBatchID = library.importBatchID
      if let record = rows["tags/" + id], !record.isDeleted {
        let tags = try decoder.decode(Tags.self, from: Data(record.value.utf8))
        var state = ArticleTaggingState(generation: tags.generation)
        state.automatic = tags.automatic
        state.manual = tags.manual
        state.rejected = tags.rejected
        state.completedIdentity = tags.completedIdentity
        state.sharedFeedbackTransferID = article.tagging?.sharedFeedbackTransferID
        article.tagging = state
        article.tags = tags.names
      } else {
        article.tagging = nil
        article.tags = []
      }
      result.append(article)
    }
    return result.sorted {
      let lhs = $0.savedAt ?? $0.lastVisitedAt ?? .distantPast
      let rhs = $1.savedAt ?? $1.lastVisitedAt ?? .distantPast
      return lhs == rhs ? $0.url.absoluteString < $1.url.absoluteString : lhs > rhs
    }
  }

  static func mutations(replacing rows: [String: SyncRecord], with articles: [SavedArticle]) throws
    -> [LocalMutation]
  {
    var previous: [String: String] = [:]
    for article in try project(rows) {
      previous.merge(try self.values(article)) { first, _ in first }
    }
    var values: [String: String] = [:]
    // Canonical duplicates collapse to the first source article deterministically.
    var seen = Set<String>()
    for article in articles where try seen.insert(identity(article.url)).inserted {
      values.merge(try self.values(article)) { first, _ in first }
    }
    // Only changed families become local edits. Partial pull pages and missing
    // sibling records must not be filled, deleted or re-uploaded by an unrelated edit.
    var mutations = values.compactMap { key, value -> LocalMutation? in
      guard previous[key] != value else { return nil }
      return LocalMutation(key: key, value: value)
    }
    for key in previous.keys where values[key] == nil {
      guard let record = rows[key], !record.isDeleted else { continue }
      mutations.append(LocalMutation(key: key, value: record.value, isDeleted: true))
    }
    return mutations.sorted { $0.key < $1.key }
  }
}

/// This journal is authoritative: domain records and the outbox are persisted
/// together before a mutation returns. The legacy JSON is only an import source.
/// The app must keep one repository per scope, and guard UI publication with its
/// account generation after every await. Network errors never discard local rows.
actor ArticleSyncRepository {
  let scope: ArticleSyncScope
  let directory: URL
  private let store: SyncStore

  private init(scope: ArticleSyncScope, directory: URL, store: SyncStore) {
    self.scope = scope
    self.directory = directory
    self.store = store
  }

  static func open(root: URL, scope: ArticleSyncScope, legacyLocalArticles: [SavedArticle]? = nil)
    async throws -> ArticleSyncRepository
  {
    if legacyLocalArticles != nil, scope != .local {
      throw ArticleSyncError.localMigrationIntoAccount
    }
    let identity = try scope.identity
    let directory = root.appending(
      path: ArticleSyncCodec.hash(identity), directoryHint: .isDirectory)
    let file = directory.appending(path: "journal.json")
    let exists = FileManager.default.fileExists(atPath: file.path)
    let store = try SyncStore(
      file: file, accountID: identity, validateValue: ArticleSyncCodec.validate)
    for record in await store.snapshot().values {
      try ArticleSyncCodec.validate(record.change)
    }
    // File existence is the migration marker. The complete source and its outbox
    // become durable in one replacement; a crash before that replacement retries.
    if !exists {
      let mutations = try ArticleSyncCodec.mutations(
        replacing: [:], with: legacyLocalArticles ?? [])
      try await store.commit(mutations)
    }
    return ArticleSyncRepository(scope: scope, directory: directory, store: store)
  }

  func snapshot(retaining local: [SavedArticle] = []) async throws -> [SavedArticle] {
    try ArticleSyncCodec.project(await store.snapshot(), retaining: local)
  }

  func transaction(
    retaining local: [SavedArticle] = [],
    _ edit: @Sendable (inout [SavedArticle]) throws -> Void
  ) async throws -> [SavedArticle] {
    let rows = try await store.update { rows in
      var articles = try ArticleSyncCodec.project(rows, retaining: local)
      try edit(&articles)
      return try ArticleSyncCodec.mutations(replacing: rows, with: articles)
    }
    return try ArticleSyncCodec.project(rows, retaining: local)
  }

  /// Explicit account import copies only missing identities. A tombstone counts
  /// as existing so this operation cannot revive a deleted article on retry.
  func importLocalArticles(_ articles: [SavedArticle]) async throws -> [SavedArticle] {
    guard scope != .local else { throw ArticleSyncError.invalidScope }
    let rows = try await store.update { rows in
      var mutations: [LocalMutation] = []
      var seen = Set<String>()
      for article in articles {
        let id = try ArticleSyncCodec.identity(article.url)
        guard rows["article/" + id] == nil, seen.insert(id).inserted else { continue }
        mutations += try ArticleSyncCodec.values(article).map {
          LocalMutation(key: $0.key, value: $0.value)
        }
      }
      return mutations
    }
    // Local profile caches and receipts must not cross into an account profile.
    return try ArticleSyncCodec.project(rows)
  }

  func sync(using remote: any SyncRemote) async throws -> [SavedArticle] {
    guard scope != .local else { throw ArticleSyncError.localProfileCannotSync }
    try await store.sync(using: remote)
    return try await snapshot()
  }

  var pendingCount: Int { get async { await store.pendingCount } }
}

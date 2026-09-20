import Foundation
import Observation
import SwiftSoup

struct SavedArticle: Identifiable, Codable {
  var id = UUID()
  let url: URL
  var title: String
  var subtitle = ""
  var imageURL: URL?
  var faviconURL: URL?
  var previewFailed = false
  var isRead: Bool?
  var isArchived: Bool?
  // Missing isSaved means a link from the original saved-only library.
  var isSaved: Bool?
  var savedAt: Date?
  var lastVisitedAt: Date?
  var tags: [String]?
  var downloadedAt: Date?
  var tagging: ArticleTaggingState?
  var sharedTransferID: UUID?
  var saved: Bool { isSaved != false }
  var tagNames: [String] { tags ?? [] }
}

/// Codable state lives in the same atomic record as the saved link and its tags.
struct ArticleTaggingState: Codable {
  var generation = UUID()
  var pendingIdentity: String?
  var completedIdentity: String?
  var automatic: [String] = []
  var manual: [String] = []
  var rejected: [String] = []
}

struct TaggingNotice: Identifiable {
  let id = UUID()
  let articleID: UUID
  let title: String
  let tags: [String]
}

/// Metadata is committed atomically. Each downloaded Reader view has a separate
/// file, so listing links never loads article bodies or embedded header images.
@MainActor @Observable final class ArticleStore {
  private(set) var articles: [SavedArticle] = []
  var errorMessage: String?
  private(set) var taggingNotice: TaggingNotice?
  private var taggingTask: Task<Void, Never>?
  private var taggingDeferred = Set<UUID>()
  private var taggingWaitingForForeground = false
  private var fixtureTaggingFailed = false
  private var fixtureTaggingContinuation: CheckedContinuation<Void, Never>?
  var isTagging: Bool { taggingTask != nil }
  var isFixtureTaggingHeld: Bool { fixtureTaggingContinuation != nil }

  /// UI tests release an in-flight response only after the edit under test.
  func finishFixtureTagging() {
    guard fixtureTagging else { return }
    let continuation = fixtureTaggingContinuation
    fixtureTaggingContinuation = nil
    continuation?.resume()
  }
  private let fileURL: URL
  private let downloads: URL

  init() {
    let directory = URL.applicationSupportDirectory.appending(
      path: "ArticleReader", directoryHint: .isDirectory)
    fileURL = directory.appending(path: TestMode.enabled ? "test-links.json" : "links.json")
    downloads = directory.appending(path: TestMode.enabled ? "TestDownloads" : "Downloads")
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-reset-store") {
        try? FileManager.default.removeItem(at: fileURL)
        try? FileManager.default.removeItem(at: downloads)
      }
      if FileManager.default.fileExists(atPath: fileURL.path) {
        articles = try JSONDecoder().decode([SavedArticle].self, from: Data(contentsOf: fileURL))
      }
      try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
      #if DEBUG
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-stage-import") {
          let fixture = Bundle.main.url(
            forResource: "Reading List", withExtension: "html", subdirectory: "Fixtures")!
          let documents = URL.documentsDirectory
          try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
          try Data(contentsOf: fixture).write(
            to: documents.appending(path: "Reading List.html"), options: .atomic)
        }
      #endif
    } catch { errorMessage = "Could not read saved links: \(error.localizedDescription)" }
  }

  func add(_ text: String) throws {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let candidate = trimmed.contains("://") ? trimmed : "https://" + trimmed
    guard let url = URL(string: candidate),
      ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
      let host = url.host, host.contains("."), !trimmed.contains(where: \.isWhitespace)
    else {
      throw ArticleError.message("Enter a complete website link, such as example.com/article.")
    }
    if let index = articles.firstIndex(where: { $0.url == url }) {
      var updated = articles
      updated[index].isSaved = true
      updated[index].isArchived = false
      updated[index].savedAt = Date()
      try commit(updated)
      scheduleTagging()
      return
    }
    var article = SavedArticle(url: url, title: host)
    article.isSaved = true
    article.savedAt = Date()
    var updated = articles
    updated.insert(article, at: 0)
    try commit(updated)
    scheduleTagging()
    Task { await refreshPreview(article) }
  }

  var allTags: [String] {
    Array(Set(articles.filter(\.saved).flatMap(\.tagNames))).sorted {
      $0.localizedStandardCompare($1) == .orderedAscending
    }
  }

  /// Unsave keeps history, tags and the cached Reader copy. Removing the link
  /// is the separate operation that deletes its stored content.
  func setSaved(_ saved: Bool, url: URL) throws {
    if saved {
      try add(url.absoluteString)
      return
    }
    guard let index = articles.firstIndex(where: { $0.url == url }) else { return }
    var updated = articles
    updated[index].isSaved = false
    updated[index].isArchived = false
    updated[index].savedAt = nil
    updated[index].sharedTransferID = nil
    updated[index].tagging?.generation = UUID()
    try commit(updated)
  }

  func archive(_ id: UUID) throws {
    guard let index = articles.firstIndex(where: { $0.id == id && $0.saved }) else { return }
    var updated = articles
    updated[index].isArchived = true
    try commit(updated)
  }

  /// Called by the visible Reader only. Speculative browsers never write history.
  func visit(_ url: URL, title: String = "") {
    guard ["http", "https"].contains(url.scheme ?? "") else { return }
    var updated = articles
    if let index = updated.firstIndex(where: { $0.url == url }) {
      updated[index].lastVisitedAt = Date()
      updated[index].isRead = true
      if !title.isEmpty { updated[index].title = title }
    } else {
      var article = SavedArticle(url: url, title: title.isEmpty ? (url.host ?? "Article") : title)
      article.isSaved = false
      article.isRead = true
      article.lastVisitedAt = Date()
      updated.insert(article, at: 0)
    }
    do {
      try commit(updated)
      if let article = updated.first(where: { $0.url == url }), article.imageURL == nil {
        Task { await refreshPreview(article) }
      }
    } catch { errorMessage = error.localizedDescription }
  }

  func setTags(_ tags: [String], for id: UUID) {
    guard let index = articles.firstIndex(where: { $0.id == id && $0.saved }) else { return }
    var updated = articles
    let chosen = Set(tags)
    var state = updated[index].tagging ?? ArticleTaggingState()
    state.rejected = Array(
      Set(state.rejected).union(Set(updated[index].tagNames).subtracting(chosen)).subtracting(
        chosen)
    ).sorted()
    state.manual = Array(chosen).sorted()
    updated[index].tagging = state
    updated[index].tags = Array(chosen).sorted()
    do { try commit(updated) } catch { errorMessage = error.localizedDescription }
  }

  func update(_ ids: Set<UUID>, read: Bool? = nil, archived: Bool? = nil, delete: Bool = false) {
    do {
      let updated = articles.compactMap { article -> SavedArticle? in
        guard ids.contains(article.id) else { return article }
        if delete { return nil }
        var result = article
        if let read { result.isRead = read }
        if let archived, result.saved { result.isArchived = archived }
        return result
      }
      try commit(updated)
    } catch { errorMessage = error.localizedDescription }
  }

  /// Save and tag completion are separate immutable extension events. Import all
  /// saves first; completion can arrive on a later foreground without reviving a
  /// link the user removed or unsaved in the meantime.
  func importSharedLinks() {
    do {
      let files = try FileManager.default.contentsOfDirectory(
        at: SharedInbox.directory(), includingPropertiesForKeys: nil)
      for file in files where file.pathExtension == "json" {
        let transfer = try SharedInbox.decodeTransfer(
          from: Data(contentsOf: file),
          fileID: UUID(uuidString: file.deletingPathExtension().lastPathComponent) ?? UUID())
        if TestMode.enabled && transfer.url.host != "fixture.example" { continue }
        var updated = articles
        let index: Int
        if let existing = updated.firstIndex(where: { $0.url == transfer.url }) {
          index = existing
        } else {
          updated.insert(
            SavedArticle(url: transfer.url, title: transfer.url.host ?? "Article"), at: 0)
          index = 0
        }
        updated[index].isSaved = true
        updated[index].isArchived = false
        updated[index].savedAt = Date()
        updated[index].sharedTransferID = transfer.id
        if let title = transfer.title, updated[index].title == transfer.url.host {
          updated[index].title = title
        }
        if let subtitle = transfer.subtitle, updated[index].subtitle.isEmpty {
          updated[index].subtitle = subtitle
        }
        try commit(updated)
        let article = updated[index]
        Task { await refreshPreview(article) }
        try FileManager.default.removeItem(at: file)
      }
      let results = try FileManager.default.contentsOfDirectory(
        at: SharedInbox.taggingResultsDirectory(), includingPropertiesForKeys: nil)
      for file in results where file.pathExtension == "json" {
        let result = try JSONDecoder().decode(
          SharedTaggingResult.self, from: Data(contentsOf: file))
        if TestMode.enabled && result.url.host != "fixture.example" { continue }
        if taggingAllowed, result.categoryVersion == ArticleTagCatalog.version,
          let index = articles.firstIndex(where: {
            $0.sharedTransferID == result.id && $0.url == result.url && $0.saved
          })
        {
          var updated = articles
          if updated[index].title == result.url.host { updated[index].title = result.title }
          if updated[index].subtitle.isEmpty { updated[index].subtitle = result.subtitle ?? "" }
          var state = updated[index].tagging ?? ArticleTaggingState()
          let identity = ArticleTagCatalog.identity(
            title: updated[index].title, description: updated[index].subtitle)
          if identity == result.inputFingerprint && state.completedIdentity != identity {
            state.pendingIdentity = identity
            updated[index].tagging = state
            try commit(updated)
            let knownTags = Set(ArticleTagCatalog.all.map(\.name))
            try applyTags(
              result.tagNames.filter { knownTags.contains($0) },
              to: updated[index].id, identity: identity, generation: state.generation)
          }
        }
        try FileManager.default.removeItem(at: file)
      }
      resumeTagging()
    } catch { errorMessage = "Could not import shared links: \(error.localizedDescription)" }
  }

  func remove(_ article: SavedArticle) {
    update([article.id], delete: true)
  }

  func downloadedFile(for url: URL) -> URL? {
    guard
      let article = articles.first(where: { $0.url == url && $0.saved && $0.downloadedAt != nil })
    else { return nil }
    let file = downloadFile(article.id)
    return FileManager.default.fileExists(atPath: file.path) ? file : nil
  }

  /// Write bytes before advertising a download. Recheck identity after the disk
  /// write so deleting a link during extraction cannot recreate that record.
  func saveReader(_ html: String, for url: URL) async {
    guard let article = articles.first(where: { $0.url == url && $0.saved }) else { return }
    let file = downloadFile(article.id)
    do {
      try await Task.detached { try Data(html.utf8).write(to: file, options: .atomic) }.value
      guard let index = articles.firstIndex(where: { $0.id == article.id }) else {
        try? FileManager.default.removeItem(at: file)
        return
      }
      var updated = articles
      updated[index].downloadedAt = Date()
      try commit(updated)
    } catch { errorMessage = "Could not store Reader view: \(error.localizedDescription)" }
  }

  private func downloadFile(_ id: UUID) -> URL { downloads.appending(path: "\(id).html") }

  /// Import the HTML reading-list export without executing it. Commit all links
  /// together, then fetch previews one at a time so large lists do not flood sites.
  func importReadingList(from url: URL) async throws -> String {
    let granted = url.startAccessingSecurityScopedResource()
    defer { if granted { url.stopAccessingSecurityScopedResource() } }
    let entries = try await Task.detached {
      let data = try Data(contentsOf: url)
      guard let html = String(data: data, encoding: .utf8) else {
        throw ArticleError.message("Choose the HTML reading-list file from your Chrome export.")
      }
      return try ReadingListImport.parse(html)
    }.value
    var updated = articles
    var added: [SavedArticle] = []
    for entry in entries {
      if let index = updated.firstIndex(where: { $0.url == entry.url }) {
        guard !updated[index].saved else { continue }
        updated[index].isSaved = true
        updated[index].savedAt = Date()
        added.append(updated[index])
      } else {
        var entry = entry
        entry.savedAt = Date()
        updated.insert(entry, at: 0)
        added.append(entry)
      }
    }
    guard !added.isEmpty else { return "All \(entries.count) links are already saved." }
    try commit(updated)
    scheduleTagging()
    Task {
      for article in added {
        guard articles.contains(where: { $0.id == article.id }) else { continue }
        await refreshPreview(article)
      }
    }
    let duplicates = entries.count - added.count
    return "Added \(added.count) \(added.count == 1 ? "link" : "links")."
      + (duplicates > 0
        ? " Skipped \(duplicates) \(duplicates == 1 ? "duplicate" : "duplicates")." : "")
  }

  func refreshPreview(_ article: SavedArticle) async {
    do {
      let preview = try await ArticlePreview.fetch(article.url)
      guard let index = articles.firstIndex(where: { $0.id == article.id }) else { return }
      var updated = articles
      updated[index].title = preview.title
      updated[index].subtitle = preview.subtitle
      updated[index].imageURL = preview.imageURL
      updated[index].faviconURL = preview.faviconURL
      updated[index].previewFailed = false
      try commit(updated)
      scheduleTagging()
      for url in [preview.imageURL, preview.faviconURL].compactMap({ $0 }) {
        await ThumbnailCache.shared.load(url)
      }
    } catch {
      guard let index = articles.firstIndex(where: { $0.id == article.id }) else { return }
      var updated = articles
      updated[index].previewFailed = true
      do {
        try commit(updated)
        scheduleTagging()
      } catch {
        errorMessage = "Could not save preview metadata: \(error.localizedDescription)"
      }
    }
  }

  /// Foreground recovery retries pending saved articles once per activation.
  /// Title/description identity also records an empty result, avoiding repeated calls.
  func resumeTagging() {
    taggingDeferred.removeAll()
    taggingWaitingForForeground = false
    scheduleTagging()
  }

  func retagSavedArticles() {
    var updated = articles
    for index in updated.indices where updated[index].saved {
      var state = updated[index].tagging ?? ArticleTaggingState()
      state.completedIdentity = nil
      state.generation = UUID()
      updated[index].tagging = state
    }
    do {
      try commit(updated)
      resumeTagging()
    } catch { errorMessage = error.localizedDescription }
  }

  func dismissTaggingNotice() { taggingNotice = nil }

  private var fixtureTagging: Bool {
    TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-tagging")
  }

  private var taggingAllowed: Bool {
    if TestMode.enabled { return fixtureTagging }
    return TaggingPreferences.enabled && !TaggingPreferences.credentialFailure
  }

  private func scheduleTagging() {
    guard taggingAllowed, !taggingWaitingForForeground, taggingTask == nil else { return }
    taggingTask = Task { [weak self] in
      guard let self else { return }
      defer { self.taggingTask = nil }
      while self.taggingAllowed, let article = self.nextTaggingArticle() {
        let credentialRevision = TestMode.enabled ? "" : TaggingPreferences.credentialRevision
        do {
          var state = article.tagging ?? ArticleTaggingState()
          let identity = ArticleTagCatalog.identity(
            title: article.title, description: article.subtitle)
          let generation = state.generation
          state.pendingIdentity = identity
          guard let index = self.articles.firstIndex(where: { $0.id == article.id }) else {
            continue
          }
          var updated = self.articles
          updated[index].tagging = state
          try self.commit(updated)
          let tags: [String]
          if self.fixtureTagging {
            // Exercise the real durable result path without keys or network in UI tests.
            if ProcessInfo.processInfo.arguments.contains("-test-tagging-held") {
              await withCheckedContinuation { self.fixtureTaggingContinuation = $0 }
            }
            if ProcessInfo.processInfo.arguments.contains("-test-tagging-delayed") {
              try await Task.sleep(for: .seconds(5))
            }
            if ProcessInfo.processInfo.arguments.contains("-test-tagging-failure")
              && !self.fixtureTaggingFailed
            {
              self.fixtureTaggingFailed = true
              throw URLError(.notConnectedToInternet)
            }
            await Task.yield()
            tags = ["Engineering", "Design & craft"]
          } else {
            guard let key = try JevKeychain.read() else {
              TaggingPreferences.lastError = "Add your Jev API key in Settings to start tagging."
              return
            }
            tags = try await JevClient.classify(
              title: article.title, description: article.subtitle, apiKey: key)
          }
          guard self.taggingAllowed else { return }
          if !TestMode.enabled && credentialRevision != TaggingPreferences.credentialRevision {
            continue
          }
          try self.applyTags(tags, to: article.id, identity: identity, generation: generation)
        } catch {
          if !TestMode.enabled && credentialRevision != TaggingPreferences.credentialRevision {
            continue
          }
          self.taggingDeferred.insert(article.id)
          self.taggingWaitingForForeground = true
          if !TestMode.enabled, case JevError.invalidKey = error {
            TaggingPreferences.credentialFailure = true
          }
          if !self.fixtureTagging { TaggingPreferences.lastError = error.localizedDescription }
          // Do not drain a library into an unavailable service. Foreground resumes it.
          return
        }
      }
    }
  }

  private func nextTaggingArticle() -> SavedArticle? {
    articles.first { article in
      guard article.saved, !taggingDeferred.contains(article.id) else { return false }
      // Wait for the preview unless it failed or an import supplied a real title.
      guard article.title != article.url.host || article.previewFailed else { return false }
      return article.tagging?.completedIdentity
        != ArticleTagCatalog.identity(
          title: article.title, description: article.subtitle)
    }
  }

  /// Merge onto the current article, not the request snapshot: manual changes
  /// during an in-flight request must win. Ignore deleted, unsaved or stale work.
  private func applyTags(_ tags: [String], to id: UUID, identity: String, generation: UUID) throws {
    guard let index = articles.firstIndex(where: { $0.id == id && $0.saved }),
      articles[index].tagging?.generation == generation,
      identity
        == ArticleTagCatalog.identity(
          title: articles[index].title, description: articles[index].subtitle)
    else { return }
    var updated = articles
    var state = updated[index].tagging ?? ArticleTaggingState()
    let existing = Set(updated[index].tagNames)
    let manual = Set(state.manual).union(existing.subtracting(state.automatic))
    let accepted = Set(tags).subtracting(state.rejected)
    let result = manual.union(accepted)
    state.automatic = Array(accepted).sorted()
    state.manual = Array(manual).sorted()
    state.completedIdentity = identity
    state.pendingIdentity = nil
    updated[index].tagging = state
    updated[index].tags = Array(result).sorted()
    try commit(updated)
    if !TestMode.enabled { TaggingPreferences.lastError = nil }
    let added = Array(result.subtracting(existing)).sorted()
    if !added.isEmpty {
      taggingNotice = TaggingNotice(articleID: id, title: updated[index].title, tags: added)
    }
  }

  private func commit(_ updated: [SavedArticle]) throws {
    try JSONEncoder().encode(updated).write(to: fileURL, options: .atomic)
    let removed = Set(articles.map(\.id)).subtracting(updated.map(\.id))
    articles = updated
    if let notice = taggingNotice,
      !updated.contains(where: { $0.id == notice.articleID && $0.saved })
    {
      taggingNotice = nil
    }
    for id in removed { try? FileManager.default.removeItem(at: downloadFile(id)) }
  }
}

enum ReadingListImport {
  static func parse(_ html: String) throws -> [SavedArticle] {
    let document = try SwiftSoup.parse(html)
    let entries = try document.select("a[href]").compactMap { anchor -> SavedArticle? in
      let href = try anchor.attr("href").trimmingCharacters(in: .whitespacesAndNewlines)
      guard let url = URL(string: href),
        ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
        let host = url.host, host.contains(".")
      else { return nil }
      let title = try anchor.text().trimmingCharacters(in: .whitespacesAndNewlines)
      return SavedArticle(url: url, title: title.isEmpty ? host : title)
    }
    guard !entries.isEmpty else {
      throw ArticleError.message(
        "No article links were found. Choose Chrome’s Reading List.html file, after unzipping the export."
      )
    }
    return entries
  }
}

enum ArticleError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    switch self {
    case .message(let text): text
    }
  }
}

struct ArticlePreview {
  let title: String
  let subtitle: String
  let imageURL: URL?
  let faviconURL: URL?

  static func fetch(_ url: URL) async throws -> Self {
    let html: String
    let baseURL: URL
    if let fixture = TestMode.fixture(for: url) {
      html = try String(contentsOf: fixture, encoding: .utf8)
      baseURL = fixture
    } else {
      var request = URLRequest(url: url, timeoutInterval: 20)
      request.setValue(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        forHTTPHeaderField: "User-Agent")
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
        let text = String(data: data, encoding: .utf8)
      else {
        throw ArticleError.message("This site did not provide a preview.")
      }
      html = text
      baseURL = response.url ?? url
    }
    let document = try SwiftSoup.parse(html)
    func meta(_ names: [String]) throws -> String {
      for name in names {
        let value =
          try document.select("meta[property='\(name)'], meta[name='\(name)']").first()?.attr(
            "content") ?? ""
        if !value.isEmpty { return value }
      }
      return ""
    }
    let headline = try meta(["og:title", "twitter:title"])
    let fallbackTitle = try document.title()
    let image = try meta(["og:image", "twitter:image"])
    let imageURL = image.isEmpty ? nil : URL(string: image, relativeTo: baseURL)?.absoluteURL
    let iconElement = try document.select("link[rel][href]").first { element in
      let roles = try element.attr("rel").lowercased().split(whereSeparator: \.isWhitespace)
      return roles.contains("icon") || roles.contains("apple-touch-icon")
    }
    let icon = try iconElement?.attr("href") ?? ""
    let favicon = icon.isEmpty ? nil : URL(string: icon, relativeTo: baseURL)?.absoluteURL
    return Self(
      title: headline.isEmpty ? (fallbackTitle.isEmpty ? url.host! : fallbackTitle) : headline,
      subtitle: try meta(["og:description", "description", "twitter:description"]),
      imageURL: imageURL.flatMap {
        ["https", "http", "file"].contains($0.scheme ?? "") ? $0 : nil
      },
      faviconURL: favicon.flatMap {
        ["https", "http", "file"].contains($0.scheme ?? "") ? $0 : nil
      }
    )
  }
}

enum TestMode {
  static var enabled: Bool {
    #if DEBUG
      ProcessInfo.processInfo.arguments.contains("-ui-testing")
    #else
      false
    #endif
  }
  static func fixture(for url: URL) -> URL? {
    guard enabled, url.host == "fixture.example" else { return nil }
    return Bundle.main.url(
      forResource: url.path == "/frame" ? "frame" : (url.path == "/next" ? "next" : "story"),
      withExtension: "html",
      subdirectory: "Fixtures")
  }
}

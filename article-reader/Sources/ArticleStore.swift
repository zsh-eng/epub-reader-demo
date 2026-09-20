import Foundation
import Observation
import SwiftSoup

struct SavedArticle: Identifiable, Codable {
  var id = UUID()
  let url: URL
  var title: String
  var subtitle = ""
  var taggingText: String?
  var taggingDescription: String { taggingText ?? subtitle }
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
  /// A shared save already acknowledged in the extension stays quiet after metadata refresh.
  var sharedFeedbackTransferID: UUID?
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
  private var fixtureTaggingContinuations: [CheckedContinuation<Void, Never>] = []
  // Preview requests are memory-only. Save reuses the same request and remains
  // the only point that can persist a link or its automatic tags.
  private struct PreparedTagging {
    let id = UUID()
    let task: Task<[String], Error>
  }
  private var preparedTagging: [String: PreparedTagging] = [:]
  private var preparedOrder: [String] = []
  private var speculativeRequests = 0
  #if DEBUG
    private(set) var taggingRequestCount = 0
    private(set) var preparedTaggingCount = 0
  #endif
  var isTagging: Bool { taggingTask != nil || speculativeRequests > 0 }
  var isFixtureTaggingHeld: Bool { !fixtureTaggingContinuations.isEmpty }

  /// UI tests release an in-flight response only after the edit under test.
  func finishFixtureTagging() {
    guard fixtureTagging else { return }
    let continuations = fixtureTaggingContinuations
    fixtureTaggingContinuations.removeAll()
    for continuation in continuations { continuation.resume() }
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
        #if DEBUG
          try TestMode.resetSharedFixtures()
        #endif
      }
      if FileManager.default.fileExists(atPath: fileURL.path) {
        articles = try JSONDecoder().decode([SavedArticle].self, from: Data(contentsOf: fileURL))
      }
      try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
      #if DEBUG
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-seed-preload-fixtures"),
          articles.isEmpty
        {
          let css = try String(
            contentsOf: Bundle.main.url(forResource: "reader", withExtension: "css")!,
            encoding: .utf8)
          for index in 0..<12 {
            let title = String(format: "Cached story %02d", index)
            var article = SavedArticle(
              url: URL(string: "https://fixture.example/cached-\(index)")!, title: title)
            article.savedAt = Date(timeIntervalSince1970: Double(12 - index))
            article.downloadedAt = Date()
            article.tags = index.isMultiple(of: 2) ? ["Even"] : ["Odd"]
            // Intentionally represents a legacy UTF-8 download without a charset.
            let html =
              "<html><head><meta name='viewport' content='width=device-width, initial-scale=1'><style>\(css)</style></head><body><main><header><h1>\(title)</h1></header><article id='reader-content'><p>“Slow down,” she said — café, naïve, 日本語. Keep every character intact.</p></article></main></body></html>"
            try Data(html.utf8).write(to: downloadFile(article.id))
            articles.append(article)
          }
          try JSONEncoder().encode(articles).write(to: fileURL, options: .atomic)
        }
      #endif
      #if DEBUG
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-reset-store"),
          ProcessInfo.processInfo.arguments.contains("-test-shared-tags")
        {
          let url = URL(string: "https://fixture.example/story")!
          let presented = ProcessInfo.processInfo.arguments.contains("-test-shared-tags-presented")
          let transfer = try SharedInbox.save(url, title: presented ? "A title from Safari" : nil)
          if presented {
            try SharedInbox.saveTaggingResult(
              SharedTaggingResult(
                id: transfer.id, url: url, title: "A title from Safari", subtitle: nil,
                tagNames: ["Learning & writing"],
                inputFingerprint: ArticleTagCatalog.identity(
                  title: "A title from Safari", description: ""),
                categoryVersion: ArticleTagCatalog.version, feedbackPresented: true))
          }
        }
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

  func add(_ text: String, preview: ArticlePreview? = nil) throws {
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
      preview?.apply(to: &updated[index])
      try commit(updated)
      scheduleTagging()
      return
    }
    var article = SavedArticle(url: url, title: host)
    preview?.apply(to: &article)
    article.isSaved = true
    article.savedAt = Date()
    var updated = articles
    updated.insert(article, at: 0)
    try commit(updated)
    scheduleTagging()
    if preview == nil { Task { await refreshPreview(article, reload: false) } }
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
        Task { await refreshPreview(article, reload: false) }
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
        if updated[index].taggingText == nil, let text = transfer.taggingText {
          updated[index].taggingText = text
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
        if let index = articles.firstIndex(where: {
          $0.sharedTransferID == result.id && $0.url == result.url && $0.saved
        }) {
          var updated = articles
          if updated[index].title == result.url.host { updated[index].title = result.title }
          if updated[index].subtitle.isEmpty { updated[index].subtitle = result.subtitle ?? "" }
          if updated[index].taggingText == nil, let text = result.taggingText {
            updated[index].taggingText = text
          }
          var state = updated[index].tagging ?? ArticleTaggingState()
          if result.feedbackPresented == true {
            state.sharedFeedbackTransferID = result.id
          }
          updated[index].tagging = state
          try commit(updated)
          let identity = ArticleTagCatalog.identity(
            title: updated[index].title, description: updated[index].taggingDescription)
          // Keep a newer main-app result, but retain the extension's receipt even
          // when Safari and the fetched page supplied different metadata.
          if taggingAllowed, result.categoryVersion == ArticleTagCatalog.version,
            state.completedIdentity != identity
          {
            let knownTags = Set(ArticleTagCatalog.all.map(\.name))
            try mergeTags(
              result.tagNames.filter { knownTags.contains($0) }, at: index,
              identity: result.inputFingerprint)
          }
          if result.feedbackPresented == true,
            taggingNotice?.articleID == updated[index].id
          {
            taggingNotice = nil
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
        await refreshPreview(article, reload: false)
      }
    }
    let duplicates = entries.count - added.count
    return "Added \(added.count) \(added.count == 1 ? "link" : "links")."
      + (duplicates > 0
        ? " Skipped \(duplicates) \(duplicates == 1 ? "duplicate" : "duplicates")." : "")
  }

  func refreshPreview(_ article: SavedArticle, reload: Bool = true) async {
    do {
      let preview = try await ArticlePreviewCache.shared.load(article.url, reload: reload)
      guard let index = articles.firstIndex(where: { $0.id == article.id }) else { return }
      var updated = articles
      preview.apply(to: &updated[index])
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
    preparedTagging.removeAll()
    preparedOrder.removeAll()
    var updated = articles
    for index in updated.indices where updated[index].saved {
      var state = updated[index].tagging ?? ArticleTaggingState()
      state.completedIdentity = nil
      state.sharedFeedbackTransferID = nil
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

  /// Start once metadata is ready, before Save. Dismissal can discard the UI
  /// without writing a link; an eventual Save can still reuse this bounded work.
  func prepareTagging(url: URL, preview: ArticlePreview) {
    guard taggingAllowed, !articles.contains(where: { $0.url == url && $0.saved }) else { return }
    let revision = TestMode.enabled ? "" : TaggingPreferences.credentialRevision
    speculativeRequests += 1
    Task { [weak self] in
      guard let self else { return }
      defer { self.speculativeRequests -= 1 }
      do {
        _ = try await self.requestTags(
          title: preview.title, description: preview.taggingText, credentialRevision: revision)
      } catch {
        guard self.taggingAllowed,
          TestMode.enabled || revision == TaggingPreferences.credentialRevision
        else { return }
        if !TestMode.enabled, case JevError.invalidKey = error {
          TaggingPreferences.credentialFailure = true
        }
        if !TestMode.enabled { TaggingPreferences.lastError = error.localizedDescription }
      }
    }
  }

  private func requestTags(title: String, description: String, credentialRevision: String)
    async throws -> [String]
  {
    let identity = ArticleTagCatalog.identity(title: title, description: description)
    let key = credentialRevision + ":" + identity
    if let entry = preparedTagging[key] { return try await entry.task.value }
    let task = Task<[String], Error> {
      guard self.taggingAllowed,
        TestMode.enabled || credentialRevision == TaggingPreferences.credentialRevision
      else { throw CancellationError() }
      #if DEBUG
        self.taggingRequestCount += 1
      #endif
      if self.fixtureTagging {
        // Exercise the same shared request and durable result path without a key.
        if ProcessInfo.processInfo.arguments.contains("-test-tagging-held") {
          await withCheckedContinuation { self.fixtureTaggingContinuations.append($0) }
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
        return ["Engineering", "Design & craft"]
      }
      guard let apiKey = try JevKeychain.read() else {
        throw ArticleError.message("Add your Jev API key in Settings to start tagging.")
      }
      return try await JevClient.classify(title: title, description: description, apiKey: apiKey)
    }
    let entry = PreparedTagging(task: task)
    preparedTagging[key] = entry
    preparedOrder.append(key)
    if preparedOrder.count > 8 { preparedTagging[preparedOrder.removeFirst()] = nil }
    do {
      let tags = try await task.value
      guard taggingAllowed,
        TestMode.enabled || credentialRevision == TaggingPreferences.credentialRevision
      else {
        throw CancellationError()
      }
      #if DEBUG
        preparedTaggingCount += 1
      #endif
      return tags
    } catch {
      if preparedTagging[key]?.id == entry.id {
        preparedTagging[key] = nil
        preparedOrder.removeAll { $0 == key }
      }
      throw error
    }
  }

  private func scheduleTagging() {
    guard taggingAllowed, !taggingWaitingForForeground, taggingTask == nil else { return }
    taggingTask = Task { [weak self] in
      guard let self else { return }
      defer { self.taggingTask = nil }
      while self.taggingAllowed, var article = self.nextTaggingArticle() {
        let credentialRevision = TestMode.enabled ? "" : TaggingPreferences.credentialRevision
        do {
          // Even an imported title is not enough context. A Save that beats the
          // preview joins its fetch before submitting anything to Jev.
          if article.taggingText == nil {
            let preview = try await ArticlePreviewCache.shared.load(article.url)
            guard let index = self.articles.firstIndex(where: { $0.id == article.id && $0.saved })
            else { continue }
            var updated = self.articles
            preview.apply(to: &updated[index])
            try self.commit(updated)
            article = updated[index]
          }
          guard self.taggingAllowed else { return }
          if !TestMode.enabled && credentialRevision != TaggingPreferences.credentialRevision {
            continue
          }
          var state = article.tagging ?? ArticleTaggingState()
          let identity = ArticleTagCatalog.identity(
            title: article.title, description: article.taggingDescription)
          let generation = state.generation
          state.pendingIdentity = identity
          guard let index = self.articles.firstIndex(where: { $0.id == article.id }) else {
            continue
          }
          var updated = self.articles
          updated[index].tagging = state
          try self.commit(updated)
          let tags = try await self.requestTags(
            title: article.title, description: article.taggingDescription,
            credentialRevision: credentialRevision)
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
      return article.tagging?.completedIdentity
        != ArticleTagCatalog.identity(
          title: article.title, description: article.taggingDescription)
    }
  }

  /// Merge onto the current article, not the request snapshot: manual changes
  /// during an in-flight request must win. Ignore deleted, unsaved or stale work.
  private func applyTags(_ tags: [String], to id: UUID, identity: String, generation: UUID) throws {
    guard let index = articles.firstIndex(where: { $0.id == id && $0.saved }),
      articles[index].tagging?.generation == generation,
      identity
        == ArticleTagCatalog.identity(
          title: articles[index].title, description: articles[index].taggingDescription)
    else { return }
    try mergeTags(tags, at: index, identity: identity)
  }

  /// Shared results can use an earlier metadata identity. Retain that identity so
  /// the queue can improve the tags, while the durable receipt prevents a repeat prompt.
  private func mergeTags(_ tags: [String], at index: Int, identity: String) throws {
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
    let presentedInExtension =
      updated[index].sharedTransferID != nil
      && state.sharedFeedbackTransferID == updated[index].sharedTransferID
    if !added.isEmpty && !presentedInExtension {
      taggingNotice = TaggingNotice(
        articleID: updated[index].id, title: updated[index].title, tags: added)
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

/// Paste, save and speculative loading share one metadata request. The cache is
/// small and process-local; saved metadata and image bytes remain durable.
actor ArticlePreviewCache {
  static let shared = ArticlePreviewCache()
  private var previews: [URL: ArticlePreview] = [:]
  private var pending: [URL: Task<ArticlePreview, Error>] = [:]

  func load(_ url: URL, reload: Bool = false) async throws -> ArticlePreview {
    if let task = pending[url] { return try await task.value }
    if !reload, let preview = previews[url] { return preview }
    let task = Task { try await ArticlePreview.fetch(url) }
    pending[url] = task
    defer { pending[url] = nil }
    let preview = try await task.value
    if previews.count >= 32, let first = previews.keys.first { previews[first] = nil }
    previews[url] = preview
    return preview
  }
}

struct ArticlePreview: Sendable {
  let title: String
  let subtitle: String
  let taggingText: String
  let imageURL: URL?
  let faviconURL: URL?

  func apply(to article: inout SavedArticle) {
    article.title = title
    article.subtitle = subtitle
    article.taggingText = taggingText
    article.imageURL = imageURL
    article.faviconURL = faviconURL
    article.previewFailed = false
  }

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
    let metadata = try ArticleMetadata.parse(html, baseURL: baseURL)
    return Self(
      title: metadata.title, subtitle: metadata.description, taggingText: metadata.taggingText,
      imageURL: metadata.imageURL, faviconURL: metadata.faviconURL)
  }
}

enum TestMode {
  #if DEBUG
    /// Failed share tests must not leave a saved fixture for the next test. Never
    /// remove real shared links or results from the simulator's App Group.
    static func resetSharedFixtures() throws {
      for directory in [try SharedInbox.directory(), try SharedInbox.taggingResultsDirectory()] {
        let files = try FileManager.default.contentsOfDirectory(
          at: directory, includingPropertiesForKeys: nil)
        for file in files where file.pathExtension == "json" {
          let data = try Data(contentsOf: file)
          let transfer = try? SharedInbox.decodeTransfer(from: data)
          let result = try? JSONDecoder().decode(SharedTaggingResult.self, from: data)
          if (transfer?.url ?? result?.url)?.host == "fixture.example" {
            try FileManager.default.removeItem(at: file)
          }
        }
      }
    }
  #endif
  static var enabled: Bool {
    #if DEBUG
      ProcessInfo.processInfo.arguments.contains("-ui-testing")
    #else
      false
    #endif
  }
  static func fixture(for url: URL) -> URL? {
    guard enabled, url.host == "fixture.example" else { return nil }
    let name = url.lastPathComponent
    return Bundle.main.url(
      forResource: ["frame", "next", "short", "long", "unicode"].contains(name) ? name : "story",
      withExtension: "html",
      subdirectory: "Fixtures")
  }
}

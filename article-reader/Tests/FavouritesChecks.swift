import ArcticSync
import Foundation
import Testing

@testable import ArticleSyncBridge

private func favouriteArticle(
  _ slug: String, archived: Bool = false, favourite: Bool = false, saved: Bool = true
) -> SavedArticle {
  var value = SavedArticle(url: URL(string: "https://example.com/\(slug)")!, title: slug)
  value.isArchived = archived
  value.isFavourite = favourite
  value.isSaved = saved
  value.tags = ["Craft"]
  return value
}

@Test func favouriteFlagSurvivesLocalJSONAndLegacyRecords() throws {
  let file = FileManager.default.temporaryDirectory.appending(path: "favourites-\(UUID()).json")
  defer { try? FileManager.default.removeItem(at: file) }
  var original = favouriteArticle("kept", archived: true, favourite: true)
  try JSONEncoder().encode([original]).write(to: file, options: .atomic)
  let restored = try JSONDecoder().decode([SavedArticle].self, from: Data(contentsOf: file))
  #expect(restored[0].favourite && restored[0].saved && restored[0].isArchived == true)
  #expect(restored[0].tagNames == ["Craft"])
  original.isFavourite = nil
  let legacy = try JSONEncoder().encode(original)
  #expect(!String(decoding: legacy, as: UTF8.self).contains("isFavourite"))
  #expect(try !JSONDecoder().decode(SavedArticle.self, from: legacy).favourite)
  original.isFavourite = false
  #expect(
    try !JSONDecoder().decode(SavedArticle.self, from: JSONEncoder().encode(original)).favourite)
}

@MainActor @Test func favouriteFiltersIncludeArchivedAndCacheSeparately() {
  let active = favouriteArticle("active")
  let kept = favouriteArticle("kept", favourite: true)
  let archived = favouriteArticle("archived", archived: true, favourite: true)
  let ordinaryArchive = favouriteArticle("ordinary-archive", archived: true)
  let history = favouriteArticle("history", favourite: true, saved: false)
  let values = [active, kept, archived, ordinaryArchive, history]
  let projection = LibraryProjection()
  func slugs(_ folder: ArticleFolder, favouritesOnly: Bool = false, query: String = "") -> Set<
    String
  > {
    Set(
      projection.rows(
        articles: values, revision: 1, folder: folder, query: query, sort: "Title",
        favouritesOnly: favouritesOnly
      ).articles.map(\.title))
  }
  #expect(slugs(.favourites) == ["kept", "archived"])
  #expect(slugs(.tag("Craft")) == ["active", "kept"])
  #expect(slugs(.tag("Craft"), favouritesOnly: true) == ["kept", "archived"])
  #expect(
    slugs(.tag("Craft")) == ["active", "kept"], "The cached normal filter must stay unchanged")
  #expect(slugs(.tag("Craft"), favouritesOnly: true, query: "archived") == ["archived"])
  #expect(slugs(.tag("Other"), favouritesOnly: true).isEmpty)
  #expect(slugs(.saved) == ["active", "kept"])
  #expect(slugs(.archive) == ["archived", "ordinary-archive"])
  var changed = values
  changed[2].isFavourite = false
  let refreshed = projection.rows(
    articles: changed, revision: 2, folder: .favourites, query: "", sort: "Title")
  #expect(refreshed.articles.map(\.title) == ["kept"])
}

@Test func favouritePersistsInDormantLibraryFamilyWithoutTagChanges() async throws {
  let directory = FileManager.default.temporaryDirectory.appending(path: "favourite-sync-\(UUID())")
  defer { try? FileManager.default.removeItem(at: directory) }
  let original = favouriteArticle("kept", archived: true)
  let repository = try await ArticleSyncRepository.open(
    root: directory, scope: .local, legacyLocalArticles: [original])
  let originalValues = try ArticleSyncCodec.values(original)
  let changed = try await repository.transaction { $0[0].isFavourite = true }
  let changedValues = try ArticleSyncCodec.values(changed[0])
  for key in originalValues.keys {
    #expect((originalValues[key] != changedValues[key]) == key.hasPrefix("library/"))
  }
  let reopened = try await ArticleSyncRepository.open(root: directory, scope: .local)
  let restored = try await reopened.snapshot()[0]
  #expect(restored.favourite && restored.isArchived == true)
  #expect(restored.tagNames == original.tagNames)
  _ = try await reopened.transaction { $0[0].isFavourite = false }
  #expect(try await !reopened.snapshot()[0].favourite)

  let key = originalValues.keys.first { $0.hasPrefix("library/") }!
  var legacy =
    try JSONSerialization.jsonObject(with: Data(originalValues[key]!.utf8)) as! [String: Any]
  legacy.removeValue(forKey: "favourite")
  let membership = try JSONDecoder().decode(
    ArticleSyncCodec.Library.self, from: JSONSerialization.data(withJSONObject: legacy))
  #expect(membership.favourite == nil && membership.archived)
}

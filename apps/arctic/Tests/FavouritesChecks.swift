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

import Foundation
import Testing

@testable import ArcticSync

@Test func domainAndPrivateValuesAreOneDurableTransaction() async throws {
  let file = FileManager.default.temporaryDirectory.appending(path: "arctic-journal-\(UUID()).json")
  defer { try? FileManager.default.removeItem(at: file) }
  let store = try SyncStore(file: file, accountID: "alice")
  _ = try await store.transaction { journal in
    JournalMutation(
      mutations: [LocalMutation(key: "library/one", value: "saved")],
      localValues: ["receipt": "presented"])
  }
  let restored = try SyncStore(file: file, accountID: "alice")
  let journal = await restored.snapshotState()
  #expect(journal.rows.count == 1)
  #expect(journal.localValues == ["receipt": "presented"])
  #expect(await restored.pendingCount == 1)
}

@Test func failedJournalTransactionPublishesNeitherDomainNorPrivateValues() async throws {
  let store = try SyncStore(file: URL(filePath: "/dev/null/journal.json"), accountID: "alice")
  await #expect(throws: (any Error).self) {
    try await store.transaction { _ in
      JournalMutation(
        mutations: [LocalMutation(key: "library/one", value: "saved")],
        localValues: ["receipt": "presented"])
    }
  }
  let snapshot = await store.snapshotState()
  #expect(snapshot.rows.isEmpty)
  #expect(snapshot.localValues.isEmpty)
  #expect(await store.pendingCount == 0)
}

@Test func unchangedJournalDoesNotRewriteFile() async throws {
  let file = FileManager.default.temporaryDirectory.appending(path: "arctic-noop-\(UUID()).json")
  defer { try? FileManager.default.removeItem(at: file) }
  let store = try SyncStore(file: file, accountID: "alice")
  // The first empty commit is still the durable marker for completed migration.
  try await store.commit([])
  #expect(FileManager.default.fileExists(atPath: file.path))
  _ = try await store.transaction { _ in
    JournalMutation(
      mutations: [LocalMutation(key: "library/one", value: "saved")], localValues: [:])
  }
  let oldDate = Date(timeIntervalSince1970: 1_600_000_000)
  try FileManager.default.setAttributes([.modificationDate: oldDate], ofItemAtPath: file.path)
  _ = try await store.transaction { journal in
    JournalMutation(
      mutations: [LocalMutation(key: "library/one", value: "saved")],
      localValues: journal.localValues)
  }
  let date = try FileManager.default.attributesOfItem(atPath: file.path)[.modificationDate] as? Date
  #expect(date == oldDate)
}

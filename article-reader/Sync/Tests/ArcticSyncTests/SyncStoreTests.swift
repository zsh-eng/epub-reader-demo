import Foundation
import Testing

@testable import ArcticSync

private func location() -> URL {
  FileManager.default.temporaryDirectory.appending(path: "arctic-sync-\(UUID()).json")
}
private func mutation(_ value: String, key: String = "article/one", deleted: Bool = false)
  -> LocalMutation
{
  .init(key: key, value: value, isDeleted: deleted)
}
private actor Remote: SyncRemote {
  var records: [String: SyncRecord] = [:]
  var sequence: Int64 = 0
  var beforePush: (@Sendable () async throws -> Void)?
  var failPush = false
  var badPage = false
  var badWinner = false
  func configure(
    hook: (@Sendable () async throws -> Void)? = nil, fail: Bool = false, badPage: Bool = false,
    badWinner: Bool = false
  ) {
    beforePush = hook
    failPush = fail
    self.badPage = badPage
    self.badWinner = badWinner
  }
  func pull(deviceID: String, cursor: Int64, head: Int64?) async throws -> SyncPull {
    if badPage { return .init(records: [], cursor: cursor + 1, head: cursor, hasMore: false) }
    let end = head ?? sequence
    let rows = records.values.filter { $0.serverSeq > cursor && $0.serverSeq <= end }.sorted {
      $0.serverSeq < $1.serverSeq
    }
    let page = Array(rows.prefix(2))
    let more = rows.count > page.count
    return .init(records: page, cursor: more ? page.last!.serverSeq : end, head: end, hasMore: more)
  }
  func push(deviceID: String, changes: [SyncChange]) async throws -> SyncPush {
    try await beforePush?()
    if failPush { throw SyncFailure.httpStatus(503) }
    return .init(
      results: changes.map { change in
        if let old = records[change.key],
          old.hlc > change.hlc || (old.hlc == change.hlc && old.deviceId >= deviceID)
        {
          return .init(accepted: false, winner: old)
        }
        sequence += 1
        var winner = SyncRecord(change: change, deviceId: deviceID, serverSeq: sequence)
        if badWinner { winner.key = "unexpected" }
        records[change.key] = winner
        return .init(accepted: true, winner: winner)
      })
  }
}

@Test func durableOfflineEditsAndAccountIsolation() async throws {
  let file = location()
  defer { try? FileManager.default.removeItem(at: file) }
  let first = try SyncStore(file: file, accountID: "alice", deviceID: "phone")
  try await first.commit([mutation("local")])
  let restored = try SyncStore(file: file, accountID: "alice")
  #expect(await restored.pendingCount == 1)
  #expect(await restored.snapshot()["article/one"]?.value == "local")
  #expect(throws: SyncFailure.wrongAccount) { try SyncStore(file: file, accountID: "bob") }
}
@Test func twoDevicesConvergeAndKeepDeletion() async throws {
  let remote = Remote()
  let aFile = location()
  let bFile = location()
  defer {
    try? FileManager.default.removeItem(at: aFile)
    try? FileManager.default.removeItem(at: bFile)
  }
  let a = try SyncStore(file: aFile, accountID: "alice", deviceID: "a")
  let b = try SyncStore(file: bFile, accountID: "alice", deviceID: "b")
  try await a.commit(
    (0..<5).map { mutation("first", key: "article/\($0)") }, now: Date(timeIntervalSince1970: 100))
  try await a.sync(using: remote)
  try await b.sync(using: remote)
  #expect(await b.snapshot().count == 5)
  try await b.commit(
    [mutation("first", key: "article/0", deleted: true)], now: Date(timeIntervalSince1970: 101))
  try await b.sync(using: remote)
  try await a.sync(using: remote)
  #expect(await a.snapshot()["article/0"]?.isDeleted == true)
  #expect(await a.pendingCount == 0)
}
@Test func editDuringUploadStaysQueued() async throws {
  let file = location()
  defer { try? FileManager.default.removeItem(at: file) }
  let store = try SyncStore(file: file, accountID: "alice", deviceID: "a")
  let remote = Remote()
  try await store.commit([mutation("first")], now: Date(timeIntervalSince1970: 100))
  await remote.configure(hook: {
    try await store.commit(
      [mutation("edited while uploading")], now: Date(timeIntervalSince1970: 101))
  })
  try await store.sync(using: remote)
  #expect(await store.snapshot()["article/one"]?.value == "edited while uploading")
  #expect(await store.pendingCount == 1)
  await remote.configure()
  try await store.sync(using: remote)
  #expect(await store.pendingCount == 0)
  #expect(await remote.records["article/one"]?.value == "edited while uploading")
}
@Test func failedUploadRetainsOutboxAcrossRestart() async throws {
  let file = location()
  defer { try? FileManager.default.removeItem(at: file) }
  let store = try SyncStore(file: file, accountID: "alice")
  let remote = Remote()
  try await store.commit([mutation("queued")])
  await remote.configure(fail: true)
  await #expect(throws: SyncFailure.httpStatus(503)) { try await store.sync(using: remote) }
  let restored = try SyncStore(file: file, accountID: "alice")
  #expect(await restored.pendingCount == 1)
}
@Test func malformedResponseDoesNotAdvanceCursorOrDropEdits() async throws {
  let file = location()
  defer { try? FileManager.default.removeItem(at: file) }
  let store = try SyncStore(file: file, accountID: "alice")
  let remote = Remote()
  try await store.commit([mutation("queued")])
  await remote.configure(badPage: true)
  await #expect(throws: SyncFailure.invalidResponse) { try await store.sync(using: remote) }
  #expect(await store.cursor == 0)
  await remote.configure(badWinner: true)
  await #expect(throws: SyncFailure.invalidResponse) { try await store.sync(using: remote) }
  #expect(await store.pendingCount == 1)
}
@Test func failedDiskWriteDoesNotPublishMutation() async throws {
  let store = try SyncStore(file: URL(filePath: "/dev/null/arctic.json"), accountID: "alice")
  await #expect(throws: (any Error).self) { try await store.commit([mutation("not committed")]) }
  #expect(await store.snapshot().isEmpty)
  #expect(await store.pendingCount == 0)
}
@Test func clockRollbackStillCreatesNewerVersion() async throws {
  let file = location()
  defer { try? FileManager.default.removeItem(at: file) }
  let store = try SyncStore(file: file, accountID: "alice")
  try await store.commit([mutation("first")], now: Date(timeIntervalSince1970: 100))
  let first = await store.snapshot()["article/one"]!.hlc
  try await store.commit([mutation("second")], now: Date(timeIntervalSince1970: 90))
  #expect(await store.snapshot()["article/one"]!.hlc > first)
}
@Test func filesHaveStableSHA256IdentityAndHTTPIsRejected() throws {
  #expect(
    HTTPRemote.fileID(Data())
      == "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  let identity = ArcticSession(
    accountID: "alice", email: "a@example.com", server: URL(string: "http://example.com")!,
    cookie: "secret")
  #expect(throws: SyncFailure.invalidServer) { try HTTPRemote(identity: identity) }
}

@Test func unsupportedDomainRecordDoesNotCommitPullCursor() async throws {
  let remote = Remote()
  let sourceFile = location()
  let targetFile = location()
  defer {
    try? FileManager.default.removeItem(at: sourceFile)
    try? FileManager.default.removeItem(at: targetFile)
  }
  let source = try SyncStore(file: sourceFile, accountID: "alice")
  try await source.commit([mutation("future schema")])
  try await source.sync(using: remote)
  let target = try SyncStore(
    file: targetFile, accountID: "alice", validateValue: { _ in throw SyncFailure.invalidRecord })
  await #expect(throws: SyncFailure.invalidRecord) { try await target.sync(using: remote) }
  #expect(await target.cursor == 0)
  #expect(await target.snapshot().isEmpty)
}

@Test func simultaneousOfflineEditsResolveByDeviceAndStayResolvedAfterRestart() async throws {
  let aFile = location()
  let bFile = location()
  let remote = Remote()
  defer {
    try? FileManager.default.removeItem(at: aFile)
    try? FileManager.default.removeItem(at: bFile)
  }
  let a = try SyncStore(file: aFile, accountID: "alice", deviceID: "a")
  let b = try SyncStore(file: bFile, accountID: "alice", deviceID: "b")
  let sameTime = Date(timeIntervalSince1970: 100)
  try await a.commit([mutation("from a")], now: sameTime)
  try await b.commit([mutation("from b")], now: sameTime)
  try await a.sync(using: remote)
  try await b.sync(using: remote)
  let restarted = try SyncStore(file: aFile, accountID: "alice")
  try await restarted.sync(using: remote)
  #expect(await restarted.snapshot()["article/one"]?.value == "from b")
  #expect(await restarted.pendingCount == 0)
}

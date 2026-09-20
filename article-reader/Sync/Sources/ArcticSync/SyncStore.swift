import Foundation

public struct LocalMutation: Sendable {
  public let key: String
  public let value: String
  public let isDeleted: Bool
  public let schemaVersion: Int
  public init(key: String, value: String, isDeleted: Bool = false, schemaVersion: Int = 1) {
    self.key = key
    self.value = value
    self.isDeleted = isDeleted
    self.schemaVersion = schemaVersion
  }
}

/// One actor owns each account's durable rows, versions, outbox and cursor.
/// Domain updates and their upload intent are one atomic file replacement.
/// Callers must keep one store instance per file and keep account files separate.
public actor SyncStore {
  struct State: Codable {
    var accountID: String
    var deviceID: String
    var clock = SyncClock(wallTimeMs: 0)
    var cursor: Int64 = 0
    var rows: [String: SyncRecord] = [:]
    var pending: [String: SyncChange] = [:]
  }
  private let file: URL
  private var state: State
  private var syncing = false
  private let validateValue: @Sendable (SyncChange) throws -> Void
  public init(
    file: URL, accountID: String, deviceID: String = UUID().uuidString,
    validateValue: @escaping @Sendable (SyncChange) throws -> Void = { _ in }
  ) throws {
    self.validateValue = validateValue
    self.file = file
    if FileManager.default.fileExists(atPath: file.path) {
      state = try JSONDecoder().decode(State.self, from: Data(contentsOf: file))
      guard state.accountID == accountID else { throw SyncFailure.wrongAccount }
    } else {
      state = State(accountID: accountID, deviceID: deviceID)
    }
  }
  public func snapshot() -> [String: SyncRecord] { state.rows }
  public var pendingCount: Int { state.pending.count }
  public var cursor: Int64 { state.cursor }

  /// Import batches produce one file write. A failed write publishes no in-memory change.
  public func commit(_ mutations: [LocalMutation], now: Date = Date()) throws {
    var next = state
    let millis = Int64(now.timeIntervalSince1970 * 1000)
    for mutation in mutations {
      let old = next.rows[mutation.key]
      if old?.value == mutation.value && old?.isDeleted == mutation.isDeleted
        && old?.schemaVersion == mutation.schemaVersion
      {
        continue
      }
      next.clock =
        millis > next.clock.wallTimeMs
        ? SyncClock(wallTimeMs: millis)
        : SyncClock(wallTimeMs: next.clock.wallTimeMs, counter: next.clock.counter + 1)
      let change = SyncChange(
        key: mutation.key, value: mutation.value, isDeleted: mutation.isDeleted,
        schemaVersion: mutation.schemaVersion, hlc: next.clock)
      try validate(change)
      try validateValue(change)
      next.rows[change.key] = SyncRecord(change: change, deviceId: next.deviceID, serverSeq: 0)
      next.pending[change.key] = change
    }
    try persist(next)
  }

  /// Pull first, then send a fixed outbox snapshot. New edits during network awaits
  /// remain pending. The caller schedules another pass for those later edits.
  public func sync(using remote: any SyncRemote) async throws {
    guard !syncing else { throw SyncFailure.alreadySyncing }
    syncing = true
    defer { syncing = false }
    var head: Int64?
    while true {
      try Task.checkCancellation()
      let requestedCursor = state.cursor
      let page = try await remote.pull(
        deviceID: state.deviceID, cursor: requestedCursor, head: head)
      try Task.checkCancellation()
      guard page.records.count <= 500, page.cursor >= requestedCursor, page.head >= page.cursor,
        head == nil || page.head == head,
        page.hasMore
          ? (page.cursor > requestedCursor && page.records.last?.serverSeq == page.cursor)
          : page.cursor == page.head
      else { throw SyncFailure.invalidResponse }
      var previous = requestedCursor
      for record in page.records {
        try validate(record.change)
        try validateValue(record.change)
        guard record.serverSeq > previous, record.serverSeq <= page.head, !record.deviceId.isEmpty
        else { throw SyncFailure.invalidResponse }
        previous = record.serverSeq
      }
      var next = state
      for record in page.records { merge(record, into: &next) }
      next.cursor = page.cursor
      try persist(next)
      if !page.hasMore { break }
      head = page.head
    }
    let pending = state.pending.values.sorted { $0.key < $1.key }
    for batch in try batches(pending) {
      try Task.checkCancellation()
      let response = try await remote.push(deviceID: state.deviceID, changes: batch)
      try Task.checkCancellation()
      guard response.results.count == batch.count else { throw SyncFailure.invalidResponse }
      var seen = Set<String>()
      let submitted = Dictionary(uniqueKeysWithValues: batch.map { ($0.key, $0) })
      for result in response.results {
        try validate(result.winner.change)
        try validateValue(result.winner.change)
        guard let sent = submitted[result.winner.key], seen.insert(result.winner.key).inserted,
          result.winner.serverSeq > 0, !result.winner.deviceId.isEmpty,
          !result.accepted
            || (result.winner.change == sent && result.winner.deviceId == state.deviceID),
          result.winner.hlc > sent.hlc
            || (result.winner.hlc == sent.hlc && result.winner.deviceId >= state.deviceID),
          result.winner.hlc != sent.hlc || result.winner.deviceId != state.deviceID
            || result.winner.change == sent
        else { throw SyncFailure.invalidResponse }
      }
      var next = state
      for result in response.results {
        let key = result.winner.key
        if next.pending[key] == submitted[key] { next.pending.removeValue(forKey: key) }
        merge(result.winner, into: &next)
      }
      try persist(next)
    }
  }

  private func merge(_ record: SyncRecord, into next: inout State) {
    next.clock = max(next.clock, record.hlc)
    if let local = next.rows[record.key] {
      if local.hlc > record.hlc || (local.hlc == record.hlc && local.deviceId > record.deviceId) {
        return
      }
    }
    next.rows[record.key] = record
    if let pending = next.pending[record.key],
      pending.hlc < record.hlc || (pending.hlc == record.hlc && next.deviceID <= record.deviceId)
    {
      next.pending.removeValue(forKey: record.key)
    }
  }
  private func persist(_ next: State) throws {
    let data = try JSONEncoder().encode(next)
    try FileManager.default.createDirectory(
      at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: file, options: .atomic)
    state = next
  }
  private func batches(_ pending: [SyncChange]) throws -> [[SyncChange]] {
    var result: [[SyncChange]] = []
    var batch: [SyncChange] = []
    var size = 14  // {"changes":[]} plus one-byte safety margin
    for change in pending {
      let bytes = try JSONEncoder().encode(change).count + 1
      if batch.count == 500 || size + bytes > 1_048_576 {
        result.append(batch)
        batch = []
        size = 14
      }
      batch.append(change)
      size += bytes
    }
    if !batch.isEmpty { result.append(batch) }
    return result
  }
}

import Foundation

/// Bounds downloads and image decoding across hosts. When a row leaves the
/// viewport, its cancelled waiter leaves the queue instead of delaying new rows.
actor PreviewImageWorkLimit {
  private let limit: Int
  private var active = 0
  private var queue: [(UUID, CheckedContinuation<Bool, Never>, Bool)] = []

  init(limit: Int = 3) { self.limit = limit }
  var queuedRequestCount: Int { queue.count }

  func acquire(prefetch: Bool = false) async -> Bool {
    guard !Task.isCancelled else { return false }
    if active < limit {
      active += 1
      return true
    }
    let id = UUID()
    return await withTaskCancellationHandler {
      await withCheckedContinuation { continuation in
        if Task.isCancelled {
          continuation.resume(returning: false)
        } else {
          let position = prefetch ? queue.endIndex : (queue.firstIndex { $0.2 } ?? queue.endIndex)
          queue.insert((id, continuation, prefetch), at: position)
        }
      }
    } onCancel: {
      Task { await self.cancel(id) }
    }
  }

  func release() {
    guard !queue.isEmpty else {
      active -= 1
      return
    }
    queue.removeFirst().1.resume(returning: true)
  }

  private func cancel(_ id: UUID) {
    guard let index = queue.firstIndex(where: { $0.0 == id }) else { return }
    queue.remove(at: index).1.resume(returning: false)
  }
}

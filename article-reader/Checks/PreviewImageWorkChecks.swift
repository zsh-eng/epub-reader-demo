import Foundation

actor WorkCounter {
  var active = 0
  var peak = 0
  var completed = 0
  func begin() {
    active += 1
    peak = max(peak, active)
  }
  func end() {
    active -= 1
    completed += 1
  }
}

actor WorkOrder {
  var values: [String] = []
  func append(_ value: String) { values.append(value) }
}

@main struct PreviewImageWorkChecks {
  static func main() async {
    let scheduler = PreviewImageWorkLimit(limit: 3)
    let counter = WorkCounter()
    await withTaskGroup(of: Void.self) { group in
      for _ in 0..<80 {
        group.addTask {
          guard await scheduler.acquire() else { return }
          await counter.begin()
          try? await Task.sleep(for: .milliseconds(2))
          await counter.end()
          await scheduler.release()
        }
      }
    }
    let peak = await counter.peak
    let completed = await counter.completed
    precondition(peak <= 3 && completed == 80)

    // Cancellation while saturated must finish without requiring a slot.
    for _ in 0..<3 {
      let granted = await scheduler.acquire()
      precondition(granted)
    }
    let cancelled = Task { await scheduler.acquire() }
    await waitForQueue(scheduler, count: 1)
    cancelled.cancel()
    let admitted = await cancelled.value
    precondition(!admitted)
    await scheduler.release()
    let replacement = await scheduler.acquire()
    precondition(replacement)
    for _ in 0..<3 { await scheduler.release() }
    // Block a single slot so both priority classes are definitely queued.
    // The visible requests must pass older speculative work, retaining FIFO.
    let priorityScheduler = PreviewImageWorkLimit(limit: 1)
    let held = await priorityScheduler.acquire()
    precondition(held)
    let order = WorkOrder()
    let prefetch = Task {
      guard await priorityScheduler.acquire(prefetch: true) else { return }
      await order.append("prefetch")
      await priorityScheduler.release()
    }
    await waitForQueue(priorityScheduler, count: 1)
    let firstVisible = Task {
      guard await priorityScheduler.acquire() else { return }
      await order.append("visible 1")
      await priorityScheduler.release()
    }
    await waitForQueue(priorityScheduler, count: 2)
    let secondVisible = Task {
      guard await priorityScheduler.acquire() else { return }
      await order.append("visible 2")
      await priorityScheduler.release()
    }
    await waitForQueue(priorityScheduler, count: 3)
    let obsoletePrefetch = Task { await priorityScheduler.acquire(prefetch: true) }
    await waitForQueue(priorityScheduler, count: 4)
    obsoletePrefetch.cancel()
    let obsoleteAdmitted = await obsoletePrefetch.value
    precondition(!obsoleteAdmitted)
    await waitForQueue(priorityScheduler, count: 3)
    await priorityScheduler.release()
    await firstVisible.value
    await secondVisible.value
    await prefetch.value
    let result = await order.values
    precondition(result == ["visible 1", "visible 2", "prefetch"])
    print(
      "Image work checks passed: 80 jobs, peak \(peak), queued cancellation, visible FIFO before prefetch."
    )
  }

  private static func waitForQueue(_ scheduler: PreviewImageWorkLimit, count: Int) async {
    let deadline = Date().addingTimeInterval(5)
    while await scheduler.queuedRequestCount != count {
      precondition(Date() < deadline, "Scheduler did not reach expected queue state")
      await Task.yield()
    }
  }

}

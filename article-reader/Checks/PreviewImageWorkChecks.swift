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
    for _ in 0..<10 { await Task.yield() }
    cancelled.cancel()
    let admitted = await cancelled.value
    precondition(!admitted)
    await scheduler.release()
    let replacement = await scheduler.acquire()
    precondition(replacement)
    for _ in 0..<3 { await scheduler.release() }
    print("Image work checks passed: 80 jobs, peak \(peak), cancelled queue entry released.")
  }
}

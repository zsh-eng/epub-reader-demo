import QuartzCore
import SwiftUI
import UIKit

/// Optional display-link sampling. This reports callback cadence, not rendered
/// frames. Put this view in the library overlay; it owns all sampling and updates.
struct LibraryFrameDiagnostics: View {
  static let enabledKey = "library-frame-diagnostics-enabled"
  @AppStorage(Self.enabledKey) private var enabled = false
  @Environment(\.scenePhase) private var scenePhase
  @StateObject private var monitor = LibraryFrameMonitor()

  var body: some View {
    Group {
      if enabled {
        VStack(alignment: .leading, spacing: 3) {
          Text(monitor.snapshot.callbacksPerSecond, format: .number.precision(.fractionLength(0)))
            .font(.system(.headline, design: .monospaced))
            + Text(" callback FPS").font(.caption)
          Text(
            "≈\(monitor.snapshot.missedSlots) missed slots · \(Int(monitor.snapshot.worstGap * 1000)) ms max gap"
          )
          .font(.system(.caption2, design: .monospaced))
          Text("Recent 2 s · requests up to \(monitor.snapshot.maximumRate) Hz")
            .font(.caption2).foregroundStyle(.secondary)
        }
        .padding(10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay {
          RoundedRectangle(cornerRadius: 12).strokeBorder(.primary.opacity(0.12), lineWidth: 0.5)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("library-frame-diagnostics")
        .accessibilityHint(
          "Estimates main-thread callback timing. Does not measure rendered frames."
        )
        .background {
          DisplayScreenReader { monitor.setMaximumRate($0) }
            .frame(width: 0, height: 0)
        }
        .allowsHitTesting(false)
      }
    }
    .onAppear { updateSampling() }
    .onChange(of: enabled) { _, _ in updateSampling() }
    .onChange(of: scenePhase) { _, _ in updateSampling() }
    .onDisappear { monitor.stop() }
  }

  private func updateSampling() {
    if enabled && scenePhase == .active { monitor.start() } else { monitor.stop() }
  }
}

/// Per-frame counters are ordinary fields. Only the local diagnostic snapshot
/// is published, at most twice a second. The ring never grows beyond 512 entries.
@MainActor
private final class LibraryFrameMonitor: ObservableObject {
  struct Snapshot {
    var callbacksPerSecond = 0.0
    var missedSlots = 0
    var worstGap = 0.0
    var maximumRate = 60
  }

  private struct Sample {
    var time = 0.0
    var gap = 0.0
    var missedSlots = 0
  }

  @Published private(set) var snapshot = Snapshot()
  private var link: CADisplayLink?
  private var target: DisplayLinkTarget?
  private var samples = [Sample](repeating: Sample(), count: 512)
  private var head = 0
  private var count = 0
  private var started = 0.0
  private var lastPublication = 0.0
  private var previousCallback = 0.0
  private var previousTarget = 0.0
  private var previousInterval = 0.0
  private let window = 2.0
  private var maximumRate = 60

  func setMaximumRate(_ maximum: Int) {
    maximumRate = max(1, maximum)
    link?.preferredFrameRateRange = requestedRate
  }

  private var requestedRate: CAFrameRateRange {
    CAFrameRateRange(
      minimum: Float(min(80, maximumRate)), maximum: Float(maximumRate),
      preferred: Float(maximumRate))
  }

  func start() {
    guard link == nil else { return }
    head = 0
    count = 0
    started = 0
    lastPublication = 0
    previousCallback = 0
    previousTarget = 0
    previousInterval = 0
    snapshot = Snapshot()
    let target = DisplayLinkTarget(owner: self)
    let link = CADisplayLink(target: target, selector: #selector(DisplayLinkTarget.tick(_:)))
    self.target = target
    self.link = link
    // Diagnostic mode requests the attached display's upper range. iOS still
    // controls actual cadence; this is never a rendered-frame guarantee.
    link.preferredFrameRateRange = requestedRate
    // Common mode keeps callbacks active during a scroll gesture.
    link.add(to: .main, forMode: .common)
  }

  func stop() {
    link?.invalidate()
    link = nil
    target = nil
  }

  deinit { link?.invalidate() }

  fileprivate func sample(_ displayLink: CADisplayLink) {
    let now = CACurrentMediaTime()
    // Apple documents targetTimestamp - timestamp as the current interval;
    // duration alone describes the display maximum, not its variable cadence.
    let interval = displayLink.targetTimestamp - displayLink.timestamp
    guard interval > 0 else { return }
    defer {
      previousCallback = now
      previousTarget = displayLink.targetTimestamp
      previousInterval = interval
    }
    guard previousCallback > 0 else {
      started = now
      lastPublication = now
      return
    }

    let gap = now - previousCallback
    // Count skipped expected callback slots, allowing a cadence change before
    // calling it a miss. These are estimates, never compositor frame counts.
    let expectedInterval = max(previousInterval, interval)
    let skippedTime = min(window, max(0, displayLink.timestamp - previousTarget))
    let missed =
      Int((skippedTime / expectedInterval).rounded())
      + (now > displayLink.targetTimestamp ? 1 : 0)
    if count == samples.count {
      head = (head + 1) % samples.count
      count -= 1
    }
    samples[(head + count) % samples.count] = Sample(time: now, gap: gap, missedSlots: missed)
    count += 1
    while count > 0 && samples[head].time < now - window {
      head = (head + 1) % samples.count
      count -= 1
    }
    guard now - lastPublication >= 0.5 else { return }
    lastPublication = now
    var missedSlots = 0
    var worstGap = 0.0
    for offset in 0..<count {
      let sample = samples[(head + offset) % samples.count]
      missedSlots += sample.missedSlots
      worstGap = max(worstGap, sample.gap)
    }
    snapshot = Snapshot(
      callbacksPerSecond: Double(count) / min(window, now - started),
      missedSlots: missedSlots, worstGap: worstGap, maximumRate: maximumRate)
  }
}

/// CADisplayLink retains its target. This weak bridge permits teardown even if a
/// parent removes the overlay before SwiftUI delivers its disappearance callback.
@MainActor
private final class DisplayLinkTarget: NSObject {
  private weak var owner: LibraryFrameMonitor?
  init(owner: LibraryFrameMonitor) { self.owner = owner }
  @objc func tick(_ displayLink: CADisplayLink) { owner?.sample(displayLink) }
}

/// Resolve the actual window's screen instead of assuming UIScreen.main. The
/// diagnostic can move to another display without retaining a global window.
private struct DisplayScreenReader: UIViewRepresentable {
  var onMaximumRate: (Int) -> Void

  func makeUIView(context: Context) -> DisplayScreenView {
    let view = DisplayScreenView()
    view.onMaximumRate = onMaximumRate
    return view
  }

  func updateUIView(_ view: DisplayScreenView, context: Context) {
    view.onMaximumRate = onMaximumRate
    view.reportScreen()
  }
}

private final class DisplayScreenView: UIView {
  var onMaximumRate: ((Int) -> Void)?
  private var lastRate = 0

  override func didMoveToWindow() {
    super.didMoveToWindow()
    reportScreen()
  }

  func reportScreen() {
    guard let maximum = window?.windowScene?.screen.maximumFramesPerSecond,
      maximum != lastRate
    else { return }
    lastRate = maximum
    onMaximumRate?(maximum)
  }
}

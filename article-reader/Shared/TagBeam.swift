import SwiftUI

private struct ArticleMotionOverride: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// The OS preference always wins. The additional value permits deterministic
  /// native UI tests without changing the simulator's global accessibility state.
  var articleReduceMotion: Bool {
    get { accessibilityReduceMotion || self[ArticleMotionOverride.self] }
    set { self[ArticleMotionOverride.self] = newValue }
  }
}

/// Restore the original continuous gradient. Its soft border fades into matching
/// pill outlines before their labels appear; no geometry or racing line segments.
struct ConnectedTagReveal<Content: View>: View {
  var isProcessing: Bool
  var tags: [String]
  var replayID = 0
  var cornerRadius: CGFloat = 24
  var onRevealed: () -> Void = {}
  @ViewBuilder var content: () -> Content
  @Environment(\.articleReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase
  @State private var started = Date()
  @State private var completion: Date?
  @State private var settled = false
  @State private var acknowledged: Result?

  var body: some View {
    TimelineView(
      .animation(
        minimumInterval: 1.0 / 60, paused: settled || reduceMotion || scenePhase != .active)
    ) { timeline in
      let elapsed = completion.map { timeline.date.timeIntervalSince($0) } ?? -1
      let phase =
        timeline.date.timeIntervalSince(started).truncatingRemainder(dividingBy: 2.4) / 2.4
      let progress = TagRevealProgress(
        elapsed: elapsed, phase: phase,
        immediate: reduceMotion || settled || scenePhase != .active)
      content()
        .environment(\.tagRevealProgress, progress)
        .overlay {
          if !settled, scenePhase == .active {
            let gradient = tagBeamGradient(phase: reduceMotion ? 0.2 : phase)
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
              .strokeBorder(gradient, lineWidth: 2)
              .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                  .strokeBorder(gradient, lineWidth: 4).blur(radius: 5)
              }
              .opacity(reduceMotion || elapsed < 0 ? 1 : max(0, 1 - elapsed / 0.65))
              .allowsHitTesting(false).accessibilityHidden(true)
          }
        }
    }
    .task(
      id: Run(
        tags: tags, processing: isProcessing, replay: replayID, reduced: reduceMotion,
        active: scenePhase == .active)
    ) {
      // The view can display results immediately while inactive, but a receipt
      // is issued only after the foreground reveal has actually finished.
      guard scenePhase == .active else { return }
      let result = Result(tags: tags, replay: replayID)
      if !isProcessing, acknowledged == result {
        settled = true
        return
      }
      if isProcessing {
        acknowledged = nil
        started = Date()
        completion = nil
        settled = false
        return
      }
      guard !tags.isEmpty else {
        settled = true
        return
      }
      if reduceMotion {
        settled = true
        acknowledged = result
        onRevealed()
        return
      }
      settled = false
      completion = Date()
      do {
        let lastArrival = TagRevealProgress.arrival(for: tags.count - 1)
        try await Task.sleep(for: .seconds(lastArrival + 0.32))
        acknowledged = result
        onRevealed()
        try await Task.sleep(for: .milliseconds(500))
        settled = true
      } catch {
        // Dismissal, backgrounding, or replay cancels acknowledgement.
      }
    }
  }

  private struct Result: Equatable {
    var tags: [String]
    var replay: Int
  }

  private struct Run: Hashable {
    var tags: [String]
    var processing: Bool
    var replay: Int
    var reduced: Bool
    var active: Bool
  }
}

/// Keep the same stops and glow as the original Arctic border beam.
private func tagBeamGradient(phase: Double) -> AngularGradient {
  AngularGradient(
    stops: [
      .init(color: .clear, location: 0),
      .init(color: .clear, location: 0.65),
      .init(color: .primary.opacity(0.12), location: 0.76),
      .init(color: ArcticBrand.accent.opacity(0.8), location: 0.9),
      .init(color: .primary, location: 0.97),
      .init(color: .clear, location: 1),
    ], center: .center, angle: .degrees(phase * 360))
}

private struct TagRevealProgress {
  var elapsed: Double = -1
  var phase = 0.0
  var immediate = true
  static func arrival(for index: Int) -> Double { 0.2 + Double(index) * 0.1 }

  func shellOpacity(for index: Int) -> Double {
    immediate ? 1 : ramp(elapsed - Self.arrival(for: index), duration: 0.12)
  }

  func labelOpacity(for index: Int) -> Double {
    immediate ? 1 : ramp(elapsed - Self.arrival(for: index) - 0.12, duration: 0.2)
  }

  func glow(for index: Int) -> Double {
    guard !immediate, elapsed >= Self.arrival(for: index) else { return 0 }
    return max(0, 1 - (elapsed - Self.arrival(for: index)) / 0.8)
  }

  private func ramp(_ elapsed: Double, duration: Double) -> Double {
    UnitCurve.easeOut.value(at: min(1, max(0, elapsed / duration)))
  }
}

private struct TagRevealProgressKey: EnvironmentKey {
  static let defaultValue = TagRevealProgress()
}
extension EnvironmentValues {
  fileprivate var tagRevealProgress: TagRevealProgress {
    get { self[TagRevealProgressKey.self] }
    set { self[TagRevealProgressKey.self] = newValue }
  }
}

/// The pill's matching gradient appears before its label and settles to a normal tag.
struct TagRevealPill: View {
  var name: String
  var index: Int
  var compact = false
  @Environment(\.tagRevealProgress) private var progress

  var body: some View {
    let labelOpacity = progress.labelOpacity(for: index)
    let glow = progress.glow(for: index)
    Text(name)
      .font(compact ? .system(size: 10, weight: .medium) : .subheadline.weight(.medium))
      .opacity(labelOpacity)
      .padding(.horizontal, compact ? 9 : 12).padding(.vertical, compact ? 6 : 8)
      .background(Color(uiColor: .tertiarySystemBackground), in: Capsule())
      .overlay {
        Capsule().strokeBorder(tagBeamGradient(phase: progress.phase), lineWidth: 1.5)
          .background {
            Capsule().strokeBorder(ArcticBrand.accent.opacity(0.3), lineWidth: 3)
              .blur(radius: 3)
          }
          .opacity(glow)
      }
      .opacity(progress.shellOpacity(for: index))
      .accessibilityHidden(labelOpacity < 1)
  }
}

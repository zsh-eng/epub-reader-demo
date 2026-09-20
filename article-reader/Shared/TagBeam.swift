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

/// One clock owns the card's travelling light, its handoff, and the tag reveals.
/// Anchors keep the light connected to pills even when text wraps onto another row.
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
  @State private var completionPhase = 0.0
  @State private var settled = false
  @State private var acknowledged: Result?

  var body: some View {
    TimelineView(
      .animation(
        minimumInterval: 1.0 / 30, paused: settled || reduceMotion || scenePhase != .active)
    ) { timeline in
      let elapsed = completion.map { timeline.date.timeIntervalSince($0) } ?? -1
      let progress = TagRevealProgress(elapsed: elapsed, immediate: reduceMotion || settled)
      content()
        .environment(\.tagRevealProgress, progress)
        .overlayPreferenceValue(TagRevealAnchors.self) { anchors in
          GeometryReader { geometry in
            let frames = anchors.mapValues { geometry[$0] }
            Canvas { context, size in
              guard !settled, !reduceMotion else { return }
              drawLight(
                in: &context, size: size, frames: frames, now: timeline.date, elapsed: elapsed)
            }
          }.allowsHitTesting(false).accessibilityHidden(true)
        }
    }
    .task(
      id: Run(
        tags: tags, processing: isProcessing, replay: replayID, reduced: reduceMotion,
        active: scenePhase == .active)
    ) {
      // A completion receipt means the result was visible. Backgrounding cancels
      // the reveal; returning active restarts it before acknowledging the tags.
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
      let now = Date()
      completionPhase = now.timeIntervalSince(started).truncatingRemainder(dividingBy: 2.4) / 2.4
      completion = now
      do {
        let lastArrival = TagRevealProgress.arrival(for: tags.count - 1)
        try await Task.sleep(for: .seconds(lastArrival + 0.18))
        acknowledged = result
        onRevealed()
        try await Task.sleep(for: .milliseconds(650))
        settled = true
      } catch {
        // Dismissal or replay cancels the receipt as well as the visual sequence.
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

  private func drawLight(
    in context: inout GraphicsContext, size: CGSize, frames: [Int: CGRect], now: Date,
    elapsed: Double
  ) {
    let rect = CGRect(origin: .zero, size: size).insetBy(dx: 1, dy: 1)
    let radius = min(cornerRadius, min(rect.width, rect.height) / 2)
    let border = borderPath(in: rect, radius: radius)
    if elapsed < 0.24 {
      let phase =
        elapsed < 0
        ? now.timeIntervalSince(started).truncatingRemainder(dividingBy: 2.4) / 2.4
        : completionPhase + (1 - completionPhase)
          * UnitCurve.easeOut.value(at: min(1, elapsed / 0.24))
      var glow = context
      glow.addFilter(.shadow(color: ArcticBrand.accent.opacity(0.45), radius: 4))
      for piece in 0..<16 {
        let end = (phase - Double(piece) * 0.006 + 1).truncatingRemainder(dividingBy: 1)
        let start = max(0, end - 0.008)
        glow.stroke(
          border.trimmedPath(from: start, to: end),
          with: .color(ArcticBrand.accent.opacity(1 - Double(piece) / 16)),
          style: StrokeStyle(lineWidth: 2, lineCap: .round))
      }
    }
    guard elapsed >= 0.24 else { return }
    for index in frames.keys.sorted() {
      guard let target = frames[index] else { continue }
      let arrival = TagRevealProgress.arrival(for: index)
      let departure = index == 0 ? 0.24 : arrival - 0.12
      let travel = min(1, max(0, (elapsed - departure) / (arrival - departure)))
      let fade = max(0, 1 - max(0, elapsed - arrival) / 0.22)
      guard travel > 0, fade > 0 else { continue }
      let origin: CGPoint
      let destination: CGPoint
      if let previous = frames[index - 1] {
        let sameRow = abs(previous.midY - target.midY) < 4
        origin =
          sameRow
          ? CGPoint(x: previous.maxX, y: previous.midY)
          : CGPoint(x: previous.midX, y: previous.maxY)
        destination =
          sameRow
          ? CGPoint(x: target.minX, y: target.midY) : CGPoint(x: target.midX, y: target.minY)
      } else {
        origin = CGPoint(x: rect.minX, y: rect.maxY - radius)
        destination = CGPoint(x: target.minX, y: target.midY)
      }
      var connection = Path()
      connection.move(to: origin)
      connection.addQuadCurve(to: destination, control: CGPoint(x: origin.x, y: destination.y))
      let visible = connection.trimmedPath(from: max(0, travel - 0.65), to: travel)
      var glow = context
      glow.addFilter(.shadow(color: ArcticBrand.accent.opacity(fade * 0.5), radius: 4))
      glow.stroke(
        visible, with: .color(ArcticBrand.accent.opacity(fade)),
        style: StrokeStyle(lineWidth: 2, lineCap: .round))
    }
  }

  /// Start/end at the lower left, beside the tag row, for a continuous handoff.
  private func borderPath(in rect: CGRect, radius: CGFloat) -> Path {
    Path { path in
      path.move(to: CGPoint(x: rect.minX, y: rect.maxY - radius))
      path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
      path.addQuadCurve(
        to: CGPoint(x: rect.minX + radius, y: rect.minY),
        control: CGPoint(x: rect.minX, y: rect.minY))
      path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
      path.addQuadCurve(
        to: CGPoint(x: rect.maxX, y: rect.minY + radius),
        control: CGPoint(x: rect.maxX, y: rect.minY))
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
      path.addQuadCurve(
        to: CGPoint(x: rect.maxX - radius, y: rect.maxY),
        control: CGPoint(x: rect.maxX, y: rect.maxY))
      path.addLine(to: CGPoint(x: rect.minX + radius, y: rect.maxY))
      path.addQuadCurve(
        to: CGPoint(x: rect.minX, y: rect.maxY - radius),
        control: CGPoint(x: rect.minX, y: rect.maxY))
    }
  }
}

private struct TagRevealProgress {
  var elapsed: Double = -1
  var immediate = true
  static func arrival(for index: Int) -> Double { 0.44 + Double(index) * 0.12 }
  func opacity(for index: Int) -> Double {
    if immediate { return 1 }
    return UnitCurve.easeOut.value(at: min(1, max(0, (elapsed - Self.arrival(for: index)) / 0.18)))
  }
  func glow(for index: Int) -> Double {
    guard !immediate, elapsed >= Self.arrival(for: index) else { return 0 }
    return max(0, 1 - (elapsed - Self.arrival(for: index)) / 0.65)
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
private struct TagRevealAnchors: PreferenceKey {
  static var defaultValue: [Int: Anchor<CGRect>] { [:] }
  static func reduce(value: inout [Int: Anchor<CGRect>], nextValue: () -> [Int: Anchor<CGRect>]) {
    value.merge(nextValue(), uniquingKeysWith: { _, new in new })
  }
}

/// A result pill receives light from the container before its label appears.
struct TagRevealPill: View {
  var name: String
  var index: Int
  var compact = false
  @Environment(\.tagRevealProgress) private var progress

  var body: some View {
    let opacity = progress.opacity(for: index)
    let glow = progress.glow(for: index)
    Text(name)
      .font(compact ? .system(size: 10, weight: .medium) : .subheadline.weight(.medium))
      .padding(.horizontal, compact ? 9 : 12).padding(.vertical, compact ? 6 : 8)
      .background(Color(uiColor: .tertiarySystemBackground), in: Capsule())
      .overlay {
        Capsule().strokeBorder(ArcticBrand.accent.opacity(glow), lineWidth: 1.5)
          .shadow(color: ArcticBrand.accent.opacity(glow * 0.4), radius: 4)
      }
      .anchorPreference(key: TagRevealAnchors.self, value: .bounds) { [index: $0] }
      .opacity(opacity)
      .scaleEffect(0.97 + 0.03 * opacity)
      .accessibilityHidden(opacity < 1)
  }
}

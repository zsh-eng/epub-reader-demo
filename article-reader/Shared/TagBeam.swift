import SwiftUI

/// A moving highlight follows the border only while a tagging state is active.
/// Uses the current tint and native label colour; Reduce Motion keeps a static edge.
private struct TagBeam: ViewModifier {
  let active: Bool
  let cornerRadius: CGFloat
  @Environment(\.articleReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase

  func body(content: Content) -> some View {
    content.overlay {
      if active {
        TimelineView(
          .animation(minimumInterval: 1.0 / 30, paused: reduceMotion || scenePhase != .active)
        ) { context in
          let phase =
            reduceMotion
            ? 0.2
            : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.4) / 2.4
          let gradient = AngularGradient(
            stops: [
              .init(color: .clear, location: 0),
              .init(color: .clear, location: 0.65),
              .init(color: .primary.opacity(0.12), location: 0.76),
              .init(color: .accentColor.opacity(0.8), location: 0.9),
              .init(color: .primary, location: 0.97),
              .init(color: .clear, location: 1),
            ], center: .center, angle: .degrees(phase * 360))
          RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .strokeBorder(gradient, lineWidth: 2)
            .background {
              RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(gradient, lineWidth: 4).blur(radius: 5)
            }
        }
        .allowsHitTesting(false).accessibilityHidden(true)
      }
    }
  }
}

extension View {
  func tagBeam(active: Bool, cornerRadius: CGFloat = 24) -> some View {
    modifier(TagBeam(active: active, cornerRadius: cornerRadius))
  }
}

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

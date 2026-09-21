import SwiftUI

/// These small, native scenes are demonstrations, not interactive app controls.
/// Tasks stop when the page disappears. Replay starts a fresh, finite sequence.
struct ShareOnboardingIllustration: View {
  @Environment(\.articleReduceMotion) private var reduceMotion
  @State private var step = 0
  @State private var replay = 0
  @State private var pointer = DemoPointerModel()
  @State private var targets: [String: CGRect] = [:]

  var body: some View {
    VStack(spacing: 8) {
      ZStack(alignment: .bottom) {
        safari
        if step == 1 {
          shareSheet
            .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
        }
        if step >= 2 {
          saveSheet
            .transition(.opacity)
        }
      }
      .frame(height: 400)
      .coordinateSpace(name: "share-demo")
      .overlay { DemoPointer(model: pointer) }
      .background(Color(uiColor: .systemGroupedBackground))
      .clipShape(RoundedRectangle(cornerRadius: 28))
      .overlay {
        RoundedRectangle(cornerRadius: 28)
          .strokeBorder(ReaderTheme.border.opacity(0.3), lineWidth: 0.5)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityIdentifier("onboarding-share-demo")
      .accessibilityValue(["safari", "share", "link", "save", "saved"][step])
      .accessibilityLabel(
        "Glacial Longings by Elizabeth Rush. In Safari, tap Share. Choose Arctic in the app row, then tap Save. If Arctic is missing, choose More to add it."
      )
      IllustrationReplay(id: "share") { replay += 1 }
    }
    .task(id: replay) { await demonstrate() }
  }

  private var safari: some View {
    VStack(spacing: 0) {
      HStack {
        Image(systemName: "text.page")
        Spacer()
        Label(OnboardingArticle.domain, systemImage: "lock.fill").font(.system(size: 11))
        Spacer()
        Image(systemName: "arrow.clockwise")
      }
      .font(.system(size: 12))
      .padding(12)
      .background(.thinMaterial, in: Capsule())
      .padding(12)
      VStack(alignment: .leading, spacing: 10) {
        Text(OnboardingArticle.publisher.uppercased())
          .font(.system(size: 11, weight: .medium, design: .serif))
          .tracking(1.6)
          .frame(maxWidth: .infinity)
          .padding(.bottom, 4)
        OnboardingArticleImage(height: 155)
          .clipShape(RoundedRectangle(cornerRadius: 4))
        Text(OnboardingArticle.title)
          .font(.system(size: 32, weight: .medium, design: .serif))
          .tracking(-0.8)
          .fixedSize(horizontal: false, vertical: true)
        Text("by " + OnboardingArticle.author)
          .font(.system(size: 12)).foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 18)
      Spacer(minLength: 12)
      HStack {
        Image(systemName: "chevron.left")
        Spacer()
        Image(systemName: "chevron.right").opacity(0.3)
        Spacer()
        Image(systemName: "square.and.arrow.up")
          .foregroundStyle(ArcticBrand.accent)
          .demoTarget("share", in: "share-demo", positions: $targets)
        Spacer()
        Image(systemName: "book")
        Spacer()
        Image(systemName: "square.on.square")
      }
      .font(.system(size: 18))
      .padding(.horizontal, 24).padding(.vertical, 17)
      .background(.regularMaterial)
    }
    .background(ReaderTheme.background)
    .dynamicTypeSize(.medium)
  }

  private var shareSheet: some View {
    VStack(spacing: 18) {
      Capsule().fill(.secondary.opacity(0.35)).frame(width: 32, height: 4)
      HStack(spacing: 10) {
        Image("OnboardingArticle")
          .resizable().scaledToFill()
          .frame(width: 42, height: 42)
          .clipShape(RoundedRectangle(cornerRadius: 10))
        VStack(alignment: .leading, spacing: 3) {
          Text(OnboardingArticle.title).font(.system(size: 13, weight: .semibold))
            .lineLimit(1)
          Text(OnboardingArticle.domain).font(.system(size: 11)).foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
          .frame(width: 25, height: 25).background(ReaderTheme.secondary, in: Circle())
      }
      HStack(alignment: .top, spacing: 0) {
        shareApp("AirDrop", symbol: "airplay.audio")
        VStack(spacing: 7) {
          ArcticMark().frame(width: 48, height: 48)
            .demoTarget("arctic", in: "share-demo", positions: $targets)
          Text("Arctic").font(.system(size: 10))
        }
        .frame(maxWidth: .infinity)
        shareApp("Mail", symbol: "envelope.fill")
        shareApp("More", symbol: "ellipsis")
      }
      .frame(maxWidth: .infinity)
      HStack {
        Text("Copy").font(.system(size: 14))
        Spacer()
        Image(systemName: "document.on.document").font(.system(size: 16))
      }
      .padding(13)
      .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 12))
    }
    .padding(16)
    .background(
      .regularMaterial, in: UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24)
    )
    .dynamicTypeSize(.medium)
  }

  private func shareApp(_ title: String, symbol: String) -> some View {
    VStack(spacing: 7) {
      Image(systemName: symbol)
        .font(.system(size: 24))
        .foregroundStyle(title == "More" ? ReaderTheme.foreground : ArcticBrand.accent)
        .frame(width: 48, height: 48)
        .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 12))
      Text(title).font(.system(size: 10))
    }
    .frame(maxWidth: .infinity)
  }

  private var saveSheet: some View {
    VStack(spacing: 14) {
      HStack(spacing: 7) {
        ArcticMark().frame(width: 22, height: 22)
        Text("Arctic").font(.system(size: 13, weight: .semibold))
        Spacer()
        if step == 4 {
          Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold))
            .foregroundStyle(ArcticBrand.accent)
        }
      }
      if step == 2 {
        HStack(spacing: 12) {
          Image(systemName: "link")
            .font(.system(size: 20)).foregroundStyle(.secondary)
          Text(OnboardingArticle.link)
            .font(.system(size: 13))
            .lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
          ProgressView().controlSize(.small)
        }
        .padding(16)
        .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 18))
        .transition(.opacity)
      } else {
        DemoArticleCard(showTags: false, reservesTags: false, imageHeight: 95)
          .transition(.opacity.combined(with: .offset(y: 8)))
      }
      HStack(spacing: 10) {
        Text("Cancel")
          .frame(maxWidth: .infinity, minHeight: 42)
          .background(ReaderTheme.secondary, in: Capsule())
        Text(step == 4 ? "Done" : "Save")
          .frame(maxWidth: .infinity, minHeight: 42)
          .foregroundStyle(ArcticBrand.onAccent)
          .background(ArcticBrand.accent, in: Capsule())
          .demoTarget("save", in: "share-demo", positions: $targets)
      }
      .font(.system(size: 14, weight: .semibold))
    }
    .padding(18)
    .frame(maxWidth: .infinity)
    .background(
      ReaderTheme.background,
      in: UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24)
    )
    .dynamicTypeSize(.medium)
  }

  @MainActor private func demonstrate() async {
    pointer.reset()
    step = reduceMotion ? 4 : 0
    guard !reduceMotion else { return }
    do {
      try await Task.sleep(for: .milliseconds(1100))
      try await pointer.tap(targets["share"])
      withAnimation(.spring(response: 0.3, dampingFraction: 1)) { step = 1 }
      try await Task.sleep(for: .milliseconds(450))
      try await pointer.tap(targets["arctic"])
      withAnimation(.easeOut(duration: 0.24)) { step = 2 }
      // The real extension starts with a URL while its preview is fetched.
      try await Task.sleep(for: .milliseconds(1100))
      withAnimation(.spring(response: 0.4, dampingFraction: 1)) { step = 3 }
      try await Task.sleep(for: .milliseconds(500))
      try await pointer.tap(targets["save"])
      withAnimation(.easeOut(duration: 0.2)) { step = 4 }
      pointer.hide()
    } catch {
      // Leaving or replaying the page cancels the demonstration.
    }
  }

}

struct PasteOnboardingIllustration: View {
  @Environment(\.articleReduceMotion) private var reduceMotion
  @State private var step = 0
  @State private var replay = 0
  @State private var pointer = DemoPointerModel()
  @State private var targets: [String: CGRect] = [:]

  var body: some View {
    VStack(spacing: 8) {
      VStack(spacing: 0) {
        HStack {
          Image(systemName: "chevron.left")
            .font(.system(size: 15, weight: .semibold))
            .frame(width: 34, height: 34)
            .readerGlass()
          Spacer()
          Text(step == 0 ? "Arctic" : "Paste from Other Apps")
            .font(.system(size: 15, weight: .semibold))
          Spacer()
          Color.clear.frame(width: 34, height: 34)
        }
        .padding(16)
        ZStack(alignment: .top) {
          if step == 0 {
            appSettings.transition(.opacity)
          } else {
            pasteSettings.transition(.opacity)
          }
        }
        .padding(.horizontal, 16)
        Spacer(minLength: 0)
      }
      .frame(height: 330)
      .coordinateSpace(name: "paste-demo")
      .overlay { DemoPointer(model: pointer) }
      .background(Color(uiColor: .systemGroupedBackground))
      .clipShape(RoundedRectangle(cornerRadius: 28))
      .overlay {
        RoundedRectangle(cornerRadius: 28)
          .strokeBorder(ReaderTheme.border.opacity(0.3), lineWidth: 0.5)
      }
      .dynamicTypeSize(.medium)
      .accessibilityElement(children: .ignore)
      .accessibilityIdentifier("onboarding-paste-demo")
      .accessibilityValue(step == 2 ? "allowed" : "ask")
      .accessibilityLabel(
        "In Settings, open Apps, Arctic, then Paste from Other Apps. Choose Allow.")
      IllustrationReplay(id: "paste") { replay += 1 }
    }
    .task(id: replay) { await demonstrate() }
  }

  private var appSettings: some View {
    VStack(spacing: 18) {
      HStack(spacing: 12) {
        ArcticMark().frame(width: 44, height: 44)
        Text("Arctic").font(.system(size: 22, weight: .semibold))
        Spacer()
      }
      .padding(16)
      .background(
        Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
      HStack {
        Text("Paste from Other Apps")
        Spacer(minLength: 4)
        Text("Ask").foregroundStyle(.secondary)
        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
          .foregroundStyle(.tertiary)
      }
      .font(.system(size: 14))
      .padding(16)
      .background(
        Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16)
      )
      .demoTarget("paste", in: "paste-demo", positions: $targets)
    }
  }

  private var pasteSettings: some View {
    VStack(spacing: 0) {
      ForEach(["Ask", "Deny", "Allow"], id: \.self) { option in
        HStack {
          Text(option)
          Spacer()
          if option == (step >= 2 ? "Allow" : "Ask") {
            Image(systemName: "checkmark")
              .font(.system(size: 16, weight: .semibold))
              .foregroundStyle(Color(uiColor: .systemBlue))
          }
        }
        .font(.system(size: 16))
        .padding(.horizontal, 16)
        .frame(height: 47)
        .demoTarget(option, in: "paste-demo", positions: $targets)
        if option != "Allow" { Divider().padding(.leading, 16) }
      }
    }
    .background(
      Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
  }

  @MainActor private func demonstrate() async {
    pointer.reset()
    step = reduceMotion ? 2 : 0
    guard !reduceMotion else { return }
    do {
      try await Task.sleep(for: .milliseconds(750))
      try await pointer.tap(targets["paste"], trailing: true)
      withAnimation(.easeOut(duration: 0.24)) { step = 1 }
      try await Task.sleep(for: .milliseconds(400))
      try await pointer.tap(targets["Allow"], trailing: true)
      withAnimation(.easeOut(duration: 0.2)) { step = 2 }
      pointer.hide()
    } catch {
      // Leaving or replaying the page cancels the demonstration.
    }
  }

}

/// A bounded demonstration: the card itself communicates classification.
struct TaggingOnboardingIllustration: View {
  @Environment(\.articleReduceMotion) private var reduceMotion
  @State private var processing = true
  @State private var revealed = false
  @State private var replay = 0
  private let tags = ["Attention", "Life"]

  var body: some View {
    VStack(spacing: 8) {
      ConnectedTagReveal(
        isProcessing: processing, tags: tags, replayID: replay, onRevealed: { revealed = true }
      ) {
        DemoArticleCard(showTags: true)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityIdentifier("onboarding-tags-demo")
      .accessibilityValue(revealed ? "tagged" : "pending")
      .accessibilityLabel(
        "Glacial Longings by Elizabeth Rush. Automatic tags: Attention; Life."
      )
      IllustrationReplay(id: "tags") { replay += 1 }
    }
    .task(id: replay) {
      processing = true
      revealed = false
      if !reduceMotion {
        do { try await Task.sleep(for: .milliseconds(1100)) } catch { return }
      }
      processing = false
    }
  }
}

/// A bundled editorial preview: replay never opens the publisher or uses Jev.
/// Source and photograph attribution are recorded in THIRD_PARTY_NOTICES.txt.
private enum OnboardingArticle {
  static let title = "Glacial Longings"
  static let author = "Elizabeth Rush"
  static let publisher = "Emergence Magazine"
  static let domain = "emergencemagazine.org"
  static let link = "emergencemagazine.org/essay/glacial-longings/"
}

private struct OnboardingArticleImage: View {
  var height: CGFloat

  var body: some View {
    GeometryReader { geometry in
      Image("OnboardingArticle")
        .resizable().scaledToFill()
        .frame(width: geometry.size.width, height: height)
        .clipped()
    }
    .frame(height: height)
    .accessibilityLabel(
      "An Antarctic ice shelf beneath a dark sky. Photograph by Elizabeth Rush.")
  }
}

private struct DemoArticleCard: View {
  var showTags: Bool
  var reservesTags = true
  var imageHeight: CGFloat = 130

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      OnboardingArticleImage(height: imageHeight)
        .clipShape(RoundedRectangle(cornerRadius: 14))
      HStack {
        Text(OnboardingArticle.domain).font(.system(size: 11)).foregroundStyle(.secondary)
        Spacer()
        Image(systemName: "bookmark.fill")
          .font(.system(size: 12)).foregroundStyle(ArcticBrand.accent)
      }
      Text(OnboardingArticle.title)
        .font(.system(size: 28, weight: .medium, design: .serif))
        .tracking(-0.8)
        .fixedSize(horizontal: false, vertical: true)
      Text(OnboardingArticle.author)
        .font(.system(size: 12)).foregroundStyle(.secondary)
      if reservesTags {
        HStack(spacing: 6) {
          ForEach(Array(["Attention", "Life"].enumerated()), id: \.element) {
            index, tag in
            TagRevealPill(name: tag, index: index, compact: true)
          }
        }
        .opacity(showTags ? 1 : 0)
        .accessibilityHidden(!showTags)
      }
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 24))
    .dynamicTypeSize(.medium)
  }
}

/// One pointer stays in the scene coordinate space as its targets change.
/// Travel, a short dwell, and a press/release make each demonstrated tap legible.
@MainActor @Observable
private final class DemoPointerModel {
  var position = CGPoint.zero
  var visible = false
  var pressed = false
  var tapCount = 0

  func reset() {
    visible = false
    pressed = false
    tapCount = 0
  }

  func tap(_ target: CGRect?, trailing: Bool = false) async throws {
    guard let target else { return }
    let destination = CGPoint(x: trailing ? target.maxX - 26 : target.midX, y: target.midY)
    if !visible {
      position = CGPoint(x: destination.x + 20, y: destination.y - 40)
      withAnimation(.easeOut(duration: 0.2)) { visible = true }
      try await Task.sleep(for: .milliseconds(80))
    }
    withAnimation(.timingCurve(0.77, 0, 0.175, 1, duration: 0.52)) {
      position = destination
    }
    try await Task.sleep(for: .milliseconds(800))
    withAnimation(.easeOut(duration: 0.12)) { pressed = true }
    try await Task.sleep(for: .milliseconds(120))
    withAnimation(.easeOut(duration: 0.18)) { pressed = false }
    tapCount += 1
    try await Task.sleep(for: .milliseconds(180))
  }

  func hide() {
    withAnimation(.easeOut(duration: 0.25)) { visible = false }
  }
}

private struct DemoPointer: View {
  var model: DemoPointerModel
  @State private var ripple = false

  var body: some View {
    ZStack {
      Circle()
        .strokeBorder(ReaderTheme.background.opacity(0.95), lineWidth: 3)
        .overlay { Circle().strokeBorder(ArcticBrand.accent.opacity(0.8), lineWidth: 1.5) }
        .scaleEffect(ripple ? 1.7 : 0.8)
        .opacity(model.tapCount == 0 || ripple ? 0 : 1)
      Circle()
        // A neutral core remains visible when the pointer reaches a blue button.
        .fill(ReaderTheme.background.opacity(model.pressed ? 0.9 : 0.72))
        .overlay { Circle().fill(ArcticBrand.accent.opacity(model.pressed ? 0.2 : 0.06)) }
        .overlay { Circle().strokeBorder(ArcticBrand.accent.opacity(0.8), lineWidth: 1.5) }
        .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
        .scaleEffect(model.pressed ? 0.76 : 1)
    }
    .frame(width: 34, height: 34)
    .position(model.position)
    .opacity(model.visible ? 1 : 0)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
    .task(id: model.tapCount) {
      guard model.tapCount > 0 else { return }
      var transaction = Transaction()
      transaction.disablesAnimations = true
      withTransaction(transaction) { ripple = false }
      await Task.yield()
      guard !Task.isCancelled else { return }
      withAnimation(.easeOut(duration: 0.45)) { ripple = true }
    }
  }
}

extension View {
  fileprivate func demoTarget(
    _ name: String, in coordinateSpace: String, positions: Binding<[String: CGRect]>
  ) -> some View {
    onGeometryChange(for: CGRect.self) { geometry in
      geometry.frame(in: .named(coordinateSpace))
    } action: { frame in
      positions.wrappedValue[name] = frame
    }
  }
}

private struct IllustrationReplay: View {
  var id: String
  var action: () -> Void

  var body: some View {
    HStack {
      Spacer()
      Button(action: action) {
        Image(systemName: "arrow.clockwise")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(.secondary)
          .frame(width: 44, height: 44)
          .contentShape(Rectangle())
      }
      .accessibilityLabel("Replay demonstration")
      .accessibilityIdentifier("onboarding-replay-\(id)")
    }
  }
}

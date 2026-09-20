import SwiftUI

/// These small, native scenes are demonstrations, not interactive app controls.
/// Tasks stop when the page disappears. Replay starts a fresh, finite sequence.
struct ShareOnboardingIllustration: View {
  @Environment(\.articleReduceMotion) private var reduceMotion
  @State private var step = 0
  @State private var replay = 0

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
      .frame(height: 300)
      .background(Color(uiColor: .systemGroupedBackground))
      .clipShape(RoundedRectangle(cornerRadius: 28))
      .overlay {
        RoundedRectangle(cornerRadius: 28)
          .strokeBorder(ReaderTheme.border.opacity(0.3), lineWidth: 0.5)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityIdentifier("onboarding-share-demo")
      .accessibilityValue(["safari", "share", "save", "saved"][step])
      .accessibilityLabel(
        "In Safari, tap Share. Choose Arctic in the app row, then tap Save. If Arctic is missing, choose More to add it."
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
        Label("example.com", systemImage: "lock.fill").font(.system(size: 11))
        Spacer()
        Image(systemName: "arrow.clockwise")
      }
      .font(.system(size: 12))
      .padding(12)
      .background(.thinMaterial, in: Capsule())
      .padding(12)
      VStack(alignment: .leading, spacing: 12) {
        Text("The quiet art of\npaying attention")
          .font(.system(size: 29, weight: .medium, design: .serif))
          .tracking(-0.8)
        Text("There is more to the everyday.")
          .font(.system(size: 12)).foregroundStyle(.secondary)
        HStack(spacing: 5) {
          ForEach(0..<7) { index in
            Capsule().fill(ArcticBrand.accent.opacity(0.08 + Double(index) * 0.025))
              .frame(height: CGFloat(28 + (index % 4) * 8))
          }
        }
        .frame(height: 55, alignment: .bottom)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 22)
      Spacer(minLength: 12)
      HStack {
        Image(systemName: "chevron.left")
        Spacer()
        Image(systemName: "chevron.right").opacity(0.3)
        Spacer()
        Image(systemName: "square.and.arrow.up")
          .foregroundStyle(ArcticBrand.accent)
          .overlay { if step == 0 { DemoTap() } }
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
        Image(systemName: "safari")
          .font(.system(size: 23)).foregroundStyle(ArcticBrand.accent)
          .frame(width: 42, height: 42)
          .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 10))
        VStack(alignment: .leading, spacing: 3) {
          Text("The quiet art of paying attention").font(.system(size: 13, weight: .semibold))
            .lineLimit(1)
          Text("example.com").font(.system(size: 11)).foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
          .frame(width: 25, height: 25).background(ReaderTheme.secondary, in: Circle())
      }
      HStack(alignment: .top, spacing: 0) {
        shareApp("AirDrop", symbol: "airplay.audio")
        VStack(spacing: 7) {
          ArcticMark().frame(width: 48, height: 48)
            .overlay { DemoTap() }
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
    VStack(spacing: 18) {
      HStack(spacing: 7) {
        ArcticMark().frame(width: 22, height: 22)
        Text("Arctic").font(.system(size: 13, weight: .semibold))
        Spacer()
        if step == 3 {
          Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold))
            .foregroundStyle(ArcticBrand.accent)
        }
      }
      DemoArticleCard(showTags: false)
      HStack(spacing: 10) {
        if step < 3 {
          Text("Cancel")
            .frame(maxWidth: .infinity, minHeight: 42)
            .background(ReaderTheme.secondary, in: Capsule())
        }
        Text(step == 3 ? "Done" : "Save")
          .frame(maxWidth: .infinity, minHeight: 42)
          .foregroundStyle(ArcticBrand.onAccent)
          .background(ArcticBrand.accent, in: Capsule())
          .overlay { if step == 2 { DemoTap() } }
      }
      .font(.system(size: 14, weight: .semibold))
    }
    .padding(18)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(ReaderTheme.background)
    .dynamicTypeSize(.medium)
  }

  @MainActor private func demonstrate() async {
    step = reduceMotion ? 3 : 0
    guard !reduceMotion else { return }
    do {
      for next in 1...3 {
        try await Task.sleep(for: .milliseconds(next == 1 ? 1100 : 1300))
        withAnimation(.spring(response: 0.3, dampingFraction: 1)) { step = next }
      }
    } catch {
      // Leaving or replaying the page cancels the demonstration.
    }
  }
}

struct PasteOnboardingIllustration: View {
  @Environment(\.articleReduceMotion) private var reduceMotion
  @State private var step = 0
  @State private var replay = 0

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
      .frame(height: 270)
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
      .overlay(alignment: .trailing) { DemoTap().padding(.trailing, 22) }
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
        .overlay(alignment: .trailing) {
          if option == "Allow", step == 1 { DemoTap().padding(.trailing, 20) }
        }
        if option != "Allow" { Divider().padding(.leading, 16) }
      }
    }
    .background(
      Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
  }

  @MainActor private func demonstrate() async {
    step = reduceMotion ? 2 : 0
    guard !reduceMotion else { return }
    do {
      try await Task.sleep(for: .milliseconds(1300))
      withAnimation(.easeOut(duration: 0.24)) { step = 1 }
      try await Task.sleep(for: .milliseconds(1500))
      withAnimation(.easeOut(duration: 0.2)) { step = 2 }
    } catch {
      // Leaving or replaying the page cancels the demonstration.
    }
  }
}

/// A bounded demonstration: the card itself communicates classification.
struct TaggingOnboardingIllustration: View {
  @Environment(\.articleReduceMotion) private var reduceMotion
  @State private var showTags = false
  @State private var beam = false
  @State private var replay = 0

  var body: some View {
    VStack(spacing: 8) {
      DemoArticleCard(showTags: showTags)
        .tagBeam(active: beam)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("onboarding-tags-demo")
        .accessibilityValue(showTags ? "tagged" : "pending")
        .accessibilityLabel(
          "The quiet art of paying attention. Automatic tags: Attention and wonder; Life and meaning."
        )
      IllustrationReplay(id: "tags") { replay += 1 }
    }
    .task(id: replay) { await demonstrate() }
  }

  @MainActor private func demonstrate() async {
    beam = false
    showTags = reduceMotion
    guard !reduceMotion else { return }
    do {
      try await Task.sleep(for: .milliseconds(450))
      beam = true
      try await Task.sleep(for: .milliseconds(900))
      withAnimation(.easeOut(duration: 0.24)) { showTags = true }
      try await Task.sleep(for: .milliseconds(1400))
      beam = false
    } catch {
      // Leaving or replaying the page cancels the demonstration.
    }
  }
}

private struct DemoArticleCard: View {
  var showTags: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text("example.com").font(.system(size: 11)).foregroundStyle(.secondary)
        Spacer()
        Image(systemName: "bookmark.fill")
          .font(.system(size: 12)).foregroundStyle(ArcticBrand.accent)
      }
      Text("The quiet art of\npaying attention")
        .font(.system(size: 28, weight: .medium, design: .serif))
        .tracking(-0.8)
        .fixedSize(horizontal: false, vertical: true)
      HStack(spacing: 6) {
        ForEach(["Attention & wonder", "Life & meaning"], id: \.self) { tag in
          Text(tag)
            .font(.system(size: 10, weight: .medium))
            .padding(.horizontal, 9).padding(.vertical, 6)
            .background(ReaderTheme.background, in: Capsule())
        }
      }
      .opacity(showTags ? 1 : 0)
      .accessibilityHidden(!showTags)
    }
    .padding(22)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 24))
    .dynamicTypeSize(.medium)
  }
}

private struct DemoTap: View {
  var body: some View {
    Circle()
      .fill(ArcticBrand.accent.opacity(0.12))
      .overlay { Circle().strokeBorder(ArcticBrand.accent.opacity(0.5), lineWidth: 1.5) }
      .frame(width: 34, height: 34)
      .allowsHitTesting(false)
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

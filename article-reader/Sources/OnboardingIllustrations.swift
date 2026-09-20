import SwiftUI

/// Native illustrations explain the flow without imitating live controls.
struct ShareOnboardingIllustration: View {
  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 7) {
        Image(systemName: "lock.fill").font(.system(size: 9))
        Text("a story worth keeping").font(.system(size: 11))
        Spacer()
        Image(systemName: "square.and.arrow.up")
          .font(.system(size: 16, weight: .medium))
          .padding(5)
          .background(ReaderTheme.foreground.opacity(0.08), in: Circle())
      }
      .foregroundStyle(.secondary)
      .padding(.horizontal, 20).padding(.vertical, 8)
      Divider().opacity(0.4)
      HStack(alignment: .center, spacing: 16) {
        VStack(alignment: .leading, spacing: 6) {
          Text("ON THE ART OF NOTICING")
            .font(.system(size: 8, weight: .semibold)).tracking(1.6)
            .foregroundStyle(.secondary)
          Text("There is more\nto the everyday.")
            .font(.system(size: 22, weight: .medium, design: .serif))
            .tracking(-0.8)
          Capsule().fill(ReaderTheme.border.opacity(0.4)).frame(width: 94, height: 3)
        }
        Spacer(minLength: 0)
        Image(systemName: "sun.horizon")
          .font(.system(size: 44, weight: .ultraLight))
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 20).padding(.vertical, 12)
      HStack(spacing: 18) {
        VStack(spacing: 5) {
          Image(systemName: "text.book.closed.fill")
            .font(.system(size: 20))
            .frame(width: 38, height: 38)
            .foregroundStyle(ReaderTheme.background)
            .background(ReaderTheme.foreground, in: RoundedRectangle(cornerRadius: 10))
          Text("Articles").font(.system(size: 10, weight: .medium))
        }
        VStack(spacing: 5) {
          Image(systemName: "ellipsis")
            .font(.system(size: 20))
            .frame(width: 38, height: 38)
            .background(ReaderTheme.background, in: RoundedRectangle(cornerRadius: 10))
          Text("More").font(.system(size: 10)).foregroundStyle(.secondary)
        }
        Spacer()
        Image(systemName: "arrow.turn.down.left")
          .font(.system(size: 22, weight: .ultraLight))
          .foregroundStyle(.secondary)
          .padding(.trailing, 18)
      }
      .padding(.horizontal, 20).padding(.vertical, 10)
      .frame(maxWidth: .infinity)
      .background(ReaderTheme.secondary)
    }
    .background(ReaderTheme.background)
    .clipShape(RoundedRectangle(cornerRadius: 24))
    .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(ReaderTheme.border.opacity(0.35)))
    .dynamicTypeSize(.medium)
    .accessibilityHidden(true)
  }
}

struct PasteOnboardingIllustration: View {
  var body: some View {
    VStack(spacing: 16) {
      HStack(spacing: 10) {
        Image(systemName: "link").font(.system(size: 14))
        Text("A link, ready when you are.")
          .font(.system(size: 13, weight: .medium))
        Spacer()
        Image(systemName: "doc.on.clipboard")
      }
      .padding(16)
      .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 16))
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 8) {
          Image(systemName: "gearshape")
          Text("Paste from Other Apps")
            .font(.system(size: 13, weight: .semibold))
        }
        .foregroundStyle(.secondary)
        .padding(16)
        Divider().opacity(0.4)
        ForEach(["Ask", "Deny", "Allow"], id: \.self) { option in
          HStack {
            Text(option).font(.system(size: 15, weight: option == "Allow" ? .semibold : .regular))
            Spacer()
            if option == "Allow" {
              Image(systemName: "checkmark.circle.fill").font(.system(size: 18))
            }
          }
          .foregroundStyle(option == "Allow" ? ReaderTheme.foreground : ReaderTheme.muted)
          .padding(.horizontal, 18).padding(.vertical, 11)
        }
      }
      .padding(.bottom, 6)
      .background(ReaderTheme.background)
      .clipShape(RoundedRectangle(cornerRadius: 20))
      .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(ReaderTheme.border.opacity(0.35)))
    }
    .dynamicTypeSize(.medium)
    .accessibilityHidden(true)
  }
}

/// A bounded, replayable demonstration. It never sends content to Jev.
struct TaggingOnboardingIllustration: View {
  @Environment(\.articleReduceMotion) private var reduceMotion
  @State private var showTags = false
  @State private var beam = false
  @State private var replay = 0

  var body: some View {
    VStack(spacing: 4) {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Text("HOW AUTOMATIC TAGS WORK")
            .font(.system(size: 8, weight: .semibold)).tracking(1.3)
            .foregroundStyle(.secondary)
          Spacer()
          Image(systemName: "bookmark.fill").font(.system(size: 12))
        }
        Text("How to pay attention.")
          .font(.system(size: 25, weight: .medium, design: .serif))
          .tracking(-0.8)
        Divider().opacity(0.4)
        ZStack(alignment: .leading) {
          Label("Finding its place…", systemImage: "sparkles")
            .font(.system(size: 12)).foregroundStyle(.secondary)
            .opacity(showTags ? 0 : 1)
          HStack(spacing: 5) {
            demoTag("Attention & wonder")
            demoTag("Life & meaning")
          }
          .opacity(showTags ? 1 : 0)
          .offset(y: showTags || reduceMotion ? 0 : 6)
        }
        .frame(height: 26, alignment: .leading)
      }
      .padding(18)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 24))
      .tagBeam(active: beam)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(
        "Example: How to pay attention. Automatic tags: Attention and wonder; Life and meaning.")
      HStack {
        Text("An example of automatic tags.")
          .font(.caption2).foregroundStyle(.secondary)
        Spacer()
        Button {
          replay += 1
        } label: {
          Label("Replay", systemImage: "arrow.clockwise")
            .font(.caption.weight(.medium))
            .padding(.vertical, 8)
        }
        .accessibilityIdentifier("onboarding-replay-tags")
      }
    }
    .task(id: replay) { await demonstrate() }
  }

  private func demoTag(_ title: String) -> some View {
    Text(title)
      .font(.system(size: 10, weight: .medium))
      .padding(.horizontal, 8).padding(.vertical, 5)
      .background(ReaderTheme.background, in: Capsule())
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
      try await Task.sleep(for: .milliseconds(700))
      beam = false
    } catch {
      // The page was left or the demonstration was restarted.
    }
  }
}

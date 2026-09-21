import SwiftUI

/// A recording surface for the native onboarding replay. It never saves an
/// article or calls Jev: the bundled result preserves the measured classification.
struct ArticleReplayView: View {
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    GeometryReader { geometry in
      VStack(alignment: .leading, spacing: 24) {
        HStack(spacing: 9) {
          ArcticMark().frame(width: 28, height: 28)
          Text("Arctic").font(.system(.headline, design: .rounded))
          Text("× Jev").foregroundStyle(.secondary)
          Spacer()
          Button {
            dismiss()
          } label: {
            Image(systemName: "xmark").font(.system(size: 14, weight: .semibold))
              .frame(width: 40, height: 40).readerGlass()
          }
          .accessibilityLabel("Close article replay")
          .accessibilityIdentifier("close-article-replay")
        }
        Text("A good read.\nA place for it.")
          .font(.system(size: 36, weight: .medium, design: .serif))
          .tracking(-1)
        ArticleReplayScene()
          .frame(height: min(560, max(400, geometry.size.height - 190)))
      }
      .padding(.horizontal, 28).padding(.top, 12)
      .frame(maxWidth: 560)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
    .background(ReaderTheme.background)
    .foregroundStyle(ReaderTheme.foreground)
    .tint(ArcticBrand.accent)
  }
}

/// The lifecycle owns one cancellable loop. Backgrounding stops it; returning
/// starts at the article. Reduced Motion presents the completed saved card.
private struct ArticleReplayScene: View {
  private enum Step: String { case article, share, link, tagging, tagged, saved, library }
  private struct Playback: Equatable {
    var active: Bool
    var reduced: Bool
  }
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.articleReduceMotion) private var reduceMotion
  @State private var step = Step.article
  @State private var cycle = 0
  @State private var pointer = DemoPointerModel()
  @State private var targets: [String: CGRect] = [:]
  private let article = ReplayArticle.bundled
  private let space = "article-replay"

  var body: some View {
    ZStack(alignment: .bottom) {
      if step == .library {
        library.transition(.opacity)
      } else {
        safari
        if step == .share {
          shareSheet.transition(.move(edge: .bottom).combined(with: .opacity))
        }
        if [.link, .tagging, .tagged, .saved].contains(step) {
          saveSheet.transition(.move(edge: .bottom).combined(with: .opacity))
        }
      }
    }
    .coordinateSpace(name: space)
    .overlay { DemoPointer(model: pointer) }
    .background(ReaderTheme.secondary)
    .clipShape(RoundedRectangle(cornerRadius: 28))
    .overlay {
      RoundedRectangle(cornerRadius: 28)
        .strokeBorder(ReaderTheme.border.opacity(0.3), lineWidth: 0.5)
    }
    .dynamicTypeSize(.medium)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      "An Alien Mind by Jakub Pachocki. Native share and automatic tagging replay."
    )
    .accessibilityIdentifier("article-replay-scene")
    .accessibilityValue("\(cycle):\(step.rawValue)")
    .task(id: Playback(active: scenePhase == .active, reduced: reduceMotion)) {
      await play()
    }
  }

  private var safari: some View {
    VStack(spacing: 0) {
      HStack {
        Image(systemName: "text.page")
        Spacer()
        Label(article.domain, systemImage: "lock.fill")
        Spacer()
        Image(systemName: "arrow.clockwise")
      }
      .font(.system(size: 12)).padding(12).readerGlass().padding(12)
      VStack(alignment: .leading, spacing: 22) {
        Text("OpenAI").font(.system(size: 17, weight: .semibold))
        Text("September 6, 2026 · Research")
          .font(.system(size: 11)).foregroundStyle(.secondary).padding(.top, 14)
        Text(article.title)
          .font(.system(size: 36, weight: .medium)).tracking(-1.3)
        Text("By: \(article.author)\nChief Scientist at OpenAI")
          .font(.system(size: 12)).foregroundStyle(.secondary)
        Text(article.description)
          .font(.system(size: 14)).lineSpacing(4)
      }
      .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 22)
      Spacer(minLength: 16)
      HStack {
        Image(systemName: "chevron.left")
        Spacer()
        Image(systemName: "chevron.right").opacity(0.3)
        Spacer()
        Image(systemName: "square.and.arrow.up")
          .foregroundStyle(ArcticBrand.accent)
          .demoTarget("share", in: space, positions: $targets)
        Spacer()
        Image(systemName: "book")
        Spacer()
        Image(systemName: "square.on.square")
      }
      .font(.system(size: 18)).padding(18).readerGlass().padding(12)
    }
    .background(ReaderTheme.background)
  }

  private var shareSheet: some View {
    VStack(spacing: 22) {
      Capsule().fill(.secondary.opacity(0.35)).frame(width: 32, height: 4)
      HStack(spacing: 10) {
        Image("AlienMindReplay").resizable().scaledToFill()
          .frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 10))
        VStack(alignment: .leading, spacing: 4) {
          Text(article.title).font(.system(size: 14, weight: .semibold))
          Text(article.domain).font(.system(size: 11)).foregroundStyle(.secondary)
        }
        Spacer()
        Image(systemName: "xmark").font(.system(size: 12)).foregroundStyle(.secondary)
      }
      HStack(alignment: .top) {
        shareApp("AirDrop", symbol: "airplay.audio")
        VStack(spacing: 7) {
          ArcticMark().frame(width: 48, height: 48)
            .demoTarget("arctic", in: space, positions: $targets)
          Text("Arctic").font(.system(size: 10))
        }.frame(maxWidth: .infinity)
        shareApp("Mail", symbol: "envelope.fill")
        shareApp("More", symbol: "ellipsis")
      }
      HStack {
        Text("Copy")
        Spacer()
        Image(systemName: "document.on.document")
      }
      .font(.system(size: 14)).padding(14)
      .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 12))
    }
    .padding(18)
    .background(
      .regularMaterial, in: UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24))
  }

  private func shareApp(_ title: String, symbol: String) -> some View {
    VStack(spacing: 7) {
      Image(systemName: symbol).font(.system(size: 24)).foregroundStyle(ArcticBrand.accent)
        .frame(width: 48, height: 48)
        .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 12))
      Text(title).font(.system(size: 10))
    }.frame(maxWidth: .infinity)
  }

  private var saveSheet: some View {
    VStack(spacing: 16) {
      HStack(spacing: 7) {
        ArcticMark().frame(width: 22, height: 22)
        Text("Arctic").font(.system(size: 14, weight: .semibold))
        Spacer()
        if step == .saved {
          Image(systemName: "checkmark").foregroundStyle(ArcticBrand.accent)
        }
      }
      if step == .link {
        HStack(spacing: 12) {
          Image(systemName: "link").foregroundStyle(.secondary)
          Text(article.link).font(.system(size: 13)).frame(maxWidth: .infinity, alignment: .leading)
          ProgressView().controlSize(.small)
        }
        .padding(16)
        .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 18))
      } else {
        ConnectedTagReveal(isProcessing: step == .tagging, tags: article.selected, replayID: cycle)
        {
          articleCard
        }
      }
      HStack(spacing: 10) {
        Text("Cancel").frame(maxWidth: .infinity, minHeight: 44)
          .background(ReaderTheme.secondary, in: Capsule())
        Text(step == .saved ? "Done" : "Save")
          .frame(maxWidth: .infinity, minHeight: 44)
          .foregroundStyle(ArcticBrand.onAccent)
          .background(ArcticBrand.accent, in: Capsule())
          .demoTarget("save", in: space, positions: $targets)
      }.font(.system(size: 14, weight: .semibold))
    }
    .padding(18)
    .background(
      ReaderTheme.background,
      in: UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24))
  }

  private var articleCard: some View {
    DemoArticleCard(
      showTags: true, imageHeight: 110, imageName: "AlienMindReplay", title: article.title,
      author: article.author, domain: article.domain, tags: article.selected)
  }

  private var library: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Text("Arctic").font(.system(size: 28, weight: .semibold, design: .rounded))
        Spacer()
        Image(systemName: "line.3.horizontal.decrease").padding(12).readerGlass()
      }
      HStack(spacing: 6) {
        ForEach(article.selected, id: \.self) { tag in
          Text(tag).font(.system(size: 12, weight: .medium)).padding(.horizontal, 12)
            .padding(.vertical, 9)
            .foregroundStyle(ArcticBrand.accent)
            .background(ArcticBrand.accent.opacity(0.1), in: Capsule())
        }
      }
      DemoArticleCard(
        showTags: false, reservesTags: false, imageHeight: 110, imageName: "AlienMindReplay",
        title: article.title, author: article.author, domain: article.domain)
      Spacer(minLength: 0)
      Label("Saved to Arctic", systemImage: "checkmark")
        .font(.system(size: 12)).foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
    }
    .padding(18).background(ReaderTheme.background)
  }

  @MainActor private func play() async {
    pointer.reset()
    guard scenePhase == .active else { return }
    if reduceMotion {
      step = .library
      return
    }
    do {
      while !Task.isCancelled {
        cycle += 1
        withAnimation(.easeOut(duration: 0.25)) { step = .article }
        try await Task.sleep(for: .seconds(2))
        try await pointer.tap(targets["share"])
        withAnimation(.spring(response: 0.3, dampingFraction: 1)) { step = .share }
        try await Task.sleep(for: .milliseconds(650))
        try await pointer.tap(targets["arctic"])
        withAnimation(.spring(response: 0.3, dampingFraction: 1)) { step = .link }
        try await Task.sleep(for: .milliseconds(900))
        withAnimation(.spring(response: 0.4, dampingFraction: 1)) { step = .tagging }
        pointer.hide()
        // Preserve the production call's 0.911-second delay. This is recorded
        // evidence, not a fresh API request or a promised performance figure.
        try await Task.sleep(for: .seconds(article.durationSeconds))
        step = .tagged
        try await Task.sleep(for: .seconds(2))
        try await pointer.tap(targets["save"])
        withAnimation(.easeOut(duration: 0.2)) { step = .saved }
        pointer.hide()
        try await Task.sleep(for: .milliseconds(900))
        withAnimation(.easeOut(duration: 0.25)) { step = .library }
        try await Task.sleep(for: .seconds(3))
        pointer.reset()
      }
    } catch {
      // SwiftUI cancels this task on dismissal, backgrounding or motion changes.
      pointer.reset()
    }
  }
}

private struct ReplayArticle: Decodable {
  let title: String
  let author: String
  let description: String
  let domain: String
  let link: String
  let selected: [String]
  let durationSeconds: Double

  static let bundled: Self = {
    // Required build-time fixture; the UI test validates that it loads in the app.
    let url = Bundle.main.url(
      forResource: "alien-mind-replay", withExtension: "json", subdirectory: "Fixtures")!
    return try! JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
  }()
}

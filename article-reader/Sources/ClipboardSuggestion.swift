import SwiftUI
import UIKit

/// Check only on app entry. Pattern detection does not read clipboard contents;
/// reading the matched URL still uses iOS's normal paste permission prompt.
@MainActor @Observable final class ClipboardSuggestion {
  var url: URL?
  private(set) var preview: ArticlePreview?
  private var checking = false
  private let defaults = UserDefaults.standard
  private var key: String { TestMode.enabled ? "test-clipboard-change" : "clipboard-change" }

  func check() async {
    if TestMode.enabled && !ProcessInfo.processInfo.arguments.contains("-test-clipboard") { return }
    guard !checking else { return }
    checking = true
    defer { checking = false }
    let pasteboard = UIPasteboard.general
    let change = pasteboard.changeCount
    guard defaults.object(forKey: key) == nil || defaults.integer(forKey: key) != change else {
      return
    }
    url = nil
    preview = nil
    // Record before reading: Allow Paste can itself cause a scene transition.
    defaults.set(change, forKey: key)
    let patterns: Set<UIPasteboard.DetectionPattern>? = try? await withCheckedThrowingContinuation {
      continuation in
      pasteboard.detectPatterns(for: [.probableWebURL]) { continuation.resume(with: $0) }
    }
    guard patterns?.contains(.probableWebURL) == true, pasteboard.changeCount == change,
      let text = pasteboard.string, pasteboard.changeCount == change
    else { return }
    guard let link = SharedInbox.webURL(text),
      var components = URLComponents(url: link, resolvingAgainstBaseURL: false)
    else { return }
    // Use the same cleaned URL for the preview, preload, save, and open paths.
    components.query = nil
    url = components.url
  }

  func preparePreview() async {
    preview = nil
    guard let url else { return }
    let result = try? await ArticlePreviewCache.shared.load(url)
    guard !Task.isCancelled, self.url == url else { return }
    preview = result
  }

  func dismiss() {
    url = nil
    preview = nil
  }
}

struct ClipboardBanner: View {
  let url: URL
  let preview: ArticlePreview?
  let isSaved: Bool
  let save: () -> Void
  let open: () -> Void
  let dismiss: () -> Void
  var body: some View {
    HStack(spacing: 12) {
      if let image = preview?.imageURL {
        ArticleThumbnail(url: image, pixels: 192).frame(width: 38, height: 44)
          .clipShape(RoundedRectangle(cornerRadius: 7))
      } else {
        Image(systemName: "link").font(.title3)
      }
      VStack(alignment: .leading, spacing: 3) {
        Text(preview?.title ?? "Copied link").font(ReaderTheme.sans(14, weight: .medium))
          .lineLimit(2).accessibilityIdentifier("clipboard-preview-title")
          .accessibilityValue(TestMode.enabled ? (preview?.taggingText ?? "") : "")
        Text(url.host ?? "Article").font(ReaderTheme.sans(12)).foregroundStyle(ReaderTheme.muted)
          .lineLimit(1).accessibilityLabel(url.absoluteString)
          .accessibilityIdentifier("clipboard-link")
      }
      Spacer()
      if !isSaved {
        Button("Save", action: save).font(ReaderTheme.sans(14, weight: .semibold))
          .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
          .accessibilityIdentifier("save-copied-link")
      }
      Button("Open", action: open).font(ReaderTheme.sans(14, weight: .semibold))
        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        .accessibilityIdentifier("open-copied-link")
      Button("Dismiss", systemImage: "xmark", action: dismiss).labelStyle(.iconOnly)
        .frame(width: 36, height: 44).accessibilityIdentifier("dismiss-copied-link")
    }
    .padding(.leading, 18).padding(.trailing, 6).padding(.vertical, 8)
    .readerGlass().padding(.horizontal, 20).padding(.bottom, 8)
    .accessibilityElement(children: .contain)
  }
}

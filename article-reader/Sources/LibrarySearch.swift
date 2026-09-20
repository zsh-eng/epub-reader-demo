import CryptoKit
import ImageIO
import SwiftUI
import UIKit

/// Let the system own focus, keyboard avoidance, and the glass search transition.
/// This also keeps search focus intact when returning from a reading page.
struct LibrarySearchChrome: ViewModifier {
  @Binding var query: String
  @Binding var active: Bool
  @FocusState private var focused: Bool

  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.searchable(text: $query, isPresented: $active, prompt: "Search")
        .searchPresentationToolbarBehavior(.avoidHidingContent)
        .toolbar { DefaultToolbarItem(kind: .search, placement: .bottomBar) }
        .scrollEdgeEffectStyle(.soft, for: .bottom)
    } else {
      content.safeAreaInset(edge: .bottom) {
        LibrarySearch(query: $query, focused: $focused, active: active) {
          query = ""
          focused = false
          active = false
        }.padding(.horizontal, 20).padding(.vertical, 8).background(.regularMaterial)
      }
      .onChange(of: focused) { _, value in if value { active = true } }
    }
  }
}

struct LibrarySearch: View {
  @Binding var query: String
  @FocusState.Binding var focused: Bool
  let active: Bool
  let cancel: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      HStack(spacing: 10) {
        Image(systemName: "magnifyingglass").font(.system(size: 17, weight: .medium))
          .foregroundStyle(ReaderTheme.muted)
        TextField(
          "", text: $query, prompt: Text("Search").foregroundStyle(ReaderTheme.muted)
        )
        .font(ReaderTheme.sans(16))
        .foregroundStyle(ReaderTheme.foreground)
        .focused($focused)
        .textInputAutocapitalization(.never).autocorrectionDisabled()
        .submitLabel(.search)
        .accessibilityLabel("Search articles").accessibilityIdentifier("article-search")
        if !query.isEmpty {
          Button {
            query = ""
            focused = true
          } label: {
            Image(systemName: "xmark.circle.fill").foregroundStyle(ReaderTheme.muted)
              .frame(width: 32, height: 44)
          }
          .accessibilityLabel("Clear search")
        }
      }
      .padding(.leading, 16).padding(.trailing, query.isEmpty ? 16 : 6)
      .frame(minHeight: 48)
      .readerGlass()
      .overlay(Capsule().stroke(ReaderTheme.border.opacity(focused ? 1 : 0), lineWidth: 1))
      if active {
        Button("Cancel", action: cancel).font(ReaderTheme.sans(15, weight: .medium))
          .transition(.opacity)
          .accessibilityIdentifier("cancel-search")
      }
    }
  }
}

/// Shared decoded images avoid AsyncImage's empty phase when a card becomes a result row.
@MainActor @Observable final class ThumbnailCache {
  static let shared = ThumbnailCache()
  private var images: [URL: UIImage] = [:]
  @ObservationIgnored private var pending: [URL: Task<UIImage?, Never>] = [:]
  func image(for url: URL?) -> UIImage? { url.flatMap { images[$0] } }
  func load(_ url: URL?) async {
    guard let url, images[url] == nil else { return }
    if let task = pending[url] {
      _ = await task.value
      return
    }
    let task = Task { () -> UIImage? in
      guard let bytes = await PreviewImageDisk.shared.data(for: url) else { return nil }
      return UIImage(data: bytes)
    }
    pending[url] = task
    let image = await task.value
    if images.count >= 64, let first = images.keys.first { images[first] = nil }
    images[url] = image
    pending[url] = nil
  }
}

struct ArticleThumbnail: View {
  let url: URL?
  var label = "Article preview"
  @State private var loadedImage: UIImage?
  var body: some View {
    GeometryReader { geometry in
      Group {
        if let image = loadedImage ?? ThumbnailCache.shared.image(for: url) {
          Image(uiImage: image).resizable().scaledToFill().accessibilityLabel(label)
        } else {
          ReaderTheme.secondary.overlay {
            Image(systemName: "text.alignleft")
              .font(.system(size: 20, weight: .light)).foregroundStyle(
                ReaderTheme.muted.opacity(0.5))
          }
        }
      }
      .frame(width: geometry.size.width, height: geometry.size.height).clipped()
    }
    .onDisappear { loadedImage = nil }
    .task(id: url) {
      loadedImage = ThumbnailCache.shared.image(for: url)
      await ThumbnailCache.shared.load(url)
      loadedImage = ThumbnailCache.shared.image(for: url)
    }
  }
}

struct ArticleSearchRow: View {
  let article: SavedArticle
  let query: String
  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      ArticleThumbnail(url: article.imageURL)
        .frame(width: 58, height: 66).clipShape(RoundedRectangle(cornerRadius: 10))
      VStack(alignment: .leading, spacing: 4) {
        Text(article.url.host?.replacingOccurrences(of: "www.", with: "") ?? "")
          .font(ReaderTheme.sans(11, weight: .medium, relativeTo: .caption))
          .foregroundStyle(ReaderTheme.muted)
        Text(highlighted(article.title)).font(ReaderTheme.sans(16, weight: .medium))
          .lineLimit(2)
        Text(highlighted(article.subtitle.isEmpty ? article.url.absoluteString : article.subtitle))
          .font(ReaderTheme.sans(13, relativeTo: .subheadline))
          .foregroundStyle(ReaderTheme.muted).lineLimit(2)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, 14)
    .padding(.horizontal, 16)
    .background(ReaderTheme.background, in: RoundedRectangle(cornerRadius: 16))
    .contentShape(RoundedRectangle(cornerRadius: 16))
  }

  private func highlighted(_ text: String) -> AttributedString {
    var result = AttributedString(text)
    for word in query.split(whereSeparator: \.isWhitespace) {
      var start = text.startIndex
      while start < text.endIndex,
        let range = text.range(
          of: String(word), options: [.caseInsensitive, .diacriticInsensitive],
          range: start..<text.endIndex)
      {
        if let lower = AttributedString.Index(range.lowerBound, within: result),
          let upper = AttributedString.Index(range.upperBound, within: result)
        {
          result[lower..<upper].backgroundColor = ReaderTheme.secondary
          result[lower..<upper].foregroundColor = ReaderTheme.foreground
        }
        start = range.upperBound
      }
    }
    return result
  }
}

/// Durable, bounded image storage shared by library thumbnails and Reader headers.
/// Hash URL keys, validate/decode images, and retain only a downsampled image, preserving transparency for icons.
actor PreviewImageDisk {
  static let shared = PreviewImageDisk()
  private var pending: [URL: Task<Data?, Never>] = [:]
  private let directory = URL.applicationSupportDirectory.appending(path: "ArticleReader/Images")

  func data(for url: URL) async -> Data? {
    let key = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }
      .joined()
    let file = directory.appending(path: key + ".image")
    if let data = try? Data(contentsOf: file) {
      try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
      return data
    }
    if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-images-offline") {
      return nil
    }
    if let task = pending[url] { return await task.value }
    let task = Task.detached { () -> Data? in
      let bytes: Data
      if TestMode.enabled && url.isFileURL {
        guard let data = try? Data(contentsOf: url) else { return nil }
        bytes = data
      } else {
        guard ["http", "https"].contains(url.scheme ?? ""),
          let (data, response) = try? await URLSession.shared.data(
            for: URLRequest(url: url, timeoutInterval: 8)),
          let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode)
        else { return nil }
        bytes = data
      }
      guard bytes.count < 15_000_000,
        let source = CGImageSourceCreateWithData(bytes as CFData, nil),
        let decoded = CGImageSourceCreateThumbnailAtIndex(
          source, 0,
          [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 1200,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
          ] as CFDictionary)
      else { return nil }
      let image = UIImage(cgImage: decoded)
      switch decoded.alphaInfo {
      case .first, .last, .premultipliedFirst, .premultipliedLast:
        return image.pngData()
      default:
        return image.jpegData(compressionQuality: 0.85)
      }
    }
    pending[url] = task
    let bytes = await task.value
    pending[url] = nil
    guard let bytes else { return nil }
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try? bytes.write(to: file, options: .atomic)
    trim()
    return bytes
  }

  func dataURL(for value: String) async -> String {
    guard let url = URL(string: value), let bytes = await data(for: url) else { return "" }
    let type = bytes.starts(with: [0x89, 0x50, 0x4e, 0x47]) ? "png" : "jpeg"
    return "data:image/\(type);base64," + bytes.base64EncodedString()
  }

  private func trim() {
    let files =
      (try? FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])) ?? []
    let entries = files.compactMap { url -> (URL, Int, Date)? in
      guard
        let info = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
      else { return nil }
      return (url, info.fileSize ?? 0, info.contentModificationDate ?? .distantPast)
    }.sorted { $0.2 < $1.2 }
    var size = entries.reduce(0) { $0 + $1.1 }
    for (url, bytes, _) in entries where size > 128_000_000 {
      try? FileManager.default.removeItem(at: url)
      size -= bytes
    }
  }
}

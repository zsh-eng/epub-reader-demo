import CryptoKit
import ImageIO
import SwiftUI
import UIKit

/// Keep the native text field mounted from launch. A tap focuses it directly;
/// it does not need to construct and present a separate search controller.
struct LibrarySearchChrome: ViewModifier {
  @Binding var query: String
  @Binding var active: Bool

  func body(content: Content) -> some View {
    content.readerBar(edge: .bottom) {
      HStack(spacing: 10) {
        NativeArticleSearch(query: $query, active: $active)
          .frame(height: 50).padding(.horizontal, 12).readerGlass()
        if active {
          Button {
            query = ""
            active = false
          } label: {
            Image(systemName: "xmark").frame(width: 44, height: 44)
          }.readerGlass().accessibilityLabel("Close search").accessibilityIdentifier("close")
        }
      }.padding(.horizontal, 20).padding(.vertical, 8)
    }
  }
}

private struct NativeArticleSearch: UIViewRepresentable {
  @Binding var query: String
  @Binding var active: Bool

  func makeCoordinator() -> Coordinator { Coordinator(query: $query, active: $active) }
  func makeUIView(context: Context) -> UISearchTextField {
    let field = UISearchTextField()
    field.placeholder = "Search"
    field.backgroundColor = .clear
    field.borderStyle = .none
    field.font = .preferredFont(forTextStyle: .body)
    field.adjustsFontForContentSizeCategory = true
    field.autocapitalizationType = .none
    field.autocorrectionType = .no
    field.returnKeyType = .search
    field.accessibilityIdentifier = "article-search"
    field.accessibilityTraits.insert(.searchField)
    field.delegate = context.coordinator
    field.addTarget(
      context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
    return field
  }
  func updateUIView(_ field: UISearchTextField, context: Context) {
    context.coordinator.query = $query
    context.coordinator.active = $active
    if field.text != query { field.text = query }
    if !active && field.isFirstResponder { field.resignFirstResponder() }
  }
  final class Coordinator: NSObject, UITextFieldDelegate {
    var query: Binding<String>
    var active: Binding<Bool>
    init(query: Binding<String>, active: Binding<Bool>) {
      self.query = query
      self.active = active
    }
    func textFieldDidBeginEditing(_ textField: UITextField) { active.wrappedValue = true }
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
      textField.resignFirstResponder()
      return true
    }
    @objc func changed(_ field: UITextField) { query.wrappedValue = field.text ?? "" }
  }
}

/// Keep decoded images bounded by memory cost. Only the requesting thumbnail
/// updates its SwiftUI state; inserting an image never invalidates every row.
@MainActor final class ThumbnailCache {
  static let shared = ThumbnailCache()
  private let images = NSCache<NSURL, UIImage>()
  private struct Request {
    let task: Task<UIImage?, Never>
    var readers: Set<UUID>
  }
  private var pending: [URL: Request] = [:]

  private init() {
    images.countLimit = 64
    images.totalCostLimit = 32 * 1024 * 1024
  }

  func image(for url: URL?) -> UIImage? {
    guard let url else { return nil }
    return images.object(forKey: url as NSURL)
  }

  @discardableResult
  func load(_ url: URL?) async -> UIImage? {
    guard let url else { return nil }
    if let image = image(for: url) { return image }
    let reader = UUID()
    let task: Task<UIImage?, Never>
    if var request = pending[url] {
      request.readers.insert(reader)
      pending[url] = request
      task = request.task
    } else {
      task = Task.detached(priority: .userInitiated) { () -> UIImage? in
        guard let bytes = await PreviewImageDisk.shared.data(for: url), !Task.isCancelled,
          let source = CGImageSourceCreateWithData(bytes as CFData, nil),
          let decoded = CGImageSourceCreateImageAtIndex(
            source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
        else { return nil }
        return UIImage(cgImage: decoded)
      }
      pending[url] = Request(task: task, readers: [reader])
    }
    let image = await withTaskCancellationHandler {
      await task.value
    } onCancel: {
      Task { @MainActor in self.finish(url, reader: reader) }
    }
    finish(url, reader: reader)
    guard !Task.isCancelled else { return nil }
    if let image {
      let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
      images.setObject(image, forKey: url as NSURL, cost: cost)
    }
    return image
  }

  private func finish(_ url: URL, reader: UUID) {
    guard var request = pending[url], request.readers.remove(reader) != nil else { return }
    if request.readers.isEmpty {
      request.task.cancel()
      pending[url] = nil
    } else {
      pending[url] = request
    }
  }

  func releaseMemory() { images.removeAllObjects() }
}

struct ArticleThumbnail: View {
  let url: URL?
  var label = "Article preview"
  @State private var loadedImage: UIImage?
  var body: some View {
    GeometryReader { geometry in
      Group {
        if let image = loadedImage {
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
      let image = await ThumbnailCache.shared.load(url)
      guard !Task.isCancelled else { return }
      loadedImage = image
    }
  }
}

struct ArticleSearchRow: View {
  let article: SavedArticle
  let query: String
  @ScaledMetric(relativeTo: .body) private var thumbnailHeight = 74

  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      ArticleThumbnail(url: article.imageURL)
        .frame(width: 58, height: thumbnailHeight).clipShape(RoundedRectangle(cornerRadius: 10))
      VStack(alignment: .leading, spacing: 4) {
        Text(article.url.host?.replacingOccurrences(of: "www.", with: "") ?? "")
          .font(ReaderTheme.sans(11, weight: .medium, relativeTo: .caption))
          .foregroundStyle(ReaderTheme.muted)
        ViewThatFits(in: .horizontal) {
          VStack(alignment: .leading, spacing: 4) {
            Text(highlighted(article.title)).font(ReaderTheme.sans(16, weight: .medium))
              .fixedSize(horizontal: true, vertical: false)
            Text(
              highlighted(article.subtitle.isEmpty ? article.url.absoluteString : article.subtitle)
            )
            .font(ReaderTheme.sans(13, relativeTo: .subheadline))
            .foregroundStyle(ReaderTheme.muted).lineLimit(2)
            .accessibilityIdentifier("search-result-subtitle")
          }
          LibraryTitle(
            text: article.title, style: .body, pointSize: 16, weight: .medium, query: query)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
  private struct Request {
    let task: Task<Data?, Never>
    var readers: Set<UUID>
  }
  private var pending: [URL: Request] = [:]
  private let work = PreviewImageWorkLimit()
  private let directory = URL.applicationSupportDirectory.appending(path: "ArticleReader/Images")
  private var lastTrim = Date.distantPast
  private var bytesSinceTrim = 0

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
    let reader = UUID()
    let task: Task<Data?, Never>
    if var request = pending[url] {
      request.readers.insert(reader)
      pending[url] = request
      task = request.task
    } else {
      let work = self.work
      task = Task.detached(priority: .userInitiated) { () -> Data? in
        guard await work.acquire() else { return nil }
        let bytes = await Self.fetch(url)
        await work.release()
        return bytes
      }
      pending[url] = Request(task: task, readers: [reader])
    }
    let bytes = await withTaskCancellationHandler {
      await task.value
    } onCancel: {
      Task { await self.finish(url, reader: reader) }
    }
    finish(url, reader: reader)
    guard !Task.isCancelled else { return nil }
    guard let bytes else { return nil }
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try? bytes.write(to: file, options: .atomic)
    // Enumerating and sorting the whole cache for every image made large imports
    // progressively slower. Check the disk budget once per minute or after another 8 MB is written.
    bytesSinceTrim += bytes.count
    if bytesSinceTrim >= 8_000_000 || Date().timeIntervalSince(lastTrim) > 60 {
      bytesSinceTrim = 0
      lastTrim = Date()
      trim()
    }
    return bytes
  }

  private func finish(_ url: URL, reader: UUID) {
    guard var request = pending[url], request.readers.remove(reader) != nil else { return }
    if request.readers.isEmpty {
      request.task.cancel()
      pending[url] = nil
    } else {
      pending[url] = request
    }
  }

  private nonisolated static func fetch(_ url: URL) async -> Data? {
    guard !Task.isCancelled else { return nil }
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
    guard !Task.isCancelled, bytes.count < 15_000_000,
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

  /// Reader text can use an existing local decoration without waiting for network work.
  func cachedDataURL(for value: String) -> String {
    guard let url = URL(string: value) else { return "" }
    let key = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }
      .joined()
    guard let bytes = try? Data(contentsOf: directory.appending(path: key + ".image")) else {
      return ""
    }
    let type = bytes.starts(with: [0x89, 0x50, 0x4e, 0x47]) ? "png" : "jpeg"
    return "data:image/\(type);base64,\(bytes.base64EncodedString())"
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

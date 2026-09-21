import CryptoKit
import ImageIO
import SwiftUI
import UIKit

/// Keep the native text field mounted during normal search transitions. A tap
/// focuses it directly; modal sheets remove the inactive hosted bar temporarily.
struct LibrarySearchChrome: ViewModifier {
  @Binding var query: String
  @Binding var active: Bool
  var obscured = false

  func body(content: Content) -> some View {
    content.readerBar(edge: .bottom) {
      if obscured {
        // iOS 26 hosts safe-area bars separately from the modal page. Remove
        // interactive descendants, but keep the same inset to prevent a jump.
        Color.clear.frame(height: 66).accessibilityHidden(true).allowsHitTesting(false)
      } else {
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

/// Cache decoded variants by display size, but share their compressed resource by
/// URL. A 58-point search image must never retain a 1,200-pixel Reader bitmap.
struct ThumbnailRequest: Hashable, Sendable {
  let url: URL
  var pixels = 960
  var key: NSString { "\(pixels):\(url.absoluteString)" as NSString }
}

@MainActor final class ThumbnailCache {
  static let shared = ThumbnailCache()
  private let images = NSCache<NSString, UIImage>()
  private let previews = NSCache<NSURL, UIImage>()
  private let decoding = PreviewImageWorkLimit(limit: 2)
  private struct Request {
    let task: Task<UIImage?, Never>
    var readers: Set<UUID>
  }
  private var pending: [ThumbnailRequest: Request] = [:]

  private init() {
    images.countLimit = 96
    images.totalCostLimit = 32 * 1024 * 1024
    previews.countLimit = 256
    previews.totalCostLimit = 1024 * 1024
  }

  func image(for url: URL?, pixels: Int = 960) -> UIImage? {
    guard let url else { return nil }
    return images.object(forKey: ThumbnailRequest(url: url, pixels: pixels).key)
  }

  @discardableResult
  func load(_ url: URL?, pixels: Int = 960, prefetch: Bool = false) async -> UIImage? {
    guard let url else { return nil }
    if let image = image(for: url, pixels: pixels) { return image }
    let key = ThumbnailRequest(url: url, pixels: pixels)
    let reader = UUID()
    let task: Task<UIImage?, Never>
    if var request = pending[key] {
      request.readers.insert(reader)
      pending[key] = request
      task = request.task
    } else {
      let decoding = self.decoding
      task = Task.detached(priority: prefetch ? .utility : .userInitiated) { () -> UIImage? in
        guard
          let bytes = await PreviewImageDisk.shared.thumbnailData(
            for: url, pixels: pixels, prefetch: prefetch),
          !Task.isCancelled, await decoding.acquire(prefetch: prefetch)
        else { return nil }
        let decoded = Task.isCancelled ? nil : PreviewImageCodec.thumbnail(bytes, pixels: pixels)
        await decoding.release()
        return decoded.map { UIImage(cgImage: $0) }
      }
      pending[key] = Request(task: task, readers: [reader])
    }
    let image = await withTaskCancellationHandler {
      await task.value
    } onCancel: {
      Task { @MainActor in self.finish(key, reader: reader) }
    }
    finish(key, reader: reader)
    guard !Task.isCancelled else { return nil }
    if let image {
      images.setObject(
        image, forKey: key.key,
        cost: image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0)
    }
    return image
  }

  /// Tiny placeholders are decoded once and kept apart from full thumbnails.
  /// The detached work never creates a network request and cannot publish after cancellation.
  func placeholder(for url: URL) async -> UIImage? {
    if let image = previews.object(forKey: url as NSURL) { return image }
    let task = Task.detached(priority: .userInitiated) { () -> UIImage? in
      guard !Task.isCancelled, let bytes = await PreviewImageDisk.shared.preview(for: url),
        !Task.isCancelled, let image = PreviewImageCodec.thumbnail(bytes, pixels: 24)
      else { return nil }
      return UIImage(cgImage: image)
    }
    let image = await withTaskCancellationHandler {
      await task.value
    } onCancel: {
      task.cancel()
    }
    guard !Task.isCancelled else { return nil }
    if let image {
      previews.setObject(
        image, forKey: url as NSURL, cost: image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0)
    }
    return image
  }

  /// Two speculative consumers leave capacity for newly visible work. SwiftUI's
  /// viewport task owns this group; leaving the working set cancels its leases.
  func preheat(_ requests: [ThumbnailRequest]) async {
    var seen = Set<ThumbnailRequest>()
    var remaining = requests.filter { seen.insert($0).inserted }.makeIterator()
    await withTaskGroup(of: Void.self) { group in
      func enqueue(_ request: ThumbnailRequest) {
        group.addTask { await self.load(request.url, pixels: request.pixels, prefetch: true) }
      }
      for _ in 0..<2 { if let request = remaining.next() { enqueue(request) } }
      for await _ in group {
        guard !Task.isCancelled else {
          group.cancelAll()
          return
        }
        if let request = remaining.next() { enqueue(request) }
      }
    }
  }

  private func finish(_ key: ThumbnailRequest, reader: UUID) {
    guard var request = pending[key], request.readers.remove(reader) != nil else { return }
    if request.readers.isEmpty {
      request.task.cancel()
      pending[key] = nil
    } else {
      pending[key] = request
    }
  }

  func releaseMemory() {
    images.removeAllObjects()
    previews.removeAllObjects()
  }
}

struct ArticleThumbnail: View {
  let url: URL?
  var label = "Article preview"
  var pixels = 960
  @State private var loadedImage: UIImage?
  @State private var preview: UIImage?
  @State private var showProgress = false
  @State private var requestID = UUID()
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    GeometryReader { geometry in
      Group {
        if let image = loadedImage ?? ThumbnailCache.shared.image(for: url, pixels: pixels) {
          Image(uiImage: image).resizable().scaledToFill().accessibilityLabel(label)
        } else {
          ZStack {
            ReaderTheme.secondary
            if let preview {
              Image(uiImage: preview).resizable().scaledToFill().blur(radius: 5)
            } else {
              Image(systemName: "text.alignleft")
                .font(.system(size: 20, weight: .light))
                .foregroundStyle(ReaderTheme.muted.opacity(0.5))
            }
            if showProgress && pixels > 96 {
              ThumbnailLoadingArc(reduceMotion: reduceMotion).frame(width: 24, height: 24)
                .accessibilityHidden(true)
            }
          }.accessibilityLabel("Loading " + label.lowercased())
        }
      }
      .frame(width: geometry.size.width, height: geometry.size.height).clipped()
    }
    .onDisappear {
      requestID = UUID()
      loadedImage = nil
      preview = nil
      showProgress = false
    }
    .task(id: url.map { ThumbnailRequest(url: $0, pixels: pixels) }) {
      let request = UUID()
      requestID = request
      preview = nil
      showProgress = false
      loadedImage = ThumbnailCache.shared.image(for: url, pixels: pixels)
      guard loadedImage == nil, let url else { return }
      let indicator = Task {
        do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
        guard requestID == request, !Task.isCancelled else { return }
        showProgress = true
      }
      defer {
        indicator.cancel()
        if requestID == request { showProgress = false }
      }
      let placeholder = await ThumbnailCache.shared.placeholder(for: url)
      guard requestID == request, !Task.isCancelled else { return }
      preview = placeholder
      let image = await ThumbnailCache.shared.load(url, pixels: pixels)
      guard requestID == request, !Task.isCancelled else { return }
      loadedImage = image
    }
  }
}

/// Core Animation owns the repeating arc. SwiftUI gets no per-frame state updates.
/// Reduced Motion keeps a static partial ring; detachment removes both animations.
private struct ThumbnailLoadingArc: UIViewRepresentable {
  var reduceMotion: Bool
  func makeUIView(context: Context) -> ThumbnailArcView { ThumbnailArcView() }
  func updateUIView(_ view: ThumbnailArcView, context: Context) {
    view.setReducedMotion(reduceMotion)
  }
  static func dismantleUIView(_ view: ThumbnailArcView, coordinator: ()) { view.stop() }
}

private final class ThumbnailArcView: UIView {
  private let arc = CAShapeLayer()
  private let track = CAShapeLayer()
  private var reduceMotion = false

  init() {
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    for shape in [track, arc] {
      shape.fillColor = UIColor.clear.cgColor
      shape.lineWidth = 2
      shape.lineCap = .round
      layer.addSublayer(shape)
    }
    arc.strokeEnd = 0.25
    updateColours()
    registerForTraitChanges([UITraitUserInterfaceStyle.self, UITraitAccessibilityContrast.self]) {
      (view: ThumbnailArcView, _: UITraitCollection) in view.updateColours()
    }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func layoutSubviews() {
    super.layoutSubviews()
    let circle = UIBezierPath(ovalIn: bounds.insetBy(dx: 2, dy: 2)).cgPath
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for shape in [track, arc] {
      shape.frame = bounds
      shape.path = circle
    }
    CATransaction.commit()
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateAnimation()
  }
  func setReducedMotion(_ value: Bool) {
    guard value != reduceMotion else { return }
    reduceMotion = value
    updateAnimation()
  }
  func stop() { arc.removeAllAnimations() }
  private func updateColours() {
    arc.strokeColor = UIColor.secondaryLabel.resolvedColor(with: traitCollection).cgColor
    track.strokeColor =
      UIColor.secondaryLabel.resolvedColor(with: traitCollection).withAlphaComponent(0.15).cgColor
  }
  private func updateAnimation() {
    guard window != nil, !reduceMotion else {
      stop()
      return
    }
    guard arc.animation(forKey: "rotation") == nil else { return }
    let rotation = CABasicAnimation(keyPath: "transform.rotation.z")
    rotation.fromValue = 0
    rotation.toValue = Double.pi * 2
    rotation.duration = 1.4
    rotation.repeatCount = .infinity
    let length = CABasicAnimation(keyPath: "strokeEnd")
    length.fromValue = 0.12
    length.toValue = 0.8
    length.duration = 0.7
    length.autoreverses = true
    length.repeatCount = .infinity
    length.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    arc.add(rotation, forKey: "rotation")
    arc.add(length, forKey: "length")
  }
}

struct ArticleSearchRow: View {
  let article: SavedArticle
  let query: String
  @ScaledMetric(relativeTo: .body) private var thumbnailHeight = 74

  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      ArticleThumbnail(url: article.imageURL, pixels: 256)
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
  private let directory: URL

  init(directory: URL = URL.applicationSupportDirectory.appending(path: "ArticleReader/Images")) {
    self.directory = directory
  }
  private var lastTrim = Date.distantPast
  private var bytesSinceTrim = 0

  /// Persist only the app's three display sizes. Existing master images remain
  /// usable offline; derivatives are local, regenerable and share the disk budget.
  func thumbnailData(for url: URL, pixels: Int, prefetch: Bool = false) async -> Data? {
    guard [96, 256, 960].contains(pixels) else { return await data(for: url, prefetch: prefetch) }
    let file = imageFile(for: url).appendingPathExtension("thumb-v1-\(pixels)")
    if let bytes = read(file) { return bytes }
    guard !Task.isCancelled, let bytes = await data(for: url, prefetch: prefetch), !Task.isCancelled
    else { return nil }
    // Actor serialization bounds derivative encoding to one job. The caller's
    // URL+size lease already deduplicates this work across visible and prefetched rows.
    guard let thumbnail = PreviewImageCodec.displayThumbnail(bytes, pixels: pixels),
      !Task.isCancelled
    else { return nil }
    store(thumbnail, at: file)
    return thumbnail
  }

  func data(for url: URL, prefetch: Bool = false) async -> Data? {
    let file = imageFile(for: url)
    if let data = read(file) { return data }
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
      task = Task.detached(priority: prefetch ? .utility : .userInitiated) { () -> Data? in
        guard await work.acquire(prefetch: prefetch) else { return nil }
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
    // Concurrent size variants share one resource; only the first consumer stores it.
    guard !FileManager.default.fileExists(atPath: file.path) else { return bytes }
    store(bytes, at: file)
    if let tiny = PreviewImageCodec.placeholder(bytes) {
      store(tiny, at: file.appendingPathExtension("preview"))
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

  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpMaximumConnectionsPerHost = 3
    return URLSession(configuration: configuration)
  }()

  private nonisolated static func fetch(_ url: URL) async -> Data? {
    guard !Task.isCancelled else { return nil }
    let file: URL
    let temporary: Bool
    if TestMode.enabled && url.isFileURL {
      file = url
      temporary = false
    } else {
      guard ["http", "https"].contains(url.scheme ?? ""),
        let (download, response) = try? await session.download(
          for: URLRequest(url: url, timeoutInterval: 8))
      else { return nil }
      guard let response = response as? HTTPURLResponse,
        (200..<300).contains(response.statusCode)
      else {
        try? FileManager.default.removeItem(at: download)
        return nil
      }
      file = download
      temporary = true
    }
    defer { if temporary { try? FileManager.default.removeItem(at: file) } }
    guard !Task.isCancelled,
      let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
      size < 15_000_000,
      let bytes = try? Data(contentsOf: file, options: .mappedIfSafe)
    else { return nil }
    return PreviewImageCodec.compact(bytes)
  }

  /// A tiny local preview is available after the first download. It does not
  /// start network work or pretend to know colours before seeing the source.
  func preview(for url: URL) -> Data? {
    let image = imageFile(for: url)
    let preview = image.appendingPathExtension("preview")
    if let bytes = read(preview) { return bytes }
    // Previous app versions cached the compact image but not a tiny placeholder.
    // Regenerate locally once, including in offline mode; never refetch for a blur.
    guard !Task.isCancelled, let bytes = read(image),
      let tiny = PreviewImageCodec.placeholder(bytes), !Task.isCancelled
    else { return nil }
    store(tiny, at: preview)
    return tiny
  }

  private func imageFile(for url: URL) -> URL {
    let key = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }
      .joined()
    return directory.appending(path: key + ".image")
  }

  private func read(_ file: URL) -> Data? {
    guard let bytes = try? Data(contentsOf: file) else { return nil }
    try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
    return bytes
  }

  private func store(_ bytes: Data, at file: URL) {
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    do { try bytes.write(to: file, options: .atomic) } catch { return }
    // Include derivatives and placeholders in the same 128 MB budget.
    bytesSinceTrim += bytes.count
    if bytesSinceTrim >= 8_000_000 || Date().timeIntervalSince(lastTrim) > 60 {
      bytesSinceTrim = 0
      lastTrim = Date()
      trim()
    }
  }

  /// Reader text can use an existing local decoration without waiting for network work.
  func cachedDataURL(for value: String) -> String {
    guard let url = URL(string: value) else { return "" }
    guard let bytes = read(imageFile(for: url)) else {
      return ""
    }
    return PreviewImageCodec.webDataURL(bytes)
  }

  func dataURL(for value: String) async -> String {
    guard let url = URL(string: value), let bytes = await data(for: url) else { return "" }
    return PreviewImageCodec.webDataURL(bytes)
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

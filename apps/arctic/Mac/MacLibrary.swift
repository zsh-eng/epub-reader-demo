import AppKit
import CryptoKit
import SwiftUI

struct MacLibrary: View {
  @Bindable var workspace: MacWorkspace
  @State private var articles: [SavedArticle] = []
  @State private var revision = 0
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 5) {
          Text(workspace.folder.title).font(.system(size: 32, weight: .medium, design: .rounded))
          Text("\(articles.count) articles").font(.subheadline).foregroundStyle(.secondary)
        }
        Spacer()
        TextField("Search this collection", text: $workspace.search)
          .textFieldStyle(.roundedBorder).frame(width: 250).accessibilityIdentifier(
            "library-search")
      }.padding(28)
      if articles.isEmpty {
        ContentUnavailableView {
          Label(
            workspace.search.isEmpty ? "Room for a good read" : "No matching articles",
            systemImage: "mountain.2")
        } description: {
          Text(
            workspace.search.isEmpty
              ? "Open a link, or bring your reading list." : "Try a different title, source or tag."
          )
        } actions: {
          if workspace.search.isEmpty {
            Button("Open article") { workspace.showOpen = true }.buttonStyle(.borderedProminent)
            Button("Import Reading List…") { workspace.importList() }
          }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        MacArticleGrid(articles: articles, revision: revision, workspace: workspace)
      }
      if let summary = workspace.store.importSummary {
        HStack {
          Image(systemName: "sparkles").foregroundStyle(ArcticBrand.accent)
          Text("\(summary.previewsReady) of \(summary.total) previews ready")
          Spacer()
          Button("Done") { workspace.store.dismissImportSummary() }
        }.font(.caption).padding(14).background(.regularMaterial)
      }
    }
    .task(
      id: ProjectionKey(
        revision: workspace.store.libraryRevision, folder: workspace.folder, query: workspace.search
      )
    ) {
      let snapshot = workspace.store.articles
      let folder = workspace.folder
      let query = workspace.search.trimmingCharacters(in: .whitespacesAndNewlines)
      let projected = await Task.detached(priority: .userInitiated) {
        snapshot.filter {
          folder.contains($0)
            && (query.isEmpty
              || "\($0.title) \($0.subtitle) \($0.url.host ?? "") \($0.tagNames.joined(separator: " "))"
                .localizedStandardContains(query))
        }.sorted {
          (folder == .history ? $0.lastVisitedAt : $0.savedAt) ?? .distantPast
            > (folder == .history ? $1.lastVisitedAt : $1.savedAt) ?? .distantPast
        }
      }.value
      guard !Task.isCancelled else { return }
      articles = projected
      revision += 1
    }
  }
  private struct ProjectionKey: Equatable {
    let revision: Int
    let folder: MacLibraryFolder
    let query: String
  }
}

/// AppKit owns cell reuse and viewport observation. Scrolling does not publish
/// an offset into SwiftUI or create a view tree for every article.
struct MacArticleGrid: NSViewRepresentable {
  let articles: [SavedArticle]
  let revision: Int
  let workspace: MacWorkspace
  func makeCoordinator() -> Coordinator { Coordinator(workspace: workspace) }
  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSScrollView()
    let grid = NSCollectionView()
    grid.collectionViewLayout = MacGridLayout()
    grid.backgroundColors = [.clear]
    grid.isSelectable = true
    grid.allowsMultipleSelection = false
    grid.register(MacArticleItem.self, forItemWithIdentifier: .init("article"))
    grid.delegate = context.coordinator
    grid.dataSource = context.coordinator
    grid.setAccessibilityIdentifier("article-grid")
    scroll.documentView = grid
    scroll.hasVerticalScroller = true
    scroll.drawsBackground = false
    context.coordinator.grid = grid
    scroll.contentView.postsBoundsChangedNotifications = true
    context.coordinator.observer = NotificationCenter.default.addObserver(
      forName: NSView.boundsDidChangeNotification, object: scroll.contentView, queue: .main
    ) { [weak coordinator = context.coordinator] _ in
      MainActor.assumeIsolated { coordinator?.viewport() }
    }
    return scroll
  }
  func updateNSView(_ scroll: NSScrollView, context: Context) {
    guard context.coordinator.revision != revision else { return }
    context.coordinator.revision = revision
    context.coordinator.articles = articles
    context.coordinator.grid?.reloadData()
    context.coordinator.viewport()
  }
  static func dismantleNSView(_ view: NSScrollView, coordinator: Coordinator) {
    coordinator.dispose()
  }

  @MainActor final class Coordinator: NSObject, NSCollectionViewDataSource, NSCollectionViewDelegate
  {
    let workspace: MacWorkspace
    var articles: [SavedArticle] = []
    var revision = -1
    weak var grid: NSCollectionView?
    var observer: NSObjectProtocol?
    private var prefetch: Task<Void, Never>?
    init(workspace: MacWorkspace) { self.workspace = workspace }
    func collectionView(_ collectionView: NSCollectionView, numberOfItemsInSection section: Int)
      -> Int
    { articles.count }
    func collectionView(
      _ collectionView: NSCollectionView, itemForRepresentedObjectAt path: IndexPath
    ) -> NSCollectionViewItem {
      let item =
        collectionView.makeItem(withIdentifier: .init("article"), for: path) as! MacArticleItem
      let article = articles[path.item]
      item.configure(article)
      (item.view as? MacArticleCardView)?.open = { [weak workspace] in
        workspace?.open(
          article.url, title: article.title,
          background: NSApp.currentEvent?.modifierFlags.contains(.command) == true)
      }
      return item
    }
    func collectionView(_ collectionView: NSCollectionView, didSelectItemsAt paths: Set<IndexPath>)
    {
      guard let path = paths.first, articles.indices.contains(path.item) else { return }
      let article = articles[path.item]
      collectionView.deselectItems(at: paths)
      workspace.open(
        article.url, title: article.title,
        background: NSApp.currentEvent?.modifierFlags.contains(.command) == true)
    }
    func viewport() {
      prefetch?.cancel()
      guard let grid, !articles.isEmpty else { return }
      workspace.store.setLibraryScrolling(true)
      prefetch = Task { [weak self, weak grid] in
        do { try await Task.sleep(for: .milliseconds(120)) } catch { return }
        guard let self, let grid else { return }
        workspace.store.setLibraryScrolling(false)
        let visible = grid.indexPathsForVisibleItems().map(\.item)
        guard let first = visible.min(), let last = visible.max() else { return }
        let nearby = Array(articles[max(0, first - 4)..<min(articles.count, last + 5)])
        workspace.store.prioritizePreviews(nearby.map(\.url))
        for article in nearby {
          guard !Task.isCancelled else { return }
          if let url = article.imageURL {
            _ = await MacThumbnailCache.shared.image(url, prefetch: true)
          }
        }
      }
    }
    func dispose() {
      if let observer { NotificationCenter.default.removeObserver(observer) }
      prefetch?.cancel()
      workspace.store.setLibraryScrolling(false)
    }
  }
}

/// Adapt columns only when the viewport width changes, not on every scroll tick.
private final class MacGridLayout: NSCollectionViewFlowLayout {
  override func prepare() {
    let available = max(1, (collectionView?.enclosingScrollView?.contentSize.width ?? 760) - 56)
    let columns = max(1, floor((available + 20) / 240))
    let width = floor((available - (columns - 1) * 20) / columns)
    itemSize = NSSize(width: width, height: width * 0.61 + 76)
    minimumInteritemSpacing = 20
    minimumLineSpacing = 24
    sectionInset = NSEdgeInsets(top: 0, left: 28, bottom: 28, right: 28)
    super.prepare()
  }
  override func shouldInvalidateLayout(forBoundsChange newBounds: NSRect) -> Bool {
    newBounds.width != collectionView?.bounds.width
  }
}

@MainActor final class MacArticleItem: NSCollectionViewItem {
  private let thumbnail = NSView()
  private let titleLabel = NSTextField(wrappingLabelWithString: "")
  private let detail = NSTextField(labelWithString: "")
  private var imageTask: Task<Void, Never>?
  private var identity: UUID?
  override func loadView() {
    view = MacArticleCardView()
    thumbnail.wantsLayer = true
    thumbnail.layer?.contentsGravity = .resizeAspectFill
    thumbnail.layer?.cornerRadius = 10
    thumbnail.layer?.masksToBounds = true
    thumbnail.layer?.backgroundColor = NSColor.quaternaryLabelColor.withAlphaComponent(0.08).cgColor
    titleLabel.font = .systemFont(ofSize: 15, weight: .medium)
    titleLabel.maximumNumberOfLines = 2
    titleLabel.lineBreakMode = .byWordWrapping
    (titleLabel.cell as? NSTextFieldCell)?.truncatesLastVisibleLine = true
    titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    detail.font = .systemFont(ofSize: 11)
    detail.textColor = .secondaryLabelColor
    detail.lineBreakMode = .byTruncatingTail
    for child in [thumbnail, titleLabel, detail] {
      child.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(child)
    }
    NSLayoutConstraint.activate([
      thumbnail.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      thumbnail.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      thumbnail.topAnchor.constraint(equalTo: view.topAnchor),
      thumbnail.heightAnchor.constraint(equalTo: thumbnail.widthAnchor, multiplier: 0.61),
      titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      titleLabel.topAnchor.constraint(equalTo: thumbnail.bottomAnchor, constant: 10),
      detail.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
      detail.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
      detail.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 5),
    ])
  }
  func configure(_ article: SavedArticle) {
    imageTask?.cancel()
    identity = article.id
    titleLabel.stringValue = article.title
    detail.stringValue = ([article.url.host ?? ""] + article.tagNames.prefix(1)).joined(
      separator: "  ·  ")
    thumbnail.layer?.contents = nil
    view.setAccessibilityLabel(article.title)
    guard let url = article.imageURL else { return }
    imageTask = Task { [weak self] in
      let image = await MacThumbnailCache.shared.image(url)
      guard !Task.isCancelled, let self, identity == article.id, let image else { return }
      thumbnail.layer?.contents = image
    }
  }
  override func prepareForReuse() {
    super.prepareForReuse()
    imageTask?.cancel()
    identity = nil
    thumbnail.layer?.contents = nil
  }
}

/// Labels are display-only. The card owns click and accessibility activation so
/// a click on its title cannot be swallowed by an NSTextField editor.
private final class MacArticleCardView: NSView {
  var open: (() -> Void)?
  override func hitTest(_ point: NSPoint) -> NSView? {
    bounds.contains(convert(point, from: superview)) ? self : nil
  }
  override func mouseDown(with event: NSEvent) { open?() }
  override func isAccessibilityElement() -> Bool { true }
  override func accessibilityRole() -> NSAccessibility.Role? { .button }
  override func accessibilityChildren() -> [Any]? { [] }
  override func accessibilityPerformPress() -> Bool {
    open?()
    return true
  }
}

/// The Retina grid uses a 640 px derivative. Originals never enter the durable
/// cache. ImageIO decode and disk operations stay outside the main actor.
actor MacThumbnailCache {
  static let shared = MacThumbnailCache()
  private let memory = NSCache<NSURL, CGImage>()
  private let workers = PreviewImageWorkLimit(limit: 3)
  private let directory = URL.cachesDirectory.appending(path: "ArcticMacThumbnails-640")
  private struct Request {
    let id = UUID()
    let task: Task<CGImage?, Never>
    var leases: Set<UUID>
  }
  private var pending: [URL: Request] = [:]
  private var writesSinceTrim = 0
  private let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 15
    configuration.timeoutIntervalForResource = 25
    configuration.urlCache = nil
    return URLSession(configuration: configuration)
  }()
  init() {
    memory.totalCostLimit = 48 * 1024 * 1024
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }
  func image(_ url: URL, prefetch: Bool = false) async -> CGImage? {
    guard !Task.isCancelled else { return nil }
    if let image = memory.object(forKey: url as NSURL) { return image }
    let lease = UUID()
    if pending[url] != nil {
      pending[url]?.leases.insert(lease)
    } else {
      let path = directory.appending(
        path: SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }
          .joined())
      let workers = workers
      let session = session
      let task = Task<CGImage?, Never> {
        guard await workers.acquire(prefetch: prefetch) else { return nil }
        let worker = Task.detached(priority: prefetch ? .utility : .userInitiated) {
          () -> CGImage? in
          do {
            try Task.checkCancellation()
            if let bytes = try? Data(contentsOf: path),
              let image = PreviewImageCodec.thumbnail(bytes, pixels: 640)
            {
              return image
            }
            let (temp, response) = try await session.download(from: url)
            defer { try? FileManager.default.removeItem(at: temp) }
            try Task.checkCancellation()
            guard
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true,
              (try temp.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 8 * 1024 * 1024,
              let bytes = PreviewImageCodec.displayThumbnail(
                try Data(contentsOf: temp), pixels: 640),
              let image = PreviewImageCodec.thumbnail(bytes, pixels: 640)
            else { return nil }
            try Task.checkCancellation()
            try bytes.write(to: path, options: .atomic)
            return image
          } catch { return nil }
        }
        let result = await withTaskCancellationHandler {
          await worker.value
        } onCancel: {
          worker.cancel()
        }
        await workers.release()
        return result
      }
      pending[url] = Request(task: task, leases: [lease])
    }
    guard let request = pending[url] else { return nil }
    let image = await withTaskCancellationHandler {
      await request.task.value
    } onCancel: {
      Task { await self.release(url, lease: lease, request: request.id) }
    }
    release(url, lease: lease, request: request.id)
    guard !Task.isCancelled else { return nil }
    if let image {
      memory.setObject(image, forKey: url as NSURL, cost: image.bytesPerRow * image.height)
      writesSinceTrim += 1
      if writesSinceTrim >= 24 {
        writesSinceTrim = 0
        trimDisk()
      }
    }
    return image
  }

  private func release(_ url: URL, lease: UUID, request: UUID) {
    guard pending[url]?.id == request else { return }
    pending[url]?.leases.remove(lease)
    if pending[url]?.leases.isEmpty == true { pending.removeValue(forKey: url)?.task.cancel() }
  }

  private func trimDisk() {
    guard
      let files = try? FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])
    else { return }
    let entries = files.compactMap { url -> (URL, Int, Date)? in
      guard
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
      else { return nil }
      return (url, values.fileSize ?? 0, values.contentModificationDate ?? .distantPast)
    }.sorted { $0.2 < $1.2 }
    var total = entries.reduce(0) { $0 + $1.1 }
    for (url, size, _) in entries where total > 64 * 1024 * 1024 {
      do {
        try FileManager.default.removeItem(at: url)
        total -= size
      } catch { continue }
    }
  }
}

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
        MacArticleList(articles: articles, revision: revision, workspace: workspace)
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

/// AppKit recycles a small number of cells. SwiftUI never builds a view tree for
/// every article. Viewport callbacks do not publish state to the parent view.
struct MacArticleList: NSViewRepresentable {
  let articles: [SavedArticle]
  let revision: Int
  let workspace: MacWorkspace
  func makeCoordinator() -> Coordinator { Coordinator(workspace: workspace) }
  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSScrollView()
    let table = MacArticleTable()
    table.headerView = nil
    table.style = .plain
    table.backgroundColor = .clear
    table.rowHeight = 88
    table.intercellSpacing = NSSize(width: 0, height: 0)
    table.addTableColumn(NSTableColumn(identifier: NSUserInterfaceItemIdentifier("article")))
    table.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
    table.delegate = context.coordinator
    table.dataSource = context.coordinator
    table.target = context.coordinator
    table.action = #selector(Coordinator.openRow)
    table.setAccessibilityIdentifier("article-list")
    scroll.documentView = table
    scroll.hasVerticalScroller = true
    scroll.drawsBackground = false
    context.coordinator.table = table
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
    context.coordinator.table?.reloadData()
    context.coordinator.viewport()
  }
  static func dismantleNSView(_ view: NSScrollView, coordinator: Coordinator) {
    coordinator.dispose()
  }

  @MainActor final class Coordinator: NSObject, NSTableViewDataSource, NSTableViewDelegate {
    let workspace: MacWorkspace
    var articles: [SavedArticle] = []
    var revision = -1
    weak var table: NSTableView?
    var observer: NSObjectProtocol?
    private var prefetch: Task<Void, Never>?
    init(workspace: MacWorkspace) { self.workspace = workspace }
    func numberOfRows(in tableView: NSTableView) -> Int { articles.count }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int)
      -> NSView?
    {
      let id = NSUserInterfaceItemIdentifier("article-cell")
      let cell =
        tableView.makeView(withIdentifier: id, owner: nil) as? MacArticleCell ?? MacArticleCell()
      cell.identifier = id
      cell.configure(articles[row])
      return cell
    }
    @objc func openRow() {
      guard let table,
        articles.indices.contains(table.clickedRow >= 0 ? table.clickedRow : table.selectedRow)
      else { return }
      let article = articles[table.clickedRow >= 0 ? table.clickedRow : table.selectedRow]
      workspace.open(
        article.url, title: article.title,
        background: NSApp.currentEvent?.modifierFlags.contains(.command) == true)
    }
    func viewport() {
      prefetch?.cancel()
      guard let table, !articles.isEmpty else { return }
      let visible = table.rows(in: table.visibleRect)
      guard visible.location != NSNotFound else { return }
      let lower = max(0, visible.location - 2)
      let upper = min(articles.count, visible.location + visible.length + 2)
      guard lower < upper else { return }
      let nearby = Array(articles[lower..<upper])
      workspace.store.setLibraryScrolling(true)
      prefetch = Task { [weak self] in
        do { try await Task.sleep(for: .milliseconds(140)) } catch { return }
        guard let self else { return }
        workspace.store.setLibraryScrolling(false)
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

@MainActor final class MacArticleCell: NSTableCellView {
  private let thumbnail = NSImageView()
  private let title = NSTextField(wrappingLabelWithString: "")
  private let detail = NSTextField(labelWithString: "")
  private var imageTask: Task<Void, Never>?
  private var identity: UUID?
  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    thumbnail.imageScaling = .scaleProportionallyUpOrDown
    thumbnail.wantsLayer = true
    thumbnail.layer?.cornerRadius = 9
    thumbnail.layer?.masksToBounds = true
    title.font = .systemFont(ofSize: 15, weight: .medium)
    title.maximumNumberOfLines = 2
    title.lineBreakMode = .byTruncatingTail
    detail.font = .systemFont(ofSize: 11)
    detail.textColor = .secondaryLabelColor
    detail.lineBreakMode = .byTruncatingTail
    for view in [thumbnail, title, detail] {
      view.translatesAutoresizingMaskIntoConstraints = false
      addSubview(view)
    }
    NSLayoutConstraint.activate([
      thumbnail.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 28),
      thumbnail.centerYAnchor.constraint(equalTo: centerYAnchor),
      thumbnail.widthAnchor.constraint(equalToConstant: 92),
      thumbnail.heightAnchor.constraint(equalToConstant: 66),
      title.leadingAnchor.constraint(equalTo: thumbnail.trailingAnchor, constant: 16),
      title.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -28),
      title.topAnchor.constraint(equalTo: topAnchor, constant: 17),
      detail.leadingAnchor.constraint(equalTo: title.leadingAnchor),
      detail.trailingAnchor.constraint(equalTo: title.trailingAnchor),
      detail.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 6),
      detail.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor, constant: -10),
    ])
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  func configure(_ article: SavedArticle) {
    imageTask?.cancel()
    identity = article.id
    title.stringValue = article.title
    detail.stringValue = ([article.url.host ?? ""] + article.tagNames.prefix(2)).joined(
      separator: "  ·  ")
    thumbnail.image = NSImage(systemSymbolName: "doc.text", accessibilityDescription: nil)
    thumbnail.contentTintColor = .tertiaryLabelColor
    setAccessibilityLabel(article.title)
    guard let url = article.imageURL else { return }
    imageTask = Task { [weak self] in
      let image = await MacThumbnailCache.shared.image(url)
      guard !Task.isCancelled, let self, identity == article.id, let image else { return }
      thumbnail.image = NSImage(
        cgImage: image, size: NSSize(width: image.width, height: image.height))
      thumbnail.contentTintColor = nil
    }
  }
  override func viewDidMoveToWindow() {
    if window == nil { imageTask?.cancel() }
  }
}

/// The Mac list needs only a 256 px derivative. Originals never enter the durable
/// cache. ImageIO decode and disk operations stay outside the main actor.
actor MacThumbnailCache {
  static let shared = MacThumbnailCache()
  private let memory = NSCache<NSURL, CGImage>()
  private let workers = PreviewImageWorkLimit(limit: 3)
  private let directory = URL.cachesDirectory.appending(path: "ArcticMacThumbnails")
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
    memory.totalCostLimit = 24 * 1024 * 1024
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
              let image = PreviewImageCodec.thumbnail(bytes, pixels: 256)
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
                try Data(contentsOf: temp), pixels: 256),
              let image = PreviewImageCodec.thumbnail(bytes, pixels: 256)
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

/// Return activates the selected row; arrow keys retain normal table navigation.
private final class MacArticleTable: NSTableView {
  override func keyDown(with event: NSEvent) {
    if [36, 76].contains(event.keyCode), selectedRow >= 0, let action {
      NSApp.sendAction(action, to: target, from: self)
      return
    }
    super.keyDown(with: event)
  }
}

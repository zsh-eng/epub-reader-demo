import AppKit
import SwiftUI

/// Construct once with the workspace. Opening only orders this warmed panel and
/// focuses its existing field: no sheet animation, disk read or result-layout wait.
struct MacCommandPaletteHost: NSViewRepresentable {
  let workspace: MacWorkspace
  let isPresented: Bool
  let revision: Int
  func makeNSView(context: Context) -> Host { Host(workspace: workspace) }
  func updateNSView(_ host: Host, context: Context) {
    host.palette.updateIndex(workspace.store.articles, revision: revision)
    if isPresented, let window = host.window { host.palette.show(in: window) }
    if !isPresented { host.palette.hide() }
  }
  static func dismantleNSView(_ host: Host, coordinator: ()) { host.palette.hide() }
  final class Host: NSView {
    let palette: MacCommandPalette
    init(workspace: MacWorkspace) {
      palette = MacCommandPalette(workspace: workspace)
      super.init(frame: .zero)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  }
}

@MainActor
final class MacCommandPalette: NSObject, NSTextFieldDelegate, NSTableViewDataSource,
  NSTableViewDelegate, NSWindowDelegate
{
  private let workspace: MacWorkspace
  let panel = PalettePanel(
    contentRect: NSRect(x: 0, y: 0, width: 620, height: 490),
    styleMask: [.borderless], backing: .buffered, defer: false)
  let input = NSTextField()
  let table = NSTableView()
  private let section = NSTextField(labelWithString: "RECENT")
  private let empty = NSTextField(labelWithString: "No matching articles")
  private var index: [SavedArticle] = []
  private var matches: [SavedArticle] = []
  private var revision = -1
  private var searchTask: Task<Void, Never>?
  private weak var owner: NSWindow?
  private weak var previousResponder: NSResponder?
  private var hiding = false
  private var resolvedQuery = ""
  private var pendingSubmit = false
  private var link: URL? { SharedInbox.webURL(input.stringValue) }

  init(workspace: MacWorkspace) {
    self.workspace = workspace
    super.init()
    panel.animationBehavior = .none
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.isReleasedWhenClosed = false
    panel.delegate = self
    panel.setAccessibilityIdentifier("command-palette")
    let surface = NSVisualEffectView()
    surface.material = .popover
    surface.blendingMode = .behindWindow
    surface.state = .active
    surface.wantsLayer = true
    surface.layer?.cornerRadius = 18
    surface.layer?.masksToBounds = true
    panel.contentView = surface

    input.isBordered = false
    input.drawsBackground = false
    input.focusRingType = .none
    input.font = .systemFont(ofSize: 19)
    input.placeholderString = "Search articles or paste a link…"
    input.delegate = self
    input.setAccessibilityIdentifier("open-input")
    let icon = NSImageView(
      image: NSImage(systemSymbolName: "magnifyingglass", accessibilityDescription: nil)!)
    icon.contentTintColor = .secondaryLabelColor
    let line = NSBox()
    line.boxType = .separator
    section.font = .systemFont(ofSize: 10, weight: .semibold)
    section.textColor = .secondaryLabelColor
    empty.font = .systemFont(ofSize: 14)
    empty.textColor = .secondaryLabelColor
    empty.isHidden = true
    let column = NSTableColumn(identifier: .init("article"))
    column.width = 600
    table.addTableColumn(column)
    table.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
    table.headerView = nil
    table.rowHeight = 49
    table.intercellSpacing = .zero
    table.backgroundColor = .clear
    table.focusRingType = .none
    table.allowsEmptySelection = false
    table.delegate = self
    table.dataSource = self
    table.target = self
    table.action = #selector(activate)
    table.setAccessibilityIdentifier("open-results")
    let scroll = NSScrollView()
    scroll.drawsBackground = false
    scroll.documentView = table
    scroll.hasVerticalScroller = false
    let footerLine = NSBox()
    footerLine.boxType = .separator
    let brand = NSTextField(labelWithString: "Arctic")
    brand.font = .systemFont(ofSize: 12, weight: .medium)
    brand.textColor = .secondaryLabelColor
    let keys = NSTextField(labelWithString: "↑ ↓  Select      ↵  Open      esc  Close")
    keys.font = .systemFont(ofSize: 11)
    keys.textColor = .tertiaryLabelColor
    for view in [icon, input, line, section, scroll, empty, footerLine, brand, keys] {
      view.translatesAutoresizingMaskIntoConstraints = false
      surface.addSubview(view)
    }
    NSLayoutConstraint.activate([
      icon.leadingAnchor.constraint(equalTo: surface.leadingAnchor, constant: 22),
      icon.topAnchor.constraint(equalTo: surface.topAnchor, constant: 23),
      icon.widthAnchor.constraint(equalToConstant: 19),
      icon.heightAnchor.constraint(equalToConstant: 19),
      input.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 13),
      input.centerYAnchor.constraint(equalTo: icon.centerYAnchor),
      input.trailingAnchor.constraint(equalTo: surface.trailingAnchor, constant: -22),
      line.leadingAnchor.constraint(equalTo: surface.leadingAnchor),
      line.trailingAnchor.constraint(equalTo: surface.trailingAnchor),
      line.topAnchor.constraint(equalTo: surface.topAnchor, constant: 65),
      section.leadingAnchor.constraint(equalTo: surface.leadingAnchor, constant: 23),
      section.topAnchor.constraint(equalTo: line.bottomAnchor, constant: 14),
      scroll.topAnchor.constraint(equalTo: surface.topAnchor, constant: 96),
      scroll.leadingAnchor.constraint(equalTo: surface.leadingAnchor, constant: 10),
      scroll.trailingAnchor.constraint(equalTo: surface.trailingAnchor, constant: -10),
      scroll.bottomAnchor.constraint(equalTo: surface.bottomAnchor, constant: -40),
      empty.centerXAnchor.constraint(equalTo: scroll.centerXAnchor),
      empty.centerYAnchor.constraint(equalTo: scroll.centerYAnchor),
      footerLine.leadingAnchor.constraint(equalTo: surface.leadingAnchor),
      footerLine.trailingAnchor.constraint(equalTo: surface.trailingAnchor),
      footerLine.bottomAnchor.constraint(equalTo: surface.bottomAnchor, constant: -37),
      brand.leadingAnchor.constraint(equalTo: surface.leadingAnchor, constant: 22),
      brand.bottomAnchor.constraint(equalTo: surface.bottomAnchor, constant: -12),
      keys.trailingAnchor.constraint(equalTo: surface.trailingAnchor, constant: -22),
      keys.centerYAnchor.constraint(equalTo: brand.centerYAnchor),
    ])
    updateIndex(workspace.store.articles, revision: workspace.store.libraryRevision)
    surface.layoutSubtreeIfNeeded()
  }

  func updateIndex(_ articles: [SavedArticle], revision: Int) {
    guard self.revision != revision else { return }
    self.revision = revision
    index = articles
    search()
  }
  func show(in window: NSWindow) {
    guard !panel.isVisible else { return }
    owner = window
    previousResponder = window.firstResponder
    let area = window.screen?.visibleFrame ?? window.frame
    let x = min(max(window.frame.midX - 310, area.minX), area.maxX - 620)
    let y = max(area.minY, min(window.frame.maxY - 110 - 490, area.maxY - 490))
    panel.setFrameOrigin(NSPoint(x: x, y: y))
    window.addChildWindow(panel, ordered: .above)
    panel.makeKeyAndOrderFront(nil)
    panel.makeFirstResponder(input)
  }
  func hide() {
    guard panel.isVisible, !hiding else { return }
    hiding = true
    panel.orderOut(nil)
    owner?.removeChildWindow(panel)
    workspace.showOpen = false
    input.stringValue = ""
    search()
    hiding = false
  }
  func windowDidResignKey(_ notification: Notification) { hide() }
  func controlTextDidChange(_ notification: Notification) { search() }
  func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
    switch selector {
    case #selector(NSResponder.moveDown(_:)): move(1)
    case #selector(NSResponder.moveUp(_:)): move(-1)
    case #selector(NSResponder.insertNewline(_:)): activate()
    case #selector(NSResponder.cancelOperation(_:)):
      if input.stringValue.isEmpty {
        dismiss()
      } else {
        input.stringValue = ""
        search()
      }
    default: return false
    }
    return true
  }
  private func dismiss() {
    hide()
    owner?.makeKey()
    if let previousResponder { owner?.makeFirstResponder(previousResponder) }
  }
  private func search() {
    searchTask?.cancel()
    pendingSubmit = false
    let query = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    section.stringValue = link != nil ? "OPEN LINK" : query.isEmpty ? "RECENT" : "ARTICLES"
    if query.isEmpty || link != nil {
      apply(query.isEmpty ? Array(index.prefix(7)) : [])
      return
    }
    let snapshot = index
    searchTask = Task { [weak self] in
      let result = await Task.detached(priority: .userInitiated) {
        Array(
          snapshot.lazy.filter {
            $0.title.localizedStandardContains(query)
              || $0.url.absoluteString.localizedStandardContains(query)
              || $0.tagNames.contains { $0.localizedStandardContains(query) }
          }.prefix(7))
      }.value
      guard !Task.isCancelled else { return }
      self?.apply(result)
    }
  }
  private func apply(_ result: [SavedArticle]) {
    let selectedURL =
      resolvedQuery == input.stringValue && matches.indices.contains(table.selectedRow)
      ? matches[table.selectedRow].url : nil
    matches = result
    resolvedQuery = input.stringValue
    table.reloadData()
    empty.isHidden = numberOfRows(in: table) != 0
    if numberOfRows(in: table) > 0 {
      let row = matches.firstIndex { $0.url == selectedURL } ?? 0
      table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
    }
    if pendingSubmit {
      pendingSubmit = false
      activate()
    }
  }
  private func move(_ delta: Int) {
    let count = numberOfRows(in: table)
    guard count > 0 else { return }
    let row = (max(0, table.selectedRow) + delta + count) % count
    table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
    table.scrollRowToVisible(row)
  }
  @objc private func activate() {
    if let link {
      dismiss()
      workspace.open(link)
      return
    }
    guard resolvedQuery == input.stringValue else {
      pendingSubmit = true
      return
    }
    guard matches.indices.contains(table.selectedRow) else { return }
    let article = matches[table.selectedRow]
    dismiss()
    workspace.open(article.url, title: article.title)
  }
  func numberOfRows(in tableView: NSTableView) -> Int { link != nil ? 1 : matches.count }
  func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
    PaletteRow()
  }
  func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView?
  {
    let id = NSUserInterfaceItemIdentifier("result")
    let cell = tableView.makeView(withIdentifier: id, owner: nil) as? PaletteCell ?? PaletteCell()
    cell.identifier = id
    if let link {
      cell.title.stringValue = "Open article"
      cell.source.stringValue = link.absoluteString
    } else {
      cell.title.stringValue = matches[row].title
      cell.source.stringValue = matches[row].url.host ?? ""
    }
    return cell
  }
  final class PalettePanel: NSPanel { override var canBecomeKey: Bool { true } }
  private final class PaletteRow: NSTableRowView {
    override func drawSelection(in dirtyRect: NSRect) {
      NSColor.labelColor.withAlphaComponent(0.07).setFill()
      NSBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 1), xRadius: 9, yRadius: 9).fill()
    }
  }
  private final class PaletteCell: NSTableCellView {
    let title = NSTextField(labelWithString: "")
    let source = NSTextField(labelWithString: "")
    override init(frame: NSRect) {
      super.init(frame: frame)
      title.font = .systemFont(ofSize: 14, weight: .medium)
      source.font = .systemFont(ofSize: 11)
      source.textColor = .secondaryLabelColor
      for label in [title, source] {
        label.lineBreakMode = .byTruncatingTail
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
      }
      NSLayoutConstraint.activate([
        title.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 13),
        title.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -13),
        title.topAnchor.constraint(equalTo: topAnchor, constant: 7),
        source.leadingAnchor.constraint(equalTo: title.leadingAnchor),
        source.trailingAnchor.constraint(equalTo: title.trailingAnchor),
        source.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 3),
      ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  }
}

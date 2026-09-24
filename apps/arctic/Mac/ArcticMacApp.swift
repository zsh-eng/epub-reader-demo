import AppKit
import SwiftUI

@main struct ArcticMacApp: App {
  @State private var workspace = MacWorkspace()
  var body: some Scene {
    Window("Arctic", id: "arctic") {
      MacWorkspaceView(workspace: workspace)
        .frame(minWidth: 760, minHeight: 540)
        .tint(ArcticBrand.accent)
        .onDisappear { workspace.shutDown() }
    }
    .defaultSize(width: 1240, height: 840)
    .windowToolbarStyle(.unifiedCompact)
    .commands { MacCommands(workspace: workspace) }
  }
}

/// Commands and the help panel use the same catalogue, so shortcut labels cannot drift.
enum MacShortcut: String, CaseIterable, Identifiable {
  case open, library, sidebar, notes, next, previous, close, reopen, save, find, refresh, highlight,
    shortcuts, importList, settings
  var id: String { rawValue }
  var title: String {
    switch self {
    case .open: "Open link or find article"
    case .library: "Show library"
    case .sidebar: "Toggle sidebar"
    case .notes: "Toggle notes"
    case .next: "Next article"
    case .previous: "Previous article"
    case .close: "Close article"
    case .reopen: "Reopen closed article"
    case .save: "Save article"
    case .find: "Find in article"
    case .refresh: "Refresh Reader"
    case .highlight: "Highlight selection"
    case .shortcuts: "Keyboard shortcuts"
    case .importList: "Import Reading List"
    case .settings: "Automatic tags"
    }
  }
  var key: KeyEquivalent {
    switch self {
    case .open: "k"
    case .library: "l"
    case .sidebar: "s"
    case .notes: "n"
    case .next: "]"
    case .previous: "["
    case .close: "w"
    case .reopen: "t"
    case .save: "s"
    case .find: "f"
    case .refresh: "r"
    case .highlight: "h"
    case .shortcuts: "/"
    case .importList: "i"
    case .settings: ","
    }
  }
  var modifiers: EventModifiers {
    [.sidebar, .notes, .next, .previous, .reopen, .highlight, .shortcuts, .importList].contains(
      self)
      ? [.command, .shift] : .command
  }
  var keys: String {
    (modifiers.contains(.shift) ? "⇧" : "") + "⌘" + String(key.character).uppercased()
  }
  @MainActor func perform(_ w: MacWorkspace) {
    switch self {
    case .open: w.showOpen = true
    case .library: w.library()
    case .sidebar: w.sidebarVisible.toggle()
    case .notes: w.showNotes.toggle()
    case .next: w.cycle(1)
    case .previous: w.cycle(-1)
    case .close: if let url = w.selectedURL { w.close(url) }
    case .reopen: w.reopen()
    case .save: w.saveCurrent()
    case .find: w.selectedReader?.showFind = true
    case .refresh: w.selectedReader?.refresh()
    case .highlight: w.selectedReader?.highlight()
    case .shortcuts: w.showShortcuts = true
    case .importList: w.importList()
    case .settings: w.showSettings = true
    }
  }
}

struct MacCommands: Commands {
  let workspace: MacWorkspace
  var body: some Commands {
    CommandGroup(replacing: .newItem) {
      shortcut(.open)
      shortcut(.importList)
    }
    CommandGroup(replacing: .saveItem) { shortcut(.save) }
    CommandGroup(replacing: .help) { shortcut(.shortcuts) }
    CommandGroup(after: .sidebar) {
      shortcut(.sidebar)
      shortcut(.library)
      shortcut(.notes)
    }
    CommandMenu("Article") {
      shortcut(.next)
      shortcut(.previous)
      Divider()
      shortcut(.close)
      shortcut(.reopen)
      Divider()
      shortcut(.find)
      shortcut(.highlight)
      shortcut(.refresh)
    }
    CommandGroup(replacing: .appSettings) {
      shortcut(.settings)
    }
  }
  private func shortcut(_ action: MacShortcut) -> some View {
    Button(action.title) { action.perform(workspace) }
      .keyboardShortcut(action.key, modifiers: action.modifiers)
  }
}

struct MacWorkspaceView: View {
  @Bindable var workspace: MacWorkspace
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase
  @State private var visibility: NavigationSplitViewVisibility = .all
  @State private var keyMonitor: Any?
  @Namespace private var selection

  private var layout: some View {
    NavigationSplitView(columnVisibility: $visibility) {
      sidebar.navigationSplitViewColumnWidth(min: 205, ideal: 245, max: 340)
    } detail: {
      Group {
        if let reader = workspace.selectedReader {
          HStack(spacing: 0) {
            MacReaderPane(reader: reader, workspace: workspace)
            if workspace.showNotes {
              Divider()
              MacNotesPane(workspace: workspace, reader: reader).frame(width: 310)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
          }
        } else if workspace.showNotebook {
          MacNotebook(workspace: workspace)
        } else {
          MacLibrary(workspace: workspace)
        }
      }
      .background(Color(nsColor: .textBackgroundColor))
      .toolbar { workspaceToolbar }
    }
  }

  private var blocksReading: Bool {
    workspace.showNotes || workspace.showOpen || workspace.showShortcuts || workspace.showStats
      || workspace.showSettings
  }

  private var observedLayout: some View {
    layout
      .animation(
        reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 1), value: workspace.showNotes
      )
      .onChange(of: workspace.sidebarVisible) { _, visible in
        withAnimation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 1)) {
          visibility = visible ? .all : .detailOnly
        }
      }
      .onChange(of: visibility) { _, value in workspace.sidebarVisible = value != .detailOnly }
      .onChange(of: scenePhase) { _, phase in workspace.windowActive = phase == .active }
      .onChange(of: blocksReading) { workspace.updateActivity() }
      .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification))
    { _ in workspace.shutDown() }
  }

  var body: some View {
    observedLayout
      .sheet(isPresented: $workspace.showOpen) { MacOpenPanel(workspace: workspace) }
      .sheet(isPresented: $workspace.showShortcuts) { MacShortcutsPanel() }
      .sheet(isPresented: $workspace.showStats) { MacStatsPanel() }
      .sheet(isPresented: $workspace.showSettings) { MacTaggingSettings(workspace: workspace) }
      .alert(
        "Arctic",
        isPresented: Binding(
          get: { workspace.error != nil || workspace.store.errorMessage != nil },
          set: {
            if !$0 {
              workspace.error = nil
              workspace.store.errorMessage = nil
            }
          })
      ) {
        Button("OK") {
          workspace.error = nil
          workspace.store.errorMessage = nil
        }
      } message: {
        Text(workspace.error ?? workspace.store.errorMessage ?? "")
      }
      .overlay(alignment: .bottom) {
        if let undo = workspace.store.archiveUndo {
          HStack {
            Image(systemName: "archivebox")
            Text(undo.message)
            Button("Undo") { workspace.store.undoArchive(undo.id) }.buttonStyle(.bordered)
            Button {
              workspace.store.archiveUndo = nil
            } label: {
              Image(systemName: "xmark")
            }
            .buttonStyle(.plain).accessibilityLabel("Dismiss")
          }.padding(12).background(.regularMaterial, in: Capsule()).padding(20)
        }
      }
      .onAppear { installKeyMonitor() }
      .onDisappear { if let keyMonitor { NSEvent.removeMonitor(keyMonitor) } }
  }

  @ToolbarContentBuilder private var workspaceToolbar: some ToolbarContent {

    ToolbarItem(placement: .navigation) {
      Button {
        workspace.library()
      } label: {
        Image(systemName: "square.grid.2x2")
      }
      .help("Library · ⌘L").accessibilityLabel("Show library")
    }
    ToolbarItem(placement: .principal) {
      Text(
        workspace.selectedTab?.title
          ?? (workspace.showNotebook ? "Notebook" : workspace.folder.title)
      )
      .font(.system(size: 13, weight: .medium)).lineLimit(1)
    }
    ToolbarItemGroup(placement: .primaryAction) {
      if let reader = workspace.selectedReader {
        Button {
          reader.toggleWebsite()
        } label: {
          Image(systemName: reader.websiteVisible ? "doc.richtext" : "globe")
        }.help(reader.websiteVisible ? "Show Reader" : "Show website")
        Button {
          workspace.saveCurrent()
        } label: {
          Image(systemName: workspace.selectedArticle?.saved == true ? "bookmark.fill" : "bookmark")
        }.help("Save article · ⌘S").accessibilityLabel("Save article")
        Button {
          workspace.showNotes.toggle()
        } label: {
          Image(systemName: "sidebar.right")
        }
        .help("Notes · ⇧⌘N").accessibilityLabel("Toggle notes")
        Menu {
          Button("Copy link") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(reader.url.absoluteString, forType: .string)
          }
          Button("Open in browser") { NSWorkspace.shared.open(reader.url) }
          Divider()
          Button("Refresh Reader") { reader.refresh() }
          Button("Find in article") { reader.showFind = true }
          if let article = workspace.selectedArticle, article.saved {
            Button(article.favourite ? "Unfavourite" : "Favourite") {
              workspace.store.setFavourite(!article.favourite, for: article.id)
            }
            Button(article.isArchived == true ? "Return to Saved" : "Archive") {
              do {
                try workspace.store.setArchived(article.isArchived != true, ids: [article.id])
              } catch { workspace.error = error.localizedDescription }
            }
          }
          Divider()
          Button("Reader diagnostics") { workspace.showDiagnostics.toggle() }
        } label: {
          Image(systemName: "ellipsis")
        }.accessibilityLabel("Article options")
      }
    }

  }

  private var sidebar: some View {
    VStack(spacing: 0) {
      HStack(spacing: 9) {
        ArcticMark().frame(width: 25, height: 25)
        Text("Arctic").font(.system(size: 20, weight: .semibold, design: .rounded))
        Spacer()
        Button {
          workspace.showOpen = true
        } label: {
          Image(systemName: "plus")
        }
        .buttonStyle(.plain).help("Open article · ⌘K").accessibilityLabel("Open article")
      }.padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 16)
      Button {
        workspace.showOpen = true
      } label: {
        HStack {
          Image(systemName: "magnifyingglass")
          Text("Find or open")
          Spacer()
          Text("⌘K").font(.caption)
        }
        .foregroundStyle(.secondary).padding(10).background(
          .quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 10))
      }.buttonStyle(.plain).padding(.horizontal, 12).padding(.bottom, 14)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 3) {
          ForEach([MacLibraryFolder.saved, .favourites, .downloaded], id: \.self) { folder in
            folderRow(folder)
          }
          if !workspace.tabs.isEmpty {
            sectionTitle("OPEN ARTICLES")
            ForEach(workspace.tabs) { tab in
              HStack(spacing: 8) {
                Image(systemName: "doc.text").foregroundStyle(.secondary).frame(width: 18)
                Button {
                  workspace.select(tab.url)
                } label: {
                  Text(tab.title).lineLimit(2).multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                    .contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("tab-" + tab.url.lastPathComponent)
                Button {
                  workspace.close(tab.url)
                } label: {
                  Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)).frame(
                    width: 20, height: 24)
                }
                .buttonStyle(.plain).foregroundStyle(.tertiary).help("Close article")
                .accessibilityLabel("Close " + tab.title)
              }.padding(.horizontal, 10).padding(.vertical, 3)
                .background {
                  if workspace.selectedURL == tab.url {
                    RoundedRectangle(cornerRadius: 10).fill(ArcticBrand.accent.opacity(0.13))
                      .matchedGeometryEffect(id: "tab-selection", in: selection)
                  }
                }
                .contextMenu {
                  Button("Close article") { workspace.close(tab.url) }
                  Button("Copy link") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(tab.url.absoluteString, forType: .string)
                  }
                }
            }
          }
          if !workspace.store.allTags.isEmpty {
            sectionTitle("COLLECTIONS")
            ForEach(workspace.store.allTags, id: \.self) { folderRow(.tag($0)) }
          }
          sectionTitle("YOUR LIBRARY")
          sidebarButton("Notebook", symbol: "text.book.closed", selected: workspace.showNotebook) {
            workspace.library()
            workspace.showNotebook = true
          }
          sidebarButton("Reading stats", symbol: "chart.bar", selected: false) {
            workspace.showStats = true
          }
          folderRow(.history)
          folderRow(.archive)
        }.padding(.horizontal, 12).padding(.bottom, 16)
      }
      Divider().padding(.horizontal, 18)
      HStack {
        Button {
          workspace.importList()
        } label: {
          Label("Import", systemImage: "square.and.arrow.down")
        }
        Spacer()
        Button {
          workspace.showSettings = true
        } label: {
          Image(systemName: "gearshape")
        }.help("Automatic tags")
        Button {
          workspace.showShortcuts = true
        } label: {
          Image(systemName: "questionmark.circle")
        }.help("Keyboard shortcuts · ?")
      }.buttonStyle(.plain).foregroundStyle(.secondary).padding(18)
    }
    .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: workspace.selectedURL)
  }

  private func sectionTitle(_ title: String) -> some View {
    Text(title).font(.system(size: 9, weight: .semibold)).tracking(1.2).foregroundStyle(.tertiary)
      .padding(.horizontal, 10).padding(.top, 19).padding(.bottom, 7)
  }
  private func folderRow(_ folder: MacLibraryFolder) -> some View {
    sidebarButton(
      folder.title, symbol: folder.symbol,
      selected: workspace.selectedURL == nil && !workspace.showNotebook
        && workspace.folder == folder
    ) { workspace.library(folder) }
  }
  private func sidebarButton(
    _ title: String, symbol: String, selected: Bool, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(spacing: 10) {
        Image(systemName: symbol).frame(width: 18).foregroundStyle(
          selected ? ArcticBrand.accent : .secondary)
        Text(title).lineLimit(1)
        Spacer(minLength: 0)
      }.font(.system(size: 13, weight: selected ? .medium : .regular))
        .padding(.horizontal, 10).padding(.vertical, 9).contentShape(
          RoundedRectangle(cornerRadius: 9)
        )
        .background(
          selected ? ArcticBrand.accent.opacity(0.10) : .clear,
          in: RoundedRectangle(cornerRadius: 9))
    }.buttonStyle(.plain)
  }
  private func installKeyMonitor() {
    guard keyMonitor == nil else { return }
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
      guard event.characters == "?", !event.modifierFlags.contains(.command),
        !workspace.showOpen, !workspace.showSettings,
        !(NSApp.keyWindow?.firstResponder is NSTextView)
      else { return event }
      // Website text fields own their typing. Reader uses an isolated JS handler.
      if let responder = NSApp.keyWindow?.firstResponder,
        String(describing: type(of: responder)).contains("WK")
      {
        return event
      }
      workspace.showShortcuts = true
      return nil
    }
  }
}

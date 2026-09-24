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

  private var layout: some View {
    NavigationSplitView(columnVisibility: $visibility) {
      MacNavigationSidebar(workspace: workspace)
        .navigationSplitViewColumnWidth(min: 180, ideal: 232, max: 320)
    } detail: {
      VStack(spacing: 0) {
        MacArticleTabStrip(workspace: workspace)
        Divider().opacity(0.5)
        if let reader = workspace.selectedReader {
          HStack(spacing: 0) {
            MacReaderPane(reader: reader, workspace: workspace)
            if workspace.showNotes {
              Divider().opacity(0.5)
              MacNotesPane(workspace: workspace, reader: reader).frame(width: 300)
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
    .navigationTitle("")
  }

  private var blocksReading: Bool {
    workspace.showNotes || workspace.showOpen || workspace.showShortcuts || workspace.showStats
      || workspace.showSettings
  }

  private var observedLayout: some View {
    layout
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

    ToolbarItemGroup(placement: .primaryAction) {
      if let reader = workspace.selectedReader {
        Button(reader.websiteVisible ? "Reader" : "Website") { reader.toggleWebsite() }
          .help(reader.websiteVisible ? "Show Reader" : "Show website")
        Button("Notes") { workspace.showNotes.toggle() }
          .help("Notes · ⇧⌘N").accessibilityLabel("Toggle notes")
        Menu {
          Button(workspace.selectedArticle?.saved == true ? "Saved" : "Save article") {
            workspace.saveCurrent()
          }.disabled(workspace.selectedArticle?.saved == true)
          Divider()
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

  private func installKeyMonitor() {
    guard keyMonitor == nil else { return }
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
      // macOS reserves Command-? for Help search. Handle our documented
      // shortcut before menu dispatch, including when a text field has focus.
      let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
      if modifiers.contains([.command, .shift]),
        !modifiers.contains(.option), !modifiers.contains(.control),
        ["/", "?"].contains(event.charactersIgnoringModifiers ?? "")
      {
        workspace.showShortcuts = true
        return nil
      }
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

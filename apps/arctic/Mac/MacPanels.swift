import AppKit
import SwiftUI
import WebKit

struct MacReaderPane: View {
  @Bindable var reader: MacReader
  @Bindable var workspace: MacWorkspace
  @State private var findText = ""
  var body: some View {
    VStack(spacing: 0) {
      if reader.showFind {
        HStack {
          Image(systemName: "magnifyingglass")
          TextField("Find in article", text: $findText).onSubmit { reader.find(findText) }
            .textFieldStyle(.roundedBorder)
          Button {
            reader.find(findText, backwards: true)
          } label: {
            Image(systemName: "chevron.up")
          }
          Button {
            reader.find(findText)
          } label: {
            Image(systemName: "chevron.down")
          }
          Button("Done") { reader.showFind = false }
        }.padding(12).background(.bar)
      }
      ZStack {
        if reader.websiteVisible, let website = reader.websiteView {
          MacWebSurface(webView: website)
        } else {
          MacWebSurface(webView: reader.readerView).opacity(reader.ready ? 1 : 0)
          if !reader.ready && reader.error == nil {
            VStack(spacing: 16) {
              ArcticMark().frame(width: 38, height: 38).opacity(0.6)
              Text(workspace.selectedTab?.title ?? "Opening article").font(
                .system(size: 25, design: .serif)
              ).lineLimit(2)
              ProgressView().controlSize(.small)
            }.padding(48).frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
      }
      if let error = reader.error {
        HStack {
          Text(error).font(.callout).foregroundStyle(.secondary)
          Spacer()
          Button("Retry") { reader.refresh() }
          Button("Website") { if !reader.websiteVisible { reader.toggleWebsite() } }
        }.padding(14).background(.bar)
      }
      if !reader.websiteVisible && reader.ready {
        HStack(spacing: 16) {
          Button(workspace.selectedArticle?.saved == true ? "Highlight" : "Save & highlight") {
            reader.highlight()
          }
          .help("Select article text first · ⇧⌘H")
          Button("Quote in note") {
            Task {
              reader.quotedDraft = await reader.selection()
              workspace.showNotes = true
            }
          }
          if let id = reader.focusedAnnotation {
            Menu("Colour") {
              ForEach(HighlightColour.allCases) { colour in
                Button(colour.name) {
                  changeAnnotation { try workspace.annotations.recolour(id, colour: colour) }
                }
              }
            }.fixedSize()
            Button("Remove highlight") {
              changeAnnotation { try workspace.annotations.removeHighlight(id) }
              reader.focusedAnnotation = nil
            }
          }
          Spacer()
          Menu {
            ForEach([17, 19, 21, 23, 25], id: \.self) { size in
              Button("\(size) pt") { reader.setFontSize(size) }
            }
          } label: {
            Text("Aa").font(.system(size: 15, design: .serif))
          }.fixedSize()
        }.buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(.secondary)
          .padding(.horizontal, 22).padding(.vertical, 13).background(.bar)
      }
      if workspace.showDiagnostics {
        Text(
          "Warm readers \(workspace.readers.count)/3 · hits \(workspace.readers.hits) · misses \(workspace.readers.misses) · last ready \(Int(reader.readyMilliseconds)) ms · loads \(reader.loadCount)"
        )
        .font(.system(size: 10, design: .monospaced)).padding(8)
        .accessibilityIdentifier("reader-diagnostics")
      }
    }
    .onChange(of: workspace.annotations.records) { _, _ in reader.renderAnnotations() }
    .onAppear { reader.onShortcuts = { workspace.showShortcuts = true } }
  }
  private func changeAnnotation(_ action: () throws -> Void) {
    do {
      try action()
      reader.renderAnnotations()
    } catch { workspace.error = error.localizedDescription }
  }
}

struct MacNotesPane: View {
  @Bindable var workspace: MacWorkspace
  @Bindable var reader: MacReader
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("Notes").font(.system(size: 21, weight: .medium, design: .rounded))
        Spacer()
        Button {
          workspace.showNotes = false
        } label: {
          Image(systemName: "sidebar.right")
        }.buttonStyle(.plain)
      }.padding(22)
      let notes = workspace.annotations.annotations(for: reader.url).sorted {
        $0.createdAt < $1.createdAt
      }
      if notes.isEmpty {
        VStack(spacing: 12) {
          Image(systemName: "text.quote").font(.system(size: 28, weight: .ultraLight))
            .foregroundStyle(ArcticBrand.accent)
          Text("A thought worth keeping.").font(.system(size: 19, design: .serif))
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ScrollViewReader { proxy in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
              ForEach(notes) { note in MacNoteBubble(note: note, workspace: workspace).id(note.id) }
            }.padding(18)
          }.onChange(of: notes.count) { _, _ in
            if let id = notes.last?.id { proxy.scrollTo(id, anchor: .bottom) }
          }
        }
      }
      VStack(alignment: .leading, spacing: 10) {
        if let quote = reader.quotedDraft {
          HStack {
            Text(quote.exact).lineLimit(2).font(.system(size: 12, design: .serif))
              .padding(.leading, 9).overlay(alignment: .leading) {
                Capsule().fill(ArcticBrand.accent).frame(width: 2)
              }
            Button {
              reader.quotedDraft = nil
            } label: {
              Image(systemName: "xmark")
            }.buttonStyle(.plain)
          }
        }
        HStack(alignment: .bottom) {
          TextField("Your thought…", text: $reader.draft, axis: .vertical)
            .lineLimit(2...7).textFieldStyle(.plain).accessibilityIdentifier("note-input")
          if !reader.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Button(action: send) { Image(systemName: "arrow.up").fontWeight(.semibold).padding(8) }
              .buttonStyle(.borderedProminent).clipShape(Capsule())
              .help(workspace.selectedArticle?.saved == true ? "Send note" : "Save & keep note")
              .accessibilityLabel(
                workspace.selectedArticle?.saved == true ? "Send note" : "Save & keep note")
          }
        }
      }.padding(14).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 20))
        .padding(16)
    }.background(.background)
  }
  private func send() {
    let text = reader.draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    do {
      if workspace.store.article(for: reader.url)?.saved != true {
        try workspace.store.setSaved(true, url: reader.url)
        reader.persistReader()
      }
      guard workspace.annotations.sendNote(text, in: reader.url, quote: reader.quotedDraft) != nil
      else { return }
      reader.draft = ""
      reader.quotedDraft = nil
    } catch { workspace.error = error.localizedDescription }
  }
}

struct MacNoteBubble: View {
  let note: ReaderAnnotation
  let workspace: MacWorkspace
  @State private var editing = false
  @State private var draft = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let quote = note.quote {
        Text(quote.exact).font(.system(size: 14, design: .serif)).lineLimit(3)
          .padding(.leading, 10).padding(.vertical, 3)
          .overlay(alignment: .leading) { Capsule().fill(colour).frame(width: 3) }
      }
      if !note.note.isEmpty { Text(note.note).font(.system(size: 13)).textSelection(.enabled) }
      if workspace.annotations.failedNotes[note.id] != nil {
        Button("Retry saving") { workspace.annotations.retryNote(note.id) }
      }
    }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
      .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 15))
      .contextMenu {
        Button("Edit note") {
          draft = note.note
          editing = true
        }
        if !note.note.isEmpty {
          Button("Delete note") { perform { try workspace.annotations.deleteNote(note.id) } }
        }
        if note.isHighlighted {
          Button("Remove highlight") {
            perform { try workspace.annotations.removeHighlight(note.id) }
          }
        }
      }
      .sheet(isPresented: $editing) {
        VStack(alignment: .leading, spacing: 18) {
          Text("Edit note").font(.title2)
          TextEditor(text: $draft).frame(width: 400, height: 160)
          HStack {
            Button("Cancel") { editing = false }.keyboardShortcut(.cancelAction)
            Spacer()
            Button("Save") {
              perform { try workspace.annotations.updateNote(draft, id: note.id) }
              editing = false
            }
            .keyboardShortcut(.defaultAction)
          }
        }.padding(24)
      }
  }
  private var colour: Color {
    switch note.highlightColour {
    case .yellow: .yellow
    case .sage: .green
    case .rose: .pink
    case .blue: ArcticBrand.accent
    }
  }
  private func perform(_ action: () throws -> Void) {
    do { try action() } catch { workspace.error = error.localizedDescription }
  }
}

struct MacNotebook: View {
  let workspace: MacWorkspace
  var body: some View {
    let notes = workspace.annotations.records.filter { $0.deletedAt == nil }.sorted {
      $0.createdAt > $1.createdAt
    }
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 18) {
        Text("Notebook").font(.system(size: 32, weight: .medium, design: .rounded)).padding(
          .bottom, 10)
        if notes.isEmpty {
          Text("Thoughts find a home here.").font(.system(size: 23, design: .serif))
            .foregroundStyle(.secondary)
        }
        ForEach(notes) { note in
          VStack(alignment: .leading, spacing: 6) {
            Button(
              workspace.store.article(for: note.articleURL)?.title ?? note.articleURL.host
                ?? "Article"
            ) {
              workspace.open(note.articleURL)
              workspace.showNotes = true
            }.buttonStyle(.plain).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            MacNoteBubble(note: note, workspace: workspace)
          }
        }
      }.padding(32).frame(maxWidth: 800)
    }.frame(maxWidth: .infinity)
  }
}

struct MacOpenPanel: View {
  let workspace: MacWorkspace
  @Environment(\.dismiss) private var dismiss
  @State private var input = ""
  @FocusState private var focused: Bool
  @State private var matches: [SavedArticle] = []
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      HStack {
        Image(systemName: "magnifyingglass").foregroundStyle(ArcticBrand.accent)
        TextField("Paste a link, or find an article", text: $input).textFieldStyle(.plain)
          .font(.title3).focused($focused).onSubmit { submit() }.accessibilityIdentifier(
            "open-input")
      }.padding(16).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 15))
      if SharedInbox.webURL(input) != nil {
        Button("Open article") { submit() }.buttonStyle(.borderedProminent).keyboardShortcut(
          .defaultAction)
      }
      ForEach(matches.prefix(7)) { article in
        Button {
          workspace.open(article.url, title: article.title)
          dismiss()
        } label: {
          HStack {
            VStack(alignment: .leading, spacing: 4) {
              Text(article.title).lineLimit(1)
              Text(article.url.host ?? "").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "arrow.up.left").foregroundStyle(.tertiary)
          }
        }.buttonStyle(.plain)
      }
      HStack {
        Text("Open links without saving them.").font(.caption).foregroundStyle(.secondary)
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
      }
    }.padding(24).frame(width: 530)
      .onAppear { focused = true }
      .task(id: input) {
        let all = workspace.store.articles
        let query = input
        let result = await Task.detached {
          Array(
            all.lazy.filter {
              query.isEmpty || $0.title.localizedStandardContains(query)
                || $0.url.absoluteString.localizedStandardContains(query)
            }.prefix(7))
        }.value
        if !Task.isCancelled { matches = result }
      }
  }
  private func submit() {
    if let url = SharedInbox.webURL(input) {
      workspace.open(url)
      dismiss()
    } else if let first = matches.first {
      workspace.open(first.url, title: first.title)
      dismiss()
    }
  }
}

struct MacShortcutsPanel: View {
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack {
        Text("A little more fluent.").font(.system(size: 29, design: .serif))
        Spacer()
        ArcticMark().frame(width: 30, height: 30)
      }
      TextField("Find a shortcut", text: $query).textFieldStyle(.roundedBorder)
      VStack(spacing: 13) {
        ForEach(
          MacShortcut.allCases.filter { query.isEmpty || $0.title.localizedStandardContains(query) }
        ) { shortcut in
          HStack {
            Text(shortcut.title)
            Spacer()
            Text(shortcut.keys).font(.system(.callout, design: .monospaced)).foregroundStyle(
              .secondary)
          }
        }
      }
      HStack {
        Text("Press ? while browsing to open this guide.").font(.caption).foregroundStyle(
          .secondary)
        Spacer()
        Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
      }
    }.padding(30).frame(width: 480)
  }
}

struct MacStatsPanel: View {
  @Environment(\.dismiss) private var dismiss
  @State private var stats: ReadingStats?
  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack {
        Text("Time well spent").font(.system(size: 30, design: .serif))
        Spacer()
        ArcticMark().frame(width: 28, height: 28)
      }
      if let stats {
        VStack(alignment: .leading, spacing: 20) {
          Text(ReadingStats.duration(stats.weekSeconds)).font(
            .system(size: 44, weight: .bold, design: .rounded))
          Text("This week").foregroundStyle(.secondary)
          HStack(alignment: .bottom, spacing: 14) {
            ForEach(stats.days) { day in
              VStack {
                Capsule().fill(ArcticBrand.accent.opacity(day.seconds > 0 ? 0.7 : 0.15))
                  .frame(
                    height: max(8, 90 * day.seconds / max(1, stats.days.map(\.seconds).max() ?? 1))
                  )
                  .frame(height: 100, alignment: .bottom)
                Text(day.date, format: .dateTime.weekday(.narrow)).font(.caption)
              }
            }
          }
        }.padding(26).background(
          ArcticBrand.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 30))
        HStack {
          Text("\(stats.articles) articles")
          Spacer()
          Text("\(stats.visits) visits")
          Spacer()
          Text("\(stats.activeDays) days")
        }.font(.subheadline)
        Text("Estimated time in saved articles. Idle gaps over 2 minutes are excluded.").font(
          .caption
        ).foregroundStyle(.secondary)
      }
      HStack {
        Spacer()
        Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
      }
    }.padding(30).frame(width: 450)
      .task {
        while !ReadingSessions.shared.isLoaded {
          do { try await Task.sleep(for: .milliseconds(30)) } catch { return }
        }
        let records = ReadingSessions.shared.snapshot()
        stats = await Task.detached { ReadingStats(sessions: records) }.value
      }
  }
}

struct MacTaggingSettings: View {
  let workspace: MacWorkspace
  @Environment(\.dismiss) private var dismiss
  @State private var key = ""
  @State private var error: String?
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("A little magic.").font(.system(size: 30, design: .serif))
      Text(
        "Your Jev key stays in this Mac’s Keychain. Automatic tagging sends article titles and excerpts to Jev."
      )
      .font(.callout).foregroundStyle(.secondary)
      SecureField("Jev API key", text: $key).textFieldStyle(.roundedBorder)
      if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
      HStack {
        Button("Remove key") {
          do {
            try JevKeychain.delete()
            dismiss()
          } catch { self.error = error.localizedDescription }
        }
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        Button("Save key") {
          do {
            try JevKeychain.save(key.trimmingCharacters(in: .whitespacesAndNewlines))
            TaggingPreferences.enabled = true
            workspace.store.resumeTagging()
            dismiss()
          } catch { self.error = error.localizedDescription }
        }.disabled(key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).keyboardShortcut(
          .defaultAction)
      }
    }.padding(28).frame(width: 470)
  }
}

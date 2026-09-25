import AppKit
import SwiftUI

struct MacLibraryHeader: View {
  @Bindable var workspace: MacWorkspace
  let count: Int
  let compact: Bool
  @FocusState private var searching: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    HStack(spacing: 20) {
      VStack(alignment: .leading, spacing: 3) {
        Text(workspace.folder.title).font(.system(size: 30, weight: .medium, design: .rounded))
          .lineLimit(1).id(workspace.folder)
          .transition(.opacity.combined(with: .offset(y: 3)))
          .scaleEffect(compact ? 0.86 : 1, anchor: .leading)
          .offset(y: compact ? 7 : 0)
        Text("\(count) articles").font(.system(size: 11)).foregroundStyle(.secondary)
          .opacity(compact ? 0 : 1)
      }.frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: 9) {
        Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(.secondary)
        TextField("Search", text: $workspace.search).textFieldStyle(.plain)
          .font(.system(size: 13)).focused($searching).accessibilityIdentifier("library-search")
        Button {
          workspace.search = ""
        } label: {
          Image(systemName: "xmark.circle.fill").font(.system(size: 12)).foregroundStyle(.tertiary)
        }.buttonStyle(.plain).accessibilityLabel("Clear search")
          .opacity(workspace.search.isEmpty ? 0 : 1).disabled(workspace.search.isEmpty)
      }.padding(.horizontal, 13).frame(width: 230, height: 36)
        .background(.primary.opacity(searching ? 0.055 : 0.035), in: Capsule())
        .overlay(
          Capsule().strokeBorder(
            searching ? ArcticBrand.accent.opacity(0.5) : Color.primary.opacity(0.06),
            lineWidth: 0.75)
        )
        .offset(y: compact ? -2 : 0)
    }.padding(.horizontal, 28).frame(height: 96)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: compact)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: searching)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: workspace.folder)
  }
}

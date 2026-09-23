import SwiftUI

/// Telegram's Undo overlay informs this transient, stationary feedback surface.
/// The action is already durable; timeout dismisses feedback, not the mutation.
struct ArchiveUndoToast: View {
  let store: ArticleStore
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    Group {
      if let receipt = store.archiveUndo {
        HStack(spacing: 12) {
          Image(systemName: receipt.archived ? "archivebox.fill" : "tray.fill")
            .font(.title3).accessibilityHidden(true)
          Text(receipt.message).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
          Button("Undo") { store.undoArchive(receipt.id) }
            .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
            .accessibilityIdentifier("archive-undo")
          if voiceOver {
            Button("Dismiss") { store.archiveUndo = nil }.frame(minHeight: 44)
          }
        }
        .padding(.horizontal, 16).padding(.vertical, 5)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        .overlay { RoundedRectangle(cornerRadius: 20).stroke(.primary.opacity(0.08)) }
        .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
        .frame(maxWidth: 480)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("archive-toast")
        .accessibilityAction(.escape) { store.archiveUndo = nil }
        .transition(reduceMotion ? .opacity : .offset(y: 8).combined(with: .opacity))
        .id(receipt.id)
        .onAppear {
          UIAccessibility.post(
            notification: .announcement, argument: receipt.message + ". Undo available.")
        }
      }
    }
    .animation(.easeOut(duration: reduceMotion ? 0.1 : 0.18), value: store.archiveUndo?.id)
    .task(id: timerIdentity) {
      guard let receipt = store.archiveUndo, !voiceOver, scenePhase == .active else { return }
      do { try await Task.sleep(for: .seconds(6)) } catch { return }
      guard store.archiveUndo?.id == receipt.id else { return }
      store.archiveUndo = nil
    }
  }

  // Backgrounding or enabling VoiceOver cancels the timer. Returning gets the
  // full interval; assistive-technology users dismiss or undo at their own pace.
  private var timerIdentity: String {
    "\(store.archiveUndo?.id.uuidString ?? "")-\(voiceOver)-\(scenePhase)"
  }
}

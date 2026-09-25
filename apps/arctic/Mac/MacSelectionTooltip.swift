import AppKit
import SwiftUI

/// One nonactivating panel per warm reader. Selection changes move this window;
/// they do not dismiss and re-present a popover or take focus from WebKit.
@MainActor final class MacSelectionTooltip {
  private let panel: NSPanel
  private var observer: NSObjectProtocol?
  var isShown: Bool { panel.isVisible }
  init(reader: MacReader) {
    panel = SelectionPanel(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: false)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.hidesOnDeactivate = true
    panel.isReleasedWhenClosed = false
    panel.contentView = NSHostingView(
      rootView: MacSelectionTools(reader: reader)
        .background(.regularMaterial, in: Capsule()))
    observer = NotificationCenter.default.addObserver(
      forName: NSWindow.didResignKeyNotification, object: nil, queue: .main
    ) { [weak self] notification in
      MainActor.assumeIsolated {
        guard let self, notification.object as? NSWindow === self.panel.parent else { return }
        self.close()
      }
    }
  }
  deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
  func show(in window: NSWindow, anchor: NSRect, viewport: NSRect) {
    let size = panel.contentView?.fittingSize ?? NSSize(width: 230, height: 38)
    let visible = viewport.intersection(window.screen?.visibleFrame ?? window.frame).insetBy(
      dx: 8, dy: 8)
    let gap: CGFloat = 8
    let x = min(max(visible.minX, anchor.midX - size.width / 2), visible.maxX - size.width)
    // Native equivalent of position-area: top; position-try-fallbacks: flip-block.
    // Prefer above the whole selection, then below. Shift only to avoid overflow.
    let above = anchor.maxY + gap
    let below = anchor.minY - gap - size.height
    let y =
      above + size.height <= visible.maxY
      ? above
      : below >= visible.minY ? below : visible.maxY - size.height
    if panel.parent !== window {
      panel.parent?.removeChildWindow(panel)
      window.addChildWindow(panel, ordered: .above)
    }
    panel.setFrame(
      NSRect(x: x, y: y, width: size.width, height: size.height), display: true, animate: false)
    if !isShown { panel.orderFront(nil) }
  }
  func close() {
    panel.orderOut(nil)
    panel.parent?.removeChildWindow(panel)
  }
  private final class SelectionPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
  }
}

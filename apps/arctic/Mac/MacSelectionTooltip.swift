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
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14)))
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
  func show(in window: NSWindow, near point: NSPoint) {
    let size = panel.contentView?.fittingSize ?? NSSize(width: 240, height: 48)
    let screen = window.screen?.visibleFrame ?? window.frame
    let frame = NSRect(
      x: min(max(screen.minX + 8, point.x - size.width / 2), screen.maxX - size.width - 8),
      y: min(point.y + 16, screen.maxY - size.height - 8), width: size.width, height: size.height)
    if panel.parent !== window {
      panel.parent?.removeChildWindow(panel)
      window.addChildWindow(panel, ordered: .above)
    }
    if isShown && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.125
        context.timingFunction = CAMediaTimingFunction(name: .easeOut)
        panel.animator().setFrame(frame, display: true)
      }
    } else {
      panel.setFrame(frame, display: true)
      panel.orderFront(nil)
    }
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

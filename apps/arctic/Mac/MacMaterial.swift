import AppKit
import SwiftUI

/// A public AppKit backdrop with a graduated mask. Content scrolls behind the
/// header; blur contribution fades to zero instead of ending in an opaque seam.
struct MacMaterial: NSViewRepresentable {
  var fades = false
  func makeNSView(context: Context) -> Backdrop { Backdrop() }
  func updateNSView(_ view: Backdrop, context: Context) {
    view.fades = fades
    view.needsLayout = true
  }
  final class Backdrop: NSVisualEffectView {
    var fades = false
    // NSVisualEffectView's own alpha mask applies to backdrop composition.
    // A layer mask alone does not reliably mask its separate backdrop surface.
    private static let edgeMask = NSImage(size: NSSize(width: 1, height: 256), flipped: false) {
      rect in
      let gradient = NSGradient(
        colorsAndLocations: (NSColor.clear, 0), (NSColor.black.withAlphaComponent(0.06), 0.15),
        (NSColor.black.withAlphaComponent(0.55), 0.4), (NSColor.black, 0.7),
        (NSColor.black, 1))!
      gradient.draw(in: rect, angle: 90)
      return true
    }
    override init(frame frameRect: NSRect) {
      super.init(frame: frameRect)
      material = .headerView
      blendingMode = .withinWindow
      state = .followsWindowActiveState
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layout() {
      super.layout()
      maskImage = fades ? Self.edgeMask : nil
    }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
  }
}

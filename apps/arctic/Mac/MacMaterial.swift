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
    private let gradient = CAGradientLayer()
    override init(frame frameRect: NSRect) {
      super.init(frame: frameRect)
      material = .headerView
      blendingMode = .withinWindow
      state = .followsWindowActiveState
      wantsLayer = true
      gradient.colors = [NSColor.black.cgColor, NSColor.black.cgColor, NSColor.clear.cgColor]
      gradient.locations = [0, 0.55, 1]
      gradient.startPoint = CGPoint(x: 0.5, y: 1)
      gradient.endPoint = CGPoint(x: 0.5, y: 0)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layout() {
      super.layout()
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      gradient.frame = bounds
      layer?.mask = fades ? gradient : nil
      CATransaction.commit()
    }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
  }
}

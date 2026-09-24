import AppKit
import SwiftUI

/// A fixed-height native editor keeps the composer stable. Return sends;
/// Shift-Return inserts a line, and IME composition keeps ownership of Return.
struct MacNoteInput: NSViewRepresentable {
  @Binding var text: String
  var send: () -> Void
  func makeCoordinator() -> Coordinator { Coordinator(self) }
  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSScrollView()
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = false
    let input = Editor(frame: NSRect(x: 0, y: 0, width: 200, height: 44))
    input.isRichText = false
    input.drawsBackground = false
    input.font = .systemFont(ofSize: 14)
    input.textColor = .labelColor
    input.textContainerInset = NSSize(width: 0, height: 6)
    input.textContainer?.lineFragmentPadding = 0
    input.textContainer?.widthTracksTextView = true
    input.isVerticallyResizable = true
    input.autoresizingMask = [.width]
    input.delegate = context.coordinator
    input.submit = send
    input.setAccessibilityIdentifier("note-input")
    input.setAccessibilityLabel("Your thought")
    scroll.documentView = input
    return scroll
  }
  func updateNSView(_ view: NSScrollView, context: Context) {
    context.coordinator.parent = self
    guard let input = view.documentView as? Editor else { return }
    input.submit = send
    if input.string != text {
      input.string = text
      input.needsDisplay = true
    }
  }
  final class Coordinator: NSObject, NSTextViewDelegate {
    var parent: MacNoteInput
    init(_ parent: MacNoteInput) { self.parent = parent }
    func textDidChange(_ notification: Notification) {
      guard let editor = notification.object as? NSTextView else { return }
      parent.text = editor.string
      editor.needsDisplay = true
    }
  }
  final class Editor: NSTextView {
    var submit: (() -> Void)?
    override func keyDown(with event: NSEvent) {
      if [36, 76].contains(event.keyCode), !event.modifierFlags.contains(.shift), !hasMarkedText() {
        submit?()
        return
      }
      super.keyDown(with: event)
    }
    override func draw(_ rect: NSRect) {
      super.draw(rect)
      guard string.isEmpty else { return }
      ("Your thought…" as NSString).draw(
        at: NSPoint(x: 0, y: 6),
        withAttributes: [
          .font: NSFont.systemFont(ofSize: 14), .foregroundColor: NSColor.placeholderTextColor,
        ])
    }
  }
}

/// A compact, rounded paper-plane glyph. Its path is shared with SendNote.svg.
struct MacSendGlyph: Shape {
  func path(in rect: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: 5, y: 10))
    p.addLine(to: CGPoint(x: 19, y: 4))
    p.addQuadCurve(to: CGPoint(x: 20, y: 5), control: CGPoint(x: 21, y: 3))
    p.addLine(to: CGPoint(x: 14, y: 19))
    p.addQuadCurve(to: CGPoint(x: 12, y: 19), control: CGPoint(x: 13, y: 21))
    p.addLine(to: CGPoint(x: 10, y: 14))
    p.addLine(to: CGPoint(x: 5, y: 12))
    p.addQuadCurve(to: CGPoint(x: 5, y: 10), control: CGPoint(x: 3, y: 11))
    p.closeSubpath()
    p.move(to: CGPoint(x: 10, y: 14))
    p.addLine(to: CGPoint(x: 15, y: 9))
    return p.applying(CGAffineTransform(scaleX: rect.width / 24, y: rect.height / 24))
  }
}

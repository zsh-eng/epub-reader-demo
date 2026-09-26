import CoreText
import SwiftUI
import UIKit

/// The lines and translucent marker strokes share Core Text's glyph positions.
/// This stays vector text until ImageRenderer exports it; no quote bitmap, timer,
/// network font, or per-frame random texture is required.
struct PrintedPassage: View {
  let text: String
  let font: UIFont
  let colour: HighlightColour
  let marked: Bool

  private static func frame(_ text: String, font: UIFont, size: CGSize) -> CTFrame {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 4
    let attributed = NSAttributedString(
      string: text,
      attributes: [
        .font: font, .foregroundColor: UIColor.black.withAlphaComponent(0.88),
        .paragraphStyle: paragraph,
      ])
    return CTFramesetterCreateFrame(
      CTFramesetterCreateWithAttributedString(attributed),
      CFRange(location: 0, length: attributed.length),
      CGPath(rect: CGRect(origin: .zero, size: size), transform: nil), nil)
  }

  static func fits(_ text: String, font: UIFont, size: CGSize) -> Bool {
    CTFrameGetVisibleStringRange(frame(text, font: font, size: size)).length == text.utf16.count
  }

  var body: some View {
    Canvas { context, size in
      let frame = Self.frame(text, font: font, size: size)
      let lines = CTFrameGetLines(frame) as! [CTLine]
      var origins = [CGPoint](repeating: .zero, count: lines.count)
      CTFrameGetLineOrigins(frame, CFRange(location: 0, length: 0), &origins)
      context.withCGContext { cg in
        cg.translateBy(x: 0, y: size.height)
        cg.scaleBy(x: 1, y: -1)
        if marked {
          cg.setBlendMode(.multiply)
          for (index, line) in lines.enumerated() {
            var ascent: CGFloat = 0
            var descent: CGFloat = 0
            let width = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, nil))
            guard width > 0 else { continue }
            let origin = origins[index]
            let bottom = origin.y - descent * 0.35
            let top = origin.y + ascent * 0.82
            let wobble = CGFloat(index % 3) * 0.55
            let stroke = CGMutablePath()
            stroke.move(to: CGPoint(x: origin.x, y: bottom + wobble))
            stroke.addLine(to: CGPoint(x: origin.x + width - 1, y: bottom))
            stroke.addLine(to: CGPoint(x: origin.x + width + 1, y: top - wobble))
            stroke.addLine(to: CGPoint(x: origin.x + 1, y: top + 0.6))
            stroke.closeSubpath()
            cg.setFillColor(UIColor(colour.tint).withAlphaComponent(0.42).cgColor)
            cg.addPath(stroke)
            cg.fillPath()
            // A slightly denser lower edge suggests a felt-tip pass through paper.
            cg.setStrokeColor(UIColor(colour.tint).withAlphaComponent(0.14).cgColor)
            cg.setLineWidth(1.6)
            cg.move(to: CGPoint(x: origin.x + 2, y: bottom + 1))
            cg.addLine(to: CGPoint(x: origin.x + width - 2, y: bottom + wobble))
            cg.strokePath()
          }
          cg.setBlendMode(.normal)
        }
        cg.textMatrix = .identity
        CTFrameDraw(frame, cg)
      }
    }.accessibilityLabel(text)
  }
}

/// Publisher identity follows the source host, never a guess from the title.
/// Georgia/Baskerville/Didot are installed editorial substitutes, not the
/// publishers' proprietary font files. Asset sources: Design/publisher-marks.md.
struct PublisherPrintHeading: View {
  let url: URL
  private var publisher: ArcticPublisher? {
    guard let host = url.host?.lowercased() else { return nil }
    return ArcticPublisher.all.first {
      guard let source = $0.url.host?.replacingOccurrences(of: "www.", with: "") else {
        return false
      }
      return host == source || host.hasSuffix("." + source)
    }
  }
  private var font: String {
    switch publisher?.asset {
    case "PublisherFT", "PublisherNYTimes": return "Georgia-Bold"
    case "PublisherNewYorker": return "Didot"
    default: return "Baskerville-Bold"
    }
  }
  var body: some View {
    HStack(spacing: 8) {
      if let publisher, let mark = DiscoveryShelfView.publisherImage(publisher.asset) {
        Image(uiImage: mark).resizable().scaledToFit().frame(width: 24, height: 24)
      }
      Text(publisher?.name ?? url.host?.replacingOccurrences(of: "www.", with: "") ?? "A passage")
        .font(.custom(font, size: 14)).lineLimit(1).minimumScaleFactor(0.75)
        .foregroundStyle(.black.opacity(0.88))
    }
  }
}

import UIKit

/// The web ruler's 6 pt page ticks, cosine dip, chapter marks, and edge fade.
/// UIScrollView owns direction locking, momentum, interruption, and edge bounce.
/// Only the final position crosses the bridge; previews never paginate the book.
final class ReaderScrubber: UIControl, UIScrollViewDelegate {
  private let scroll = HorizontalRulerScrollView()
  private let drawing = ReaderRulerDrawing()
  private var total = 1
  private var lastFeedbackPage = 1
  private var lastFeedbackTime: CFTimeInterval = 0
  private var applying = false
  private var adjusting = false
  var onPreview: ((Int) -> Void)?
  var onCommit: ((Int) -> Void)?
  var displayedPage: Int { min(total, max(1, Int((scroll.contentOffset.x / 6 + 1).rounded()))) }

  override init(frame: CGRect) {
    super.init(frame: frame)
    scroll.delegate = self
    scroll.showsHorizontalScrollIndicator = false
    scroll.showsVerticalScrollIndicator = false
    scroll.alwaysBounceHorizontal = true
    scroll.decelerationRate = .fast
    scroll.contentInsetAdjustmentBehavior = .never
    scroll.isDirectionalLockEnabled = true
    scroll.isAccessibilityElement = false
    scroll.accessibilityElementsHidden = true
    scroll.addSubview(drawing)
    addSubview(scroll)
    isAccessibilityElement = true
    accessibilityLabel = "Reading position"
    accessibilityIdentifier = "reader-scrubber"
    accessibilityHint = "Swipe up or down to change one page. Drag horizontally to scrub."
    accessibilityTraits = [.adjustable]
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func layoutSubviews() {
    super.layoutSubviews()
    scroll.frame = bounds
    scroll.contentSize = CGSize(width: bounds.width + CGFloat(max(0, total - 1)) * 6, height: bounds.height)
    drawPosition()
  }
  func update(page: Int, total: Int, chapters: [Int], colors: ReaderNativeColors, ready: Bool) {
    let changed = self.total != max(1, total)
    self.total = max(1, total)
    drawing.colors = colors
    drawing.total = self.total
    drawing.chapters = Set(chapters)
    isEnabled = ready
    scroll.isScrollEnabled = ready
    alpha = ready ? 1 : 0.35
    setNeedsLayout()
    if changed || (!scroll.isDragging && !scroll.isDecelerating && !adjusting) {
      applying = true
      scroll.setContentOffset(CGPoint(x: CGFloat(min(self.total, max(1, page)) - 1) * 6, y: 0), animated: false)
      applying = false
    }
    drawPosition()
  }
  private func drawPosition() {
    drawing.frame = CGRect(origin: CGPoint(x: scroll.contentOffset.x, y: 0), size: bounds.size)
    drawing.page = scroll.contentOffset.x / 6 + 1
    drawing.setNeedsDisplay()
    accessibilityValue = "Page \(displayedPage) of \(total)"
  }
  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
    adjusting = false
    lastFeedbackPage = displayedPage
  }
  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    drawPosition()
    guard !applying else { return }
    onPreview?(displayedPage)
    let page = displayedPage
    guard page != lastFeedbackPage else { return }
    let previous = lastFeedbackPage
    lastFeedbackPage = page
    let boundary = page == 1 || page == total || drawing.chapters.contains(where: { $0 > min(previous, page) && $0 <= max(previous, page) })
    let now = CACurrentMediaTime()
    // Fast flings keep only chapter/end feedback. Slow drags can feel each page.
    if boundary && now - lastFeedbackTime > 0.09 {
      ReaderHaptics.boundary(); lastFeedbackTime = now
    } else if scroll.isDragging && abs(scroll.panGestureRecognizer.velocity(in: scroll).x) < 180 && now - lastFeedbackTime > 0.075 {
      ReaderHaptics.selection(); lastFeedbackTime = now
    }
  }
  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) { if !decelerate { commit() } }
  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { commit() }
  func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) { adjusting = false }
  private func commit() {
    guard isEnabled else { return }
    let page = displayedPage
    let target = CGPoint(x: CGFloat(page - 1) * 6, y: 0)
    adjusting = abs(scroll.contentOffset.x - target.x) > 0.1 && !UIAccessibility.isReduceMotionEnabled
    scroll.setContentOffset(target, animated: adjusting)
    onCommit?(page)
  }
  /// Chapter taps and closing the Reader cancel any remaining scroll momentum.
  func cancel(at page: Int) {
    applying = true
    adjusting = false
    scroll.setContentOffset(CGPoint(x: CGFloat(min(total, max(1, page)) - 1) * 6, y: 0), animated: false)
    applying = false
    drawPosition()
  }
  override func accessibilityIncrement() { adjust(by: 1) }
  override func accessibilityDecrement() { adjust(by: -1) }
  private func adjust(by step: Int) {
    guard isEnabled else { return }
    let page = min(total, max(1, displayedPage + step))
    guard page != displayedPage else { return }
    cancel(at: page)
    onPreview?(page)
    ReaderHaptics.selection()
    onCommit?(page)
  }
}

private final class HorizontalRulerScrollView: UIScrollView {
  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    if gestureRecognizer === panGestureRecognizer {
      let translation = panGestureRecognizer.translation(in: self)
      let direction = abs(translation.x) + abs(translation.y) > 2 ? translation : panGestureRecognizer.velocity(in: self)
      guard abs(direction.x) > abs(direction.y) else { return false }
    }
    return super.gestureRecognizerShouldBegin(gestureRecognizer)
  }
}

private final class ReaderRulerDrawing: UIView {
  var page: CGFloat = 1
  var total = 1
  var chapters = Set<Int>()
  var colors = ReaderNativeColors.paper
  override init(frame: CGRect) { super.init(frame: frame); isOpaque = false; isUserInteractionEnabled = false; contentMode = .redraw }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext(), bounds.width > 0 else { return }
    let center = bounds.width / 2
    let half = Int(ceil(center / 6)) + 2
    let first = max(1, Int(floor(page)) - half)
    let last = min(total, Int(ceil(page)) + half)
    context.setLineCap(.round)
    if first <= last {
      for number in first...last {
        let x = center + (CGFloat(number) - page) * 6
        let t = min(1, max(0, min(x, bounds.width - x) / 64))
        let fade = t * t * (3 - 2 * t)
        let distance = abs(CGFloat(number) - page) / 3.6
        let dip: CGFloat = distance < 1 ? 7 * (0.5 + 0.5 * cos(distance * .pi)) : 0
        let height: CGFloat = number % 20 == 0 ? 34 : number % 10 == 0 ? 31 : 28
        let alpha: CGFloat = number % 20 == 0 ? 0.7 : number % 10 == 0 ? 0.5 : 0.3
        let top = 4 + dip, bottom = 4 + height + dip * 0.35
        context.setStrokeColor(colors.detail.withAlphaComponent(fade * alpha).cgColor)
        context.setLineWidth(number % 10 == 0 ? 0.9 : 0.75)
        context.move(to: CGPoint(x: x, y: top)); context.addLine(to: CGPoint(x: x, y: bottom)); context.strokePath()
        if chapters.contains(number) {
          context.setStrokeColor(colors.ink.withAlphaComponent(fade * 0.9).cgColor)
          context.setLineWidth(2)
          context.move(to: CGPoint(x: x, y: (top + bottom) / 2 - 4)); context.addLine(to: CGPoint(x: x, y: (top + bottom) / 2 + 4)); context.strokePath()
        }
        if number % 20 == 0 && min(x, bounds.width - x) > 22.4 {
          let text = NSAttributedString(string: "\(number)", attributes: [.font: ReaderFont.body(9, weight: .medium), .foregroundColor: colors.detail.withAlphaComponent(fade * 0.55)])
          text.draw(at: CGPoint(x: x - text.size().width / 2, y: 43))
        }
      }
    }
    context.setStrokeColor(colors.ink.cgColor); context.setLineWidth(2)
    context.move(to: CGPoint(x: center, y: 1)); context.addLine(to: CGPoint(x: center, y: 7)); context.strokePath()
  }
}

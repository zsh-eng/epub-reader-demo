import UIKit

/// Matches ReaderHeader: a quiet 56 pt title strip and the bookmark ribbon.
final class ReaderHeaderView: UIView {
  var onBack: (() -> Void)?
  var onTools: (() -> Void)?
  var onBookmark: (() -> Void)?
  private let bar = UIView()
  private let rule = UIView()
  private let title = readerCaption("", size: 11, tracking: 1.98)
  private lazy var back = readerButton("Back to library", symbol: "chevron-left") { [weak self] in self?.onBack?() }
  private lazy var tools = readerButton("Open reader tools", symbol: "ellipsis") { [weak self] in self?.onTools?() }
  private lazy var ribbon = readerButton("Add bookmark") { [weak self] in self?.onBookmark?() }
  private let ribbonShape = CAShapeLayer()
  override init(frame: CGRect) {
    super.init(frame: frame)
    ribbon.configuration?.title = nil
    ribbon.accessibilityIdentifier = "reader-bookmark"
    ribbon.layer.addSublayer(ribbonShape)
    addSubview(ribbon)
    addSubview(bar)
    for item in [rule, title, back, tools] { bar.addSubview(item) }
    title.textAlignment = .center
    title.lineBreakMode = .byTruncatingTail
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func layoutSubviews() {
    super.layoutSubviews()
    bar.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 56)
    rule.frame = CGRect(x: 0, y: 55, width: bounds.width, height: 1)
    back.frame = CGRect(x: 6, y: 6, width: 44, height: 44)
    tools.frame = CGRect(x: bounds.width - 50, y: 6, width: 44, height: 44)
    let titleWidth = min(bounds.width * 0.64, 576) - 32
    title.frame = CGRect(x: (bounds.width - titleWidth) / 2, y: 14, width: titleWidth, height: 28)
    ribbon.frame = CGRect(x: bounds.width - 52, y: 38, width: 44, height: 60)
    let path = UIBezierPath()
    path.move(to: CGPoint(x: 8.75, y: 0.75)); path.addLine(to: CGPoint(x: 35.25, y: 0.75))
    path.addLine(to: CGPoint(x: 35.25, y: 40)); path.addLine(to: CGPoint(x: 22, y: 51.25)); path.addLine(to: CGPoint(x: 8.75, y: 40)); path.close()
    ribbonShape.path = path.cgPath
  }
  func update(_ state: ReaderNativeState) {
    let colors = state.colors
    bar.backgroundColor = colors.canvas.withAlphaComponent(0.96)
    rule.backgroundColor = colors.rule.withAlphaComponent(0.7)
    title.attributedText = NSAttributedString(string: state.title.uppercased(), attributes: [.font: ReaderFont.body(11, weight: .medium), .kern: 1.98, .foregroundColor: colors.detail])
    for button in [back, tools] { button.style(colors, size: CGSize(width: 32, height: 32)) }
    ribbonShape.fillColor = (state.isBookmarked ? colors.soft : colors.canvas).cgColor
    ribbonShape.strokeColor = (state.isBookmarked ? colors.detail : colors.rule).cgColor
    ribbonShape.lineWidth = 1.5
    ribbon.accessibilityLabel = state.isBookmarked ? "Remove bookmark" : "Add bookmark"
    ribbon.accessibilityTraits = state.isBookmarked ? [.button, .selected] : [.button]
    UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.22, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
      self.ribbon.transform = CGAffineTransform(translationX: 0, y: state.isBookmarked ? 8 : 0)
    }
  }
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }
}

/// The original chapter row, page ruler, page count, and floating note action.
final class ReaderFooterView: UIView {
  let scrubber = ReaderScrubber()
  var command: ReaderNativeCommand?
  var onContents: (() -> Void)?
  var onNote: (() -> Void)?
  private var state: ReaderNativeState?
  private var pendingSequence = 0
  private let surface = UIView()
  private let line = UIView()
  private let count = UILabel()
  private lazy var previous = readerButton("Previous chapter", symbol: "chevron-left") { [weak self] in self?.chapter(previous: true) }
  private lazy var nextChapter = readerButton("Next chapter", symbol: "chevron-right") { [weak self] in self?.chapter(previous: false) }
  private lazy var chapterTitle = readerButton("Open table of contents") { [weak self] in self?.onContents?() }
  private lazy var note = readerButton("Jot a note", symbol: "pencil-line") { [weak self] in
    guard let self, let state = self.state else { return }
    self.scrubber.cancel(at: state.page); self.onNote?()
  }
  private let status = UIStackView()
  private let statusText = UILabel()
  private lazy var statusAction = readerButton("Start reading") { [weak self] in _ = self?.command?(["action": "start-reading"]) }
  private lazy var dismissStatus = readerButton("Dismiss reading status prompt", symbol: "x") { [weak self] in _ = self?.command?(["action": "dismiss-status"]) }
  override init(frame: CGRect) {
    super.init(frame: frame)
    addSubview(surface)
    for item in [line, previous, nextChapter, chapterTitle, scrubber, count] { surface.addSubview(item) }
    addSubview(note); addSubview(status)
    count.textAlignment = .center
    count.font = UIFont.monospacedDigitSystemFont(ofSize: 10, weight: .medium)
    status.axis = .horizontal; status.alignment = .center; status.spacing = 4
    status.isLayoutMarginsRelativeArrangement = true
    status.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 0)
    statusText.font = ReaderFont.body(12); statusText.numberOfLines = 2
    status.addArrangedSubview(statusText); status.addArrangedSubview(statusAction); status.addArrangedSubview(dismissStatus)
    statusAction.setContentHuggingPriority(.required, for: .horizontal)
    dismissStatus.setContentHuggingPriority(.required, for: .horizontal)
    scrubber.onPreview = { [weak self] in self?.preview($0) }
    scrubber.onCommit = { [weak self] page in
      guard let self else { return }
      self.pendingSequence = self.command?(["action": "page", "page": page]) ?? 0
    }
    chapterTitle.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes; attributes.font = ReaderFont.body(10, weight: .medium); attributes.kern = 1.6; return attributes
    }
    chapterTitle.configuration?.titleLineBreakMode = .byTruncatingTail
    chapterTitle.titleLabel?.numberOfLines = 1
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func layoutSubviews() {
    super.layoutSubviews()
    let footerY = bounds.height - 122
    surface.frame = CGRect(x: 0, y: footerY, width: bounds.width, height: 122)
    line.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 1)
    previous.frame = CGRect(x: 10, y: 0, width: 62, height: 44)
    nextChapter.frame = CGRect(x: bounds.width - 72, y: 0, width: 62, height: 44)
    chapterTitle.frame = CGRect(x: 80, y: 0, width: max(0, bounds.width - 160), height: 44)
    scrubber.frame = CGRect(x: 16, y: 36, width: max(0, bounds.width - 32), height: 56)
    count.frame = CGRect(x: 16, y: 94, width: max(0, bounds.width - 32), height: 16)
    status.frame = CGRect(x: 12, y: footerY - 56, width: max(0, bounds.width - 24), height: 44)
    note.frame = CGRect(x: bounds.width - 56, y: footerY - (status.isHidden ? 52 : 108), width: 44, height: 44)
  }
  func update(_ nextState: ReaderNativeState) {
    if state?.session != nextState.session { pendingSequence = 0; scrubber.cancel(at: nextState.page) }
    state = nextState
    let colors = nextState.colors
    surface.backgroundColor = colors.canvas.withAlphaComponent(0.96)
    line.backgroundColor = colors.rule.withAlphaComponent(0.7)
    for button in [previous, nextChapter, chapterTitle] { button.tintColor = colors.detail }
    note.style(colors, fill: 1, border: 0.8, radius: 22)
    note.configuration?.image = readerIcon("pencil-line", size: 20)
    note.tintColor = colors.ink
    note.isEnabled = nextState.paginationReady
    readerCard(status, colors: colors, fill: 1, border: 0.8, radius: 24)
    status.backgroundColor = colors.canvas
    statusText.text = nextState.error.isEmpty ? nextState.startTitle : nextState.error
    statusText.textColor = colors.ink
    statusAction.configuration?.title = nextState.startPending ? "Saving…" : nextState.startLabel
    statusAction.style(colors, fill: 1, border: 0, radius: 18)
    statusAction.surface.backgroundColor = colors.soft
    statusAction.isEnabled = !nextState.startPending
    dismissStatus.tintColor = colors.detail
    status.isHidden = nextState.startLabel.isEmpty
    count.textColor = colors.detail
    count.isHidden = !nextState.settings.showPageNumbers
    if nextState.acknowledged >= pendingSequence {
      scrubber.update(page: nextState.page, total: nextState.totalPages, chapters: nextState.spine.map(\.page).filter { $0 > 0 }, colors: colors, ready: nextState.paginationReady)
    }
    preview(scrubber.displayedPage)
    setNeedsLayout()
  }
  private func preview(_ page: Int) {
    guard let state else { return }
    let index = state.spine.lastIndex(where: { $0.page > 0 && $0.page <= page }) ?? state.currentChapterIndex
    let current = state.spine.indices.contains(index) ? state.spine[index] : nil
    let following = state.spine.indices.contains(index + 1) ? state.spine[index + 1] : nil
    chapterTitle.configuration?.title = current?.title.uppercased() ?? state.chapter.uppercased()
    previous.isHidden = index == 0
    nextChapter.isHidden = following == nil
    let backPage = page > (current?.page ?? page) ? current?.page : state.spine.first(where: { $0.index == index - 1 })?.page
    previous.configuration?.title = state.settings.showPageNumbers && (backPage ?? 0) > 0 ? "\(page - (backPage ?? page))p" : nil
    nextChapter.configuration?.title = state.settings.showPageNumbers && (following?.page ?? 0) > 0 ? "\((following?.page ?? page) - page)p" : nil
    nextChapter.configuration?.imagePlacement = .trailing
    for button in [previous, nextChapter] {
      button.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
        var attributes = attributes; attributes.font = ReaderFont.body(11); return attributes
      }
      button.isEnabled = state.paginationReady
    }
    count.text = "p. \(page) of \(state.totalPages)"
  }
  private func chapter(previous: Bool) {
    guard let state else { return }
    scrubber.cancel(at: state.page)
    let index = previous ? (state.page > (state.spine.first { $0.index == state.currentChapterIndex }?.page ?? state.page) ? state.currentChapterIndex : state.currentChapterIndex - 1) : state.currentChapterEndIndex + 1
    guard let chapter = state.spine.first(where: { $0.index == index }), chapter.page > 0 else { return }
    pendingSequence = command?(["action": "page", "page": chapter.page]) ?? 0
  }
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }
}

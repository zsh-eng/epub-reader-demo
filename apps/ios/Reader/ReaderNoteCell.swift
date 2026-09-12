import UIKit

/// NotebookNote in UIKit. The original cards and 72 pt edit/delete gestures
/// stay intact. Vertical scrolling wins until horizontal intent is clear.
final class ReaderNoteCell: UITableViewCell {
  var onEdit: (() -> Void)?
  var onDelete: (() -> Void)?
  private let card = UIStackView()
  private let quote = UILabel()
  private let quoteRule = UIView()
  private let quoteRow = UIStackView()
  private let body = UILabel()
  private let location = UILabel()
  private let time = UILabel()
  private let cue = UIImageView()
  private let progress = CAShapeLayer()
  private var colors = ReaderNativeColors.paper
  private var editable = false
  private var armed = false
  private var editingNote = false
  private var menuOpen = false
  private var copiedText = ""
  private var animator: UIViewPropertyAnimator?

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear; selectionStyle = .none
    card.axis = .vertical; card.spacing = 8
    card.isLayoutMarginsRelativeArrangement = true
    card.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)
    card.layer.cornerRadius = 16
    quote.font = ReaderFont.body(12); quote.numberOfLines = 1; quote.lineBreakMode = .byTruncatingTail
    quoteRow.axis = .horizontal; quoteRow.spacing = 8
    quoteRow.addArrangedSubview(quoteRule); quoteRow.addArrangedSubview(quote)
    quoteRule.widthAnchor.constraint(equalToConstant: 3).isActive = true
    body.font = ReaderFont.body(15); body.numberOfLines = 0
    location.font = ReaderFont.body(11); location.numberOfLines = 1; location.lineBreakMode = .byTruncatingTail
    time.font = ReaderFont.body(11)
    time.setContentHuggingPriority(.required, for: .horizontal); time.setContentCompressionResistancePriority(.required, for: .horizontal)
    let metadata = UIStackView(arrangedSubviews: [location, time]); metadata.spacing = 12; metadata.alignment = .center
    for label in [quote, body, location, time] { label.adjustsFontForContentSizeCategory = true }
    for view in [quoteRow, body, metadata] { card.addArrangedSubview(view) }
    card.setCustomSpacing(12, after: body)
    contentView.addSubview(cue); contentView.addSubview(card)
    card.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16), card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16), card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4), card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
    ])
    cue.contentMode = .center; cue.alpha = 0
    cue.layer.addSublayer(progress); progress.fillColor = UIColor.clear.cgColor; progress.lineWidth = 1.5
    let pan = UIPanGestureRecognizer(target: self, action: #selector(drag(_:))); pan.delegate = self
    contentView.addGestureRecognizer(pan)
    isAccessibilityElement = true
    accessibilityHint = "Double tap to visit this page. Use actions to copy, edit, or delete."
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func prepareForReuse() {
    super.prepareForReuse(); animator?.stopAnimation(true); animator = nil; card.transform = .identity; cue.alpha = 0; armed = false; menuOpen = false
    onEdit = nil; onDelete = nil
  }
  func configure(_ note: ReaderNativeNote, colors: ReaderNativeColors, editing: Bool, byBook: Bool = false) {
    copiedText = note.text; editable = note.kind == "note"; self.colors = colors; self.editingNote = editing
    card.backgroundColor = colors.soft
    applyRing()
    quote.text = note.quote; quoteRow.isHidden = note.quote.isEmpty; quote.textColor = colors.detail
    quoteRule.backgroundColor = note.quoteColor == "invisible" ? colors.detail : colors.mark("\(note.quoteColor)-secondary")
    let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = 4
    body.attributedText = NSAttributedString(string: note.text, attributes: [.font: ReaderFont.body(15), .foregroundColor: colors.ink, .paragraphStyle: paragraph])
    location.text = (byBook ? "" : "\(note.chapter) · ") + (note.page > 0 ? "p. \(note.page)" : "Location unavailable")
    location.textColor = colors.detail
    time.text = Date(timeIntervalSince1970: note.createdAt / 1000).formatted(date: .omitted, time: .shortened); time.textColor = colors.detail
    accessibilityLabel = [note.text, note.quote, location.text ?? "", time.text ?? ""].filter { !$0.isEmpty }.joined(separator: ". ")
    accessibilityCustomActions = [
      UIAccessibilityCustomAction(name: "Copy", actionHandler: { [weak self] _ in UIPasteboard.general.string = self?.copiedText; return true }),
      UIAccessibilityCustomAction(name: "Delete", actionHandler: { [weak self] _ in self?.onDelete?(); return true }),
    ]
    if editable { accessibilityCustomActions?.insert(UIAccessibilityCustomAction(name: "Edit", actionHandler: { [weak self] _ in self?.onEdit?(); return true }), at: 1) }
  }
  func setMenuOpen(_ value: Bool) { menuOpen = value; applyRing() }
  private func applyRing() { card.layer.borderWidth = editingNote || menuOpen ? 1 : 0; card.layer.borderColor = colors.detail.cgColor }
  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
    let translation = pan.translation(in: contentView)
    let direction = abs(translation.x) + abs(translation.y) > 2 ? translation : pan.velocity(in: contentView)
    return abs(direction.x) > abs(direction.y) * 1.25 && (direction.x > 0 || editable) && !menuOpen
  }
  @objc private func drag(_ pan: UIPanGestureRecognizer) {
    let translation = pan.translation(in: contentView).x
    switch pan.state {
    case .began:
      ReaderHaptics.prepare()
      let current = card.layer.presentation()?.affineTransform().tx ?? card.transform.tx
      animator?.stopAnimation(true); animator = nil; armed = false
      card.transform = CGAffineTransform(translationX: current, y: 0)
      pan.setTranslation(CGPoint(x: current + translation, y: 0), in: contentView)
    case .changed:
      if translation < 0 && !editable { card.transform = .identity; cue.alpha = 0; armed = false; return }
      let magnitude = abs(translation)
      let distance = min(magnitude, 120) + max(0, magnitude - 120) * 0.15
      card.transform = CGAffineTransform(translationX: translation < 0 ? -distance : distance, y: 0)
      let edit = translation < 0
      cue.image = readerIcon(edit ? "pencil-line" : "trash-2", size: 18)
      cue.tintColor = edit ? colors.detail : colors.mark("destructive")
      cue.frame = CGRect(x: edit ? bounds.width - 64 : 28, y: bounds.midY - 18, width: 36, height: 36)
      cue.alpha = min(1, max(0, (magnitude - 4) / 44))
      progress.path = UIBezierPath(arcCenter: CGPoint(x: 18, y: 18), radius: 17, startAngle: -.pi / 2, endAngle: .pi * 1.5, clockwise: true).cgPath
      progress.strokeColor = cue.tintColor.cgColor; progress.strokeEnd = min(1, magnitude / 72)
      let ready = magnitude >= 72
      if ready && !armed { ReaderHaptics.selection() }
      armed = ready
    case .ended:
      let action = abs(translation) >= 72 ? (translation < 0 ? (editable ? onEdit : nil) : onDelete) : nil
      reset(velocity: pan.velocity(in: contentView).x)
      action?()
    case .cancelled, .failed: reset(velocity: 0)
    default: break
    }
  }
  private func reset(velocity: CGFloat) {
    armed = false
    let distance = -card.transform.tx
    let timing = UISpringTimingParameters(dampingRatio: 1, initialVelocity: CGVector(dx: abs(distance) > 1 ? max(-8, min(8, velocity / distance)) : 0, dy: 0))
    let animation = UIViewPropertyAnimator(duration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.25, timingParameters: timing)
    animator = animation
    animation.addAnimations { self.card.transform = .identity; self.cue.alpha = 0 }
    animation.addCompletion { [weak self] _ in self?.animator = nil }
    animation.startAnimation()
  }
}

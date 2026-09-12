import UIKit

/// A nonmodal reading companion. One footer/input stays in this hierarchy while
/// the system keyboard guide moves its bottom edge. Notes expand independently.
/// The book view beneath this sibling never changes size or loses its selection.
final class ReaderNotebookSurface: UIView, UIGestureRecognizerDelegate {
  enum Detent { case compact, half, full }
  let footer = UIStackView()
  let body = UIView()
  private let sheet = UIView()
  private let handle = UIButton(type: .custom)
  private let mark = UIView()
  private var height: NSLayoutConstraint!
  private var leading: NSLayoutConstraint!
  private var trailing: NSLayoutConstraint!
  private var footerBottom: NSLayoutConstraint!
  private var animator: UIViewPropertyAnimator?
  private var keyboardObserver: NSObjectProtocol?
  private var dragHeight: CGFloat = 0
  private var compactHeight: CGFloat = 80
  private(set) var detent = Detent.compact
  private(set) var isOpen = false
  var isTyping = false { didSet { updateInsets() } }
  var onDismiss: (() -> Void)?
  var onExpand: (() -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    sheet.layer.cornerRadius = 28
    sheet.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
    sheet.layer.cornerCurve = .continuous
    sheet.layer.borderWidth = 1
    body.clipsToBounds = true
    addSubview(sheet)
    for item in [handle, body, footer] { sheet.addSubview(item); item.translatesAutoresizingMaskIntoConstraints = false }
    handle.addSubview(mark)
    mark.layer.cornerRadius = 2
    handle.accessibilityLabel = "Notebook size"
    handle.accessibilityIdentifier = "reader-notebook-handle"
    handle.accessibilityHint = "Double tap to expand or collapse notes. Drag vertically to resize."
    handle.addAction(UIAction { [weak self] _ in self?.toggle() }, for: .touchUpInside)
    handle.accessibilityCustomActions = [
      UIAccessibilityCustomAction(name: "Expand notes", actionHandler: { [weak self] _ in self?.expand(); return true }),
      UIAccessibilityCustomAction(name: "Collapse notes", actionHandler: { [weak self] _ in self?.collapse(); return true }),
      UIAccessibilityCustomAction(name: "Close notebook", actionHandler: { [weak self] _ in self?.onDismiss?(); return true }),
    ]
    let pan = UIPanGestureRecognizer(target: self, action: #selector(drag(_:)))
    pan.delegate = self; handle.addGestureRecognizer(pan)
    sheet.translatesAutoresizingMaskIntoConstraints = false
    height = sheet.heightAnchor.constraint(equalToConstant: compactHeight)
    leading = footer.leadingAnchor.constraint(equalTo: sheet.safeAreaLayoutGuide.leadingAnchor, constant: 16)
    trailing = footer.trailingAnchor.constraint(equalTo: sheet.safeAreaLayoutGuide.trailingAnchor, constant: -16)
    footerBottom = footer.bottomAnchor.constraint(equalTo: sheet.bottomAnchor, constant: -8)
    NSLayoutConstraint.activate([
      sheet.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor), sheet.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor),
      sheet.bottomAnchor.constraint(equalTo: keyboardLayoutGuide.topAnchor), height,
      handle.topAnchor.constraint(equalTo: sheet.topAnchor), handle.leadingAnchor.constraint(equalTo: sheet.leadingAnchor), handle.trailingAnchor.constraint(equalTo: sheet.trailingAnchor), handle.heightAnchor.constraint(equalToConstant: 28),
      body.topAnchor.constraint(equalTo: handle.bottomAnchor), body.leadingAnchor.constraint(equalTo: sheet.leadingAnchor), body.trailingAnchor.constraint(equalTo: sheet.trailingAnchor), body.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -4),
      leading, trailing, footerBottom,
    ])
    // A floating iPad keyboard should not pull a full-width reading panel around.
    keyboardLayoutGuide.followsUndockedKeyboard = false
    keyboardObserver = NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] notification in
      guard let self, self.window != nil else { return }
      self.updateInsets()
      let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
      let curve = notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
      UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : duration, delay: 0, options: [UIView.AnimationOptions(rawValue: curve << 16), .beginFromCurrentState, .allowUserInteraction]) { self.layoutIfNeeded() }
    }
    sheet.isHidden = true
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  deinit { if let keyboardObserver { NotificationCenter.default.removeObserver(keyboardObserver) } }
  var availableInputWidth: CGFloat { max(1, bounds.width - safeAreaInsets.left - safeAreaInsets.right - leading.constant * 2) }
  override func layoutSubviews() {
    super.layoutSubviews()
    handle.layoutIfNeeded()
    mark.frame = CGRect(x: sheet.bounds.midX - 20, y: 12, width: 40, height: 4)
    let expanded = sheet.bounds.height > compactHeight + 36
    body.alpha = expanded ? 1 : 0
    body.isUserInteractionEnabled = expanded
    body.accessibilityElementsHidden = !expanded
    handle.accessibilityValue = expanded ? "Notes expanded" : "Input only"
    // Measuring the footer does not include the keyboard or book viewport.
    let measured = footer.systemLayoutSizeFitting(CGSize(width: availableInputWidth, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height + 40
    if abs(compactHeight - measured) > 0.5 {
      compactHeight = measured
      if detent == .compact && animator == nil { height.constant = compactHeight }
    }
    let maximum = max(compactHeight, keyboardLayoutGuide.layoutFrame.minY - 12)
    if height.constant > maximum && animator == nil { height.constant = maximum }
  }
  func apply(_ colors: ReaderNativeColors) {
    sheet.backgroundColor = colors.canvas
    sheet.layer.borderColor = colors.rule.withAlphaComponent(0.5).cgColor
    mark.backgroundColor = colors.rule.withAlphaComponent(0.8)
  }
  func open() {
    guard !isOpen else { return }
    isOpen = true; sheet.isHidden = false; detent = .compact
    height.constant = compactHeight; layoutIfNeeded()
    if !UIAccessibility.isReduceMotionEnabled { sheet.transform = CGAffineTransform(translationX: 0, y: compactHeight) }
    UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.25, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) { self.sheet.transform = .identity }
  }
  func close() {
    isOpen = false; animator?.stopAnimation(true); animator = nil
    endEditing(true); sheet.isHidden = true; detent = .compact; height.constant = compactHeight
  }
  func expand() { onExpand?(); settle(.half) }
  func collapse() { settle(.compact) }
  private func toggle() { detent == .compact ? expand() : collapse() }
  private func updateInsets() {
    leading.constant = isTyping ? 8 : 16
    trailing.constant = -leading.constant
    setNeedsLayout()
  }
  private func targetHeight(_ detent: Detent) -> CGFloat {
    let maxHeight = max(compactHeight, keyboardLayoutGuide.layoutFrame.minY - 12)
    switch detent {
    case .compact: return compactHeight
    case .half: return min(maxHeight, max(compactHeight + 160, bounds.height * 0.56))
    case .full: return maxHeight
    }
  }
  private func stopAnimation() {
    guard let animator else { return }
    let visible = sheet.layer.presentation()?.bounds.height ?? sheet.bounds.height
    animator.stopAnimation(true); self.animator = nil
    height.constant = visible; layoutIfNeeded()
  }
  private func settle(_ next: Detent, velocity: CGFloat = 0) {
    stopAnimation()
    detent = next
    let target = targetHeight(next)
    let distance = target - height.constant
    guard abs(distance) > 0.5 else { return }
    let timing = UISpringTimingParameters(dampingRatio: 1, initialVelocity: CGVector(dx: 0, dy: max(-8, min(8, -velocity / distance))))
    let animation = UIViewPropertyAnimator(duration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.35, timingParameters: timing)
    animator = animation
    height.constant = target
    animation.addAnimations { self.layoutIfNeeded() }
    animation.addCompletion { [weak self] _ in self?.animator = nil }
    animation.startAnimation()
  }
  @objc private func drag(_ pan: UIPanGestureRecognizer) {
    switch pan.state {
    case .began:
      stopAnimation(); dragHeight = sheet.bounds.height
    case .changed:
      let proposed = dragHeight - pan.translation(in: self).y
      let maximum = targetHeight(.full)
      if proposed > maximum { height.constant = maximum + (proposed - maximum) * 0.15 }
      else if proposed < compactHeight { height.constant = compactHeight - (compactHeight - proposed) * 0.45 }
      else { height.constant = proposed }
      layoutIfNeeded()
    case .ended:
      let velocity = pan.velocity(in: self).y
      if height.constant < compactHeight * 0.7 || (detent == .compact && velocity > 700) { onDismiss?(); return }
      let projected = height.constant - velocity * 0.16
      let next = [Detent.compact, .half, .full].min { abs(targetHeight($0) - projected) < abs(targetHeight($1) - projected) } ?? .compact
      if next != detent { ReaderHaptics.selection() }
      settle(next, velocity: velocity)
    case .cancelled, .failed: settle(detent)
    default: break
    }
  }
  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
    let translation = pan.translation(in: self)
    let direction = abs(translation.x) + abs(translation.y) > 2 ? translation : pan.velocity(in: self)
    return abs(direction.y) > abs(direction.x)
  }
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard isOpen, sheet.frame.contains(point) else { return nil }
    return super.hitTest(point, with: event)
  }
}

import SwiftUI
import UIKit

/// Six local layers follow the scroll offset directly. No timer, SwiftUI
/// publication, list layout or network work occurs during the gesture.
@MainActor final class DiscoveryMotion {
  weak var shelf: DiscoveryShelfView?
  weak var target: UIView?
  weak var surface: UIView?
  var enabled = false
  var reduceMotion = false
  private var copies: [UIImageView] = []
  private var probe: UILabel?

  func attach(_ view: UIView) {
    surface = view
    for copy in copies { copy.removeFromSuperview() }
    copies = (0...ArcticPublisher.all.count).map { _ in
      let copy = UIImageView()
      copy.contentMode = .scaleAspectFill
      copy.clipsToBounds = true
      copy.isUserInteractionEnabled = false
      copy.bounds = CGRect(x: 0, y: 0, width: 58, height: 58)
      copy.layer.cornerRadius = 29
      view.addSubview(copy)
      return copy
    }
    if TestMode.enabled {
      probe?.removeFromSuperview()
      let label = UILabel(frame: CGRect(x: 0, y: 0, width: 90, height: 10))
      label.font = .systemFont(ofSize: 6)
      label.accessibilityIdentifier = "discovery-collapse"
      label.isUserInteractionEnabled = false
      view.addSubview(label)
      probe = label
    }
    update()
  }

  func update() {
    guard let shelf, let surface, let target, shelf.window === surface.window,
      target.window === surface.window, let scroll = shelf.verticalScroll
    else {
      for copy in copies { copy.alpha = 0 }
      return
    }
    let travel = max(0, scroll.contentOffset.y + scroll.adjustedContentInset.top)
    let destination = target.convert(
      CGPoint(x: target.bounds.midX, y: target.bounds.midY), to: surface)
    let first = shelf.icons[0]
    let current = first.convert(CGPoint(x: 29, y: 29), to: surface)
    let distance = max(80, current.y + travel - destination.y)
    let progress = min(1, travel / distance)
    let active = enabled && !shelf.isHidden
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for (index, icon) in shelf.icons.enumerated() {
      let copy = copies[index]
      copy.image = icon.image
      copy.contentMode = icon.contentMode
      copy.backgroundColor = icon.backgroundColor
      let rect = icon.convert(icon.bounds, to: surface)
      let visibleWidth = rect.intersection(
        shelf.scroller.convert(shelf.scroller.bounds, to: surface)
      ).width
      let flying = active && !reduceMotion && progress > 0 && progress < 1 && visibleWidth > 30
      // The real controls retain their layout. Only visual layers move.
      icon.alpha = active ? (reduceMotion ? max(0, 1 - progress * 2) : (progress == 0 ? 1 : 0)) : 1
      shelf.labels[index].alpha = active ? max(0, 1 - progress * 4) : 1
      shelf.buttons[index].isUserInteractionEnabled = !active || progress < 0.12
      copy.alpha = flying ? min(1, (1 - progress) / 0.28) : 0
      guard flying else { continue }
      let gather = min(1, progress / 0.72)
      let eased = gather * gather * (3 - 2 * gather)
      let fan = CGFloat(index - 2) * 4 * sin(progress * .pi)
      let x = rect.midX + (destination.x - rect.midX) * eased + fan
      let y = current.y + travel + (destination.y - current.y - travel) * progress
      copy.center = CGPoint(x: x, y: y)
      copy.transform = CGAffineTransform(scaleX: 1 - 0.62 * progress, y: 1 - 0.62 * progress)
    }
    if TestMode.enabled {
      probe?.text =
        enabled ? "\(Int(progress * 100)); \(reduceMotion ? "fade" : "gather")" : "inactive"
    }
    CATransaction.commit()
  }
}

struct DiscoveryFlightSurface: UIViewRepresentable {
  let motion: DiscoveryMotion
  let enabled: Bool
  @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
  @Environment(\.articleReduceMotion) private var appReduceMotion

  func makeUIView(context: Context) -> UIView {
    let view = UIView()
    view.isUserInteractionEnabled = false
    motion.attach(view)
    return view
  }
  func updateUIView(_ view: UIView, context: Context) {
    motion.enabled = enabled
    motion.reduceMotion = systemReduceMotion || appReduceMotion
    motion.update()
  }
}

struct DiscoveryTarget: UIViewRepresentable {
  let motion: DiscoveryMotion
  func makeUIView(context: Context) -> DiscoveryTargetView {
    let view = DiscoveryTargetView()
    view.motion = motion
    motion.target = view
    return view
  }
  func updateUIView(_ view: DiscoveryTargetView, context: Context) { motion.target = view }
}

final class DiscoveryTargetView: UIView {
  weak var motion: DiscoveryMotion?
  override func layoutSubviews() {
    super.layoutSubviews()
    motion?.update()
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    motion?.update()
  }
}

struct NativeDiscoveryShelf: UIViewRepresentable {
  let motion: DiscoveryMotion
  let open: (URL) -> Void
  let weekly: () -> Void
  func makeUIView(context: Context) -> DiscoveryShelfView {
    DiscoveryShelfView(motion: motion)
  }
  func updateUIView(_ view: DiscoveryShelfView, context: Context) {
    view.open = open
    view.weekly = weekly
    view.updatePalette()
  }
}

final class DiscoveryShelfView: UIView {
  let scroller = UIScrollView()
  var icons: [UIImageView] = []
  var labels: [UILabel] = []
  var buttons: [UIButton] = []
  weak var verticalScroll: UIScrollView?
  private var verticalObservation: NSKeyValueObservation?
  private var horizontalObservation: NSKeyValueObservation?
  private let motion: DiscoveryMotion
  var open: (URL) -> Void = { _ in }
  var weekly: () -> Void = {}

  init(motion: DiscoveryMotion) {
    self.motion = motion
    super.init(frame: .zero)
    motion.shelf = self
    scroller.showsHorizontalScrollIndicator = false
    scroller.alwaysBounceHorizontal = true
    scroller.contentInsetAdjustmentBehavior = .never
    addSubview(scroller)
    let titles = ["This week"] + ArcticPublisher.all.map(\.name)
    for (index, title) in titles.enumerated() {
      let button = UIButton(type: .custom)
      button.accessibilityLabel = index == 0 ? "Favourites this week" : "Browse " + title
      button.accessibilityIdentifier =
        index == 0
        ? "weekly-favourites" : "publisher-" + (ArcticPublisher.all[index - 1].url.host ?? "")
      button.accessibilityHint = index == 0 ? nil : "Opens through Unwall"
      button.addAction(
        UIAction { [weak self] _ in
          guard let self else { return }
          if index == 0 { self.weekly() } else { self.open(ArcticPublisher.all[index - 1].url) }
        }, for: .touchUpInside)
      let icon = UIImageView()
      icon.contentMode = index == 0 ? .center : .scaleAspectFill
      icon.clipsToBounds = true
      icon.layer.cornerRadius = 29
      if index > 0 { icon.backgroundColor = .white }
      icon.image =
        index == 0
        ? UIImage(
          systemName: "star.fill",
          withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .medium))
        : UIImage(named: ArcticPublisher.all[index - 1].asset)
      let label = UILabel()
      label.text = title
      label.font = .preferredFont(forTextStyle: .caption2)
      label.adjustsFontForContentSizeCategory = true
      label.textAlignment = .center
      label.lineBreakMode = .byTruncatingTail
      button.addSubview(icon)
      button.addSubview(label)
      scroller.addSubview(button)
      icons.append(icon)
      labels.append(label)
      buttons.append(button)
    }
    horizontalObservation = scroller.observe(\.contentOffset) { [weak self] _, _ in
      self?.motion.update()
    }
    updatePalette()
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  func updatePalette() {
    icons[0].tintColor = UIColor(ArcticBrand.accent)
    icons[0].backgroundColor = UIColor(ArcticBrand.accent).withAlphaComponent(0.1)
    for label in labels { label.textColor = .label }
    motion.update()
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    scroller.frame = bounds
    scroller.contentSize = CGSize(width: CGFloat(buttons.count) * 86 + 22, height: bounds.height)
    for index in buttons.indices {
      buttons[index].frame = CGRect(x: 16 + CGFloat(index) * 86, y: 0, width: 68, height: 88)
      icons[index].frame = CGRect(x: 5, y: 4, width: 58, height: 58)
      labels[index].frame = CGRect(x: 0, y: 70, width: 68, height: 18)
    }
    bindScrollView()
    motion.update()
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      verticalObservation = nil
      verticalScroll = nil
    } else {
      bindScrollView()
    }
    motion.update()
  }
  private func bindScrollView() {
    var ancestor = superview
    while let view = ancestor {
      if let scroll = view as? UIScrollView {
        guard verticalScroll !== scroll else { return }
        verticalScroll = scroll
        verticalObservation = scroll.observe(\.contentOffset) { [weak self] _, _ in
          self?.motion.update()
        }
        return
      }
      ancestor = view.superview
    }
  }
}

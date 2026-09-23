import SwiftUI
import UIKit

/// Explicit selections crossfade beneath an immutable outgoing snapshot.
/// Only the page controller's interactive swipe moves pages horizontally.
/// The controller and its frame stay stable through taps, swipes and updates.
struct LibraryPager<Page: Hashable, Content: View>: UIViewControllerRepresentable {
  var pages: [Page]
  @Binding var selection: Page
  var reduceMotion: Bool
  @ViewBuilder var content: (Page) -> Content

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIViewController(context: Context) -> UIPageViewController {
    let pager = UIPageViewController(transitionStyle: .scroll, navigationOrientation: .horizontal)
    pager.view.backgroundColor = .clear
    pager.dataSource = context.coordinator
    pager.delegate = context.coordinator
    context.coordinator.pager = pager
    pager.setViewControllers([context.coordinator.host(for: selection)], direction: .forward, animated: false)
    return pager
  }

  func updateUIViewController(_ pager: UIPageViewController, context: Context) {
    context.coordinator.update(self)
  }

  static func dismantleUIViewController(_ pager: UIPageViewController, coordinator: Coordinator) {
    coordinator.fade?.stopAnimation(true)
    coordinator.snapshot?.removeFromSuperview()
    pager.dataSource = nil
    pager.delegate = nil
  }

  @MainActor final class Host: UIHostingController<Content> {
    let page: Page
    init(page: Page, rootView: Content) {
      self.page = page
      super.init(rootView: rootView)
      safeAreaRegions = []
      view.backgroundColor = .clear
    }
    @available(*, unavailable)
    required dynamic init?(coder: NSCoder) { fatalError("Not used") }
  }

  @MainActor final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
    var owner: LibraryPager
    weak var pager: UIPageViewController?
    var hosts: [Page: Host] = [:]
    var requested: Page
    var moving = false
    var pending: Page?
    var snapshot: UIView?
    var fade: UIViewPropertyAnimator?

    init(_ owner: LibraryPager) {
      self.owner = owner
      requested = owner.selection
    }

    func host(for page: Page) -> Host {
      if let host = hosts[page] {
        host.rootView = owner.content(page)
        return host
      }
      let host = Host(page: page, rootView: owner.content(page))
      hosts[page] = host
      return host
    }

    func update(_ owner: LibraryPager) {
      self.owner = owner
      if requested != owner.selection {
        requested = owner.selection
        if moving { pending = requested }
        else { navigate(to: requested) }
      }
      // Only the visible page needs a new value tree. Neighbours are refreshed
      // by the data source when UIKit requests them, not on every library update.
      if let current = pager?.viewControllers?.first as? Host {
        current.rootView = owner.content(current.page)
      }
      hosts = hosts.filter { owner.pages.contains($0.key) }
    }

    private func navigate(to page: Page) {
      guard let pager, let current = pager.viewControllers?.first as? Host,
        current.page != page, let to = owner.pages.firstIndex(of: page)
      else { return }
      let from = owner.pages.firstIndex(of: current.page)
      let direction: UIPageViewController.NavigationDirection = to > (from ?? 0) ? .forward : .reverse
      // Capture the current presentation before cancelling an earlier fade.
      // A second tap can therefore continue from what is actually on screen.
      let cover = pager.view.snapshotView(afterScreenUpdates: false)
      fade?.stopAnimation(true)
      snapshot?.removeFromSuperview()
      snapshot = cover
      let destination = host(for: page)
      UIView.performWithoutAnimation {
        pager.setViewControllers([destination], direction: direction, animated: false)
        pager.view.layoutIfNeeded()
      }
      guard let cover else { return }
      cover.frame = pager.view.bounds
      cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      cover.isUserInteractionEnabled = false
      cover.accessibilityElementsHidden = true
      pager.view.addSubview(cover)
      let animator = UIViewPropertyAnimator(duration: owner.reduceMotion ? 0.1 : 0.18, curve: .easeOut) {
        cover.alpha = 0
      }
      animator.addCompletion { [weak self, weak cover] _ in
        cover?.removeFromSuperview()
        guard let self, self.snapshot === cover else { return }
        self.snapshot = nil
        self.fade = nil
      }
      fade = animator
      animator.startAnimation()
    }

    private func finishTransition() {
      moving = false
      guard let next = pending else { return }
      pending = nil
      navigate(to: next)
    }

    func pageViewController(_ pageViewController: UIPageViewController,
      viewControllerBefore viewController: UIViewController) -> UIViewController? {
      guard let host = viewController as? Host, let index = owner.pages.firstIndex(of: host.page), index > 0
      else { return nil }
      return self.host(for: owner.pages[index - 1])
    }

    func pageViewController(_ pageViewController: UIPageViewController,
      viewControllerAfter viewController: UIViewController) -> UIViewController? {
      guard let host = viewController as? Host, let index = owner.pages.firstIndex(of: host.page),
        index + 1 < owner.pages.count else { return nil }
      return self.host(for: owner.pages[index + 1])
    }

    func pageViewController(_ pageViewController: UIPageViewController,
      willTransitionTo pendingViewControllers: [UIViewController]) {
      fade?.stopAnimation(true)
      snapshot?.removeFromSuperview()
      fade = nil
      snapshot = nil
      moving = true
    }

    func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool,
      previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
      if completed, pending == nil, let current = pageViewController.viewControllers?.first as? Host {
        requested = current.page
        owner.selection = current.page
      }
      finishTransition()
    }
  }
}

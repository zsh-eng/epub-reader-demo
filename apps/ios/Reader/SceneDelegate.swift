import UIKit

/// The app supports one scene. Window visibility owns reading-time accounting;
/// the shared runtime keeps the storage origin and import queue alive.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  private var app: ReaderAppController?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene, let delegate = UIApplication.shared.delegate as? AppDelegate else { return }
    let app = ReaderAppController(runtime: delegate.runtime)
    self.app = app
    let window = UIWindow(windowScene: scene)
    window.rootViewController = app
    self.window = window
    window.makeKeyAndVisible()
    for context in options.urlContexts { app.open(context.url) }
  }
  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    for context in contexts { app?.open(context.url) }
  }
  func sceneDidBecomeActive(_ scene: UIScene) { app?.setActive(true) }
  func sceneWillResignActive(_ scene: UIScene) { app?.setActive(false) }
  func sceneDidDisconnect(_ scene: UIScene) { app?.setActive(false) }
}

import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  private let runtime = ReaderRuntime()
  private var app: ReaderAppController!

  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    app = ReaderAppController(runtime: runtime)
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = app
    self.window = window
    window.makeKeyAndVisible()
    if let url = options?[.url] as? URL { app.open(url) }
    return true
  }

  func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    self.app.open(url)
    return true
  }

  func applicationDidBecomeActive(_ application: UIApplication) { app.setActive(true) }
  func applicationWillResignActive(_ application: UIApplication) { app.setActive(false) }
}

import XCTest

final class ReaderPerformanceUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  @MainActor func testSlowPublisherPreloadsCancelBeforeStartingMore() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-long-list",
      "-hold-publisher-image", "-test-preloading",
    ]
    app.launch()
    let started = app.staticTexts["publisher-loads-started"]
    // At least a second pair must start, proving slow rows do not block the
    // viewport forever. Requests stay held until WebKit cancels them.
    let progressed = expectation(
      for: NSPredicate { _, _ in (Int(started.label) ?? 0) >= 4 }, evaluatedWith: started)
    wait(for: [progressed], timeout: 30)
    let active = app.staticTexts["publisher-loads-active"]
    let bounded = expectation(
      for: NSPredicate { _, _ in (Int(active.label) ?? 99) <= 2 }, evaluatedWith: active)
    wait(for: [bounded], timeout: 3)
    capture(app, "bounded-slow-publisher-preloads")
    // An expired speculative page must open as a new foreground load, never
    // reuse a stopped document with a permanently disabled Reader action.
    let requested = app.staticTexts["preload-requested"].label
    let firstPath = requested.split(separator: ",").first.map(String.init) ?? "missing"
    let first = app.buttons["article-" + firstPath]
    XCTAssertTrue(first.exists)
    first.tap()
    XCTAssertEqual(app.staticTexts["reader-open-state"].label, "cold")
    XCTAssertTrue(app.webViews.staticTexts["Publisher navigation"].waitForExistence(timeout: 5))
  }

  @MainActor func testBackgroundReleasesNeighborsAndPreservesOpenReader() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-preload-fixtures",
      "-test-preloading", "-articles-offline",
    ]
    app.launch()
    let ready = app.staticTexts["preload-ready"]
    let prepared = expectation(
      for: NSPredicate(format: "label CONTAINS 'cached-0' AND label CONTAINS ','"),
      evaluatedWith: ready)
    wait(for: [prepared], timeout: 20)
    XCUIDevice.shared.press(.home)
    XCTAssertTrue(app.wait(for: .runningBackground, timeout: 5))
    app.activate()
    XCTAssertEqual(app.staticTexts["background-browser-count"].label, "0")
    let preparedAgain = expectation(
      for: NSPredicate(format: "label CONTAINS 'cached-0'"), evaluatedWith: ready)
    wait(for: [preparedAgain], timeout: 20)
    app.buttons["article-cached-0"].tap()
    XCTAssertEqual(app.staticTexts["reader-open-state"].label, "prepared")
    let text = app.webViews.staticTexts[
      "“Slow down,” she said — café, naïve, 日本語. Keep every character intact."]
    XCTAssertTrue(text.waitForExistence(timeout: 5))
    XCUIDevice.shared.press(.home)
    XCTAssertTrue(app.wait(for: .runningBackground, timeout: 5))
    app.activate()
    XCTAssertEqual(app.staticTexts["background-browser-count"].label, "1")
    XCTAssertTrue(text.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Website"].exists)
    capture(app, "reader-preserved-after-background")
  }

  @MainActor func testReaderTextDoesNotWaitForArtworkOrBodyImages() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard", "-hold-reader-artwork",
    ]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    open.tap()
    let bookmark = app.buttons["reader-save"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    if bookmark.value as? String == "Not saved" { bookmark.tap() }
    showReader(app)
    let appearance = app.buttons["reader-appearance"]
    let heldArtwork = expectation(
      for: NSPredicate(format: "value CONTAINS 'artwork held'"), evaluatedWith: appearance)
    wait(for: [heldArtwork], timeout: 5)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    capture(app, "reader-text-with-artwork-held")

    // Open the saved HTML with a subresource that never finishes. This proves
    // document readiness does not depend on WebKit's didFinish navigation event.
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-hold-reader-body-image"]
    app.launchEnvironment = [:]
    app.launch()
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.tap()
    showReader(app)
    let heldBodyImage = expectation(
      for: NSPredicate(format: "value CONTAINS 'resource load pending'"), evaluatedWith: appearance)
    wait(for: [heldBodyImage], timeout: 5)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    capture(app, "cached-reader-with-body-image-held")
  }

  @MainActor func testPreloadedPublisherRedirectRetainsRequestedCacheIdentity() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard", "-test-preloading"]
    // TestMode resolves this alias to story.html. Its final source URL becomes
    // fixture.example/story, while the requested library identity stays below.
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/redirect-story"
    app.launch()
    let ready = expectation(
      for: NSPredicate(format: "label CONTAINS 'redirect-story'"),
      evaluatedWith: app.staticTexts["preload-ready"])
    wait(for: [ready], timeout: 20)
    app.buttons["open-copied-link"].tap()
    XCTAssertTrue(app.buttons["reader-toggle"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["reader-open-state"].label, "prepared")
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    capture(app, "warm-redirected-reader")
    let bookmark = app.buttons["reader-save"]
    if bookmark.value as? String == "Not saved" { bookmark.tap() }
    XCTAssertEqual(bookmark.value as? String, "Saved")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.buttons["article-redirect-story"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-story"].exists)
    app.buttons["folder-history"].tap()
    XCTAssertTrue(app.buttons["article-redirect-story"].exists)
    XCTAssertFalse(app.buttons["article-story"].exists)

    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline"]
    app.launchEnvironment = [:]
    app.launch()
    let card = app.buttons["article-redirect-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.tap()
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    XCTAssertFalse(app.alerts["Could not open article"].exists)
    capture(app, "redirected-reader-saved-offline")
  }

  @MainActor func testBundledReaderFontsRemainAvailableOffline() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard", "-test-reader-fonts",
    ]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/unicode"
    app.launch()
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    open.tap()
    let bookmark = app.buttons["reader-save"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    if bookmark.value as? String == "Not saved" { bookmark.tap() }
    showReader(app)
    chooseFont("DM Sans", in: app)
    expectLoadedFont("DM Sans", in: app)
    capture(app, "bundled-font-fresh-reader")

    // A cached Reader has a local base URL rather than the initial HTML's opaque
    // origin. Both must receive the bundled font with website loading disabled.
    app.terminate()
    app.launchArguments = [
      "-ui-testing", "-articles-offline", "-images-offline", "-test-reader-fonts",
    ]
    app.launchEnvironment = [:]
    app.launch()
    let card = app.buttons["article-unicode"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.tap()
    showReader(app)
    expectLoadedFont("DM Sans", in: app)
    chooseFont("EB Garamond", in: app)
    expectLoadedFont("EB Garamond", in: app)
    XCTAssertTrue(
      app.webViews.staticTexts[
        "“Slow down,” she said — café, naïve, 日本語. Keep every character intact."
      ].exists)
    capture(app, "bundled-font-offline-garamond")
  }

  @MainActor private func chooseFont(_ family: String, in app: XCUIApplication) {
    app.buttons["reader-appearance"].tap()
    app.descendants(matching: .any)["reader-font"].firstMatch.tap()
    app.buttons[family].tap()
    app.buttons["Done"].tap()
  }

  @MainActor private func expectLoadedFont(_ family: String, in app: XCUIApplication) {
    let loaded = expectation(
      for: NSPredicate(format: "value CONTAINS %@", "loaded fonts: " + family),
      evaluatedWith: app.buttons["reader-appearance"])
    wait(for: [loaded], timeout: 10)
  }

  @MainActor private func showReader(_ app: XCUIApplication) {
    let toggle = app.buttons["reader-toggle"]
    let enabled = expectation(
      for: NSPredicate(format: "exists == true AND enabled == true"), evaluatedWith: toggle)
    wait(for: [enabled], timeout: 20)
    if toggle.label == "Reader" { toggle.tap() }
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10), app.debugDescription)
  }

  @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

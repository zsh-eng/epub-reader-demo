import XCTest

/// Repeatable library scrolling diagnostics. Simulator results establish a
/// regression baseline only; use a physical ProMotion device to assess 120 Hz.
final class LibraryScrollPerformanceUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  @MainActor func testGlassHeaderAndOptionalFrameDiagnostics() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-photo-list", "-articles-offline",
    ]
    app.launch()
    let menu = app.buttons["Sort and filter"]
    XCTAssertTrue(menu.waitForExistence(timeout: 10))
    let folders = app.buttons["folder-saved"]
    XCTAssertGreaterThanOrEqual(folders.frame.minY, menu.frame.maxY)
    let counter = app.descendants(matching: .any)
      .matching(identifier: "library-frame-diagnostics").firstMatch
    XCTAssertFalse(counter.exists)
    menu.tap()
    let toggle = app.descendants(matching: .any)
      .matching(identifier: "toggle-frame-diagnostics").firstMatch
    XCTAssertTrue(toggle.waitForExistence(timeout: 5))
    toggle.tap()
    XCTAssertTrue(counter.waitForExistence(timeout: 5))
    let ready = expectation(
      for: NSPredicate(format: "label CONTAINS 'callback FPS'"), evaluatedWith: counter)
    wait(for: [ready], timeout: 5)
    let top = folders.frame.minY
    app.swipeUp(velocity: .slow)
    XCTAssertEqual(folders.frame.minY, top, accuracy: 1)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "glass-header-over-scrolled-photos-and-frame-diagnostic"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    menu.tap()
    XCTAssertTrue(toggle.waitForExistence(timeout: 5))
    toggle.tap()
    let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: counter)
    wait(for: [gone], timeout: 5)
  }

  @MainActor func testImportReplayScrollsWithoutPublishingMetadataUnderFinger() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-test-import-replay",
      "-articles-offline", "-disable-preloading",
    ]
    app.launch()
    let state = app.staticTexts["import-replay-state"]
    XCTAssertTrue(app.buttons["article-import-459"].waitForExistence(timeout: 10))
    // These gestures overlap incoming metadata from the fixed local replay.
    // No publisher, Files picker or variable network service is involved.
    for _ in 0..<3 {
      app.swipeUp(velocity: .fast)
      app.swipeDown(velocity: .fast)
    }
    let complete = expectation(
      for: NSPredicate(format: "label BEGINSWITH '460/460'"), evaluatedWith: state)
    wait(for: [complete], timeout: 60)
    XCTAssertTrue(state.label.contains("dates=true"), state.label)
    XCTAssertTrue(state.label.contains("during=0"), state.label)
    XCTAssertFalse(state.label.contains("scrolls=0;"), state.label)
    XCTAssertTrue(app.images["Article preview"].firstMatch.waitForExistence(timeout: 10))
    let evidence = XCTAttachment(string: state.label)
    evidence.name = "import-replay-batching-evidence"
    evidence.lifetime = .keepAlways
    add(evidence)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "import-replay-settled-library"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  @MainActor func testWarmThousandArticleLibraryScrolling() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-photo-list", "-articles-offline",
    ]
    app.launch()
    let firstPhoto = app.buttons["article-import-999"]
    XCTAssertTrue(firstPhoto.waitForExistence(timeout: 10))
    // Readiness belongs to the decoded image, not the button's combined label.
    XCTAssertTrue(app.images["Article preview"].firstMatch.waitForExistence(timeout: 15))
    let before = XCTAttachment(screenshot: app.screenshot())
    before.name = "thousand-photo-library-ready"
    before.lifetime = .keepAlways
    add(before)

    // Warm the same neighborhood before measuring; startup and fixture import
    // are excluded. Rows share one local bundled photograph but use distinct
    // cache keys, so entering rows exercise downsampling and decoded caching.
    app.swipeUp(velocity: .fast)
    app.swipeUp(velocity: .fast)
    app.swipeDown(velocity: .fast)
    app.swipeDown(velocity: .fast)
    let options = XCTMeasureOptions()
    options.iterationCount = 3
    measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: options) {
      for _ in 0..<3 { app.swipeUp(velocity: .fast) }
      for _ in 0..<3 { app.swipeDown(velocity: .fast) }
    }
    XCTAssertTrue(app.searchFields.firstMatch.exists)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "thousand-article-warm-scroll"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    let scope = XCTAttachment(
      string:
        "1000 photograph rows with distinct cache keys backed by one bundled image file. Warm scrolling and deceleration; local image decoding and caching, no network latency. Simulator numbers are not physical-device frame-rate verification."
    )
    scope.name = "scroll-measurement-scope"
    scope.lifetime = .keepAlways
    add(scope)
  }
}

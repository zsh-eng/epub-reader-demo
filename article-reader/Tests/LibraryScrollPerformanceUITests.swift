import XCTest

/// Repeatable library scrolling diagnostics. Simulator results establish a
/// regression baseline only; use a physical ProMotion device to assess 120 Hz.
final class LibraryScrollPerformanceUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  @MainActor func testWarmThousandArticleLibraryScrolling() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-photo-list", "-articles-offline",
    ]
    app.launch()
    let firstPhoto = app.buttons["article-import-999"]
    XCTAssertTrue(firstPhoto.waitForExistence(timeout: 10))
    // ArticleThumbnail labels only the decoded image "Article preview";
    // its placeholder is labelled "Loading article preview" instead.
    let photoReady = expectation(
      for: NSPredicate(
        format: "label CONTAINS %@ AND NOT label CONTAINS %@", "Article preview",
        "Loading article preview"),
      evaluatedWith: firstPhoto)
    wait(for: [photoReady], timeout: 15)
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

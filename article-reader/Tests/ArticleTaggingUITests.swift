import XCTest

final class ArticleTaggingUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  /// An unsave during classification must also leave no hidden tags in history.
  /// Re-save with the classifier disabled to inspect the persisted result.
  @MainActor func testUnsaveDuringTaggingDiscardsResult() {
    let app = launchTagging()
    app.buttons["open-copied-link"].tap()
    let save = app.buttons["reader-save"]
    XCTAssertTrue(save.waitForExistence(timeout: 10))
    save.tap()
    waitForQueue("tagging", in: app)
    save.tap()
    XCTAssertEqual(save.value as? String, "Not saved")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    releaseResponse(in: app)
    waitForQueue("idle", in: app)
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)

    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.buttons["folder-history"].waitForExistence(timeout: 5))
    app.buttons["folder-history"].tap()
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.tap()
    XCTAssertEqual(app.buttons["reader-save"].value as? String, "Not saved")
    app.buttons["reader-save"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons["folder-saved"].tap()
    card.press(forDuration: 1)
    app.buttons["Tags"].tap()
    XCTAssertTrue(app.textFields["tag-name"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["tag-option-Engineering"].exists)
    XCTAssertFalse(app.buttons["tag-option-Design & craft"].exists)
  }

  @MainActor func testDeleteDuringTaggingCannotRestoreArticle() {
    let app = launchTagging()
    app.buttons["save-copied-link"].tap()
    waitForQueue("tagging", in: app)
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.press(forDuration: 1)
    app.buttons["Remove link"].tap()
    releaseResponse(in: app)
    waitForQueue("idle", in: app)
    XCTAssertFalse(card.exists)
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing", "-test-tagging"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.staticTexts["Your next good read."].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-story"].exists)
    XCTAssertFalse(app.buttons["folder-tag-Engineering"].exists)
  }

  @MainActor func testNetworkFailureResumesOnForeground() {
    let app = launchTagging(failure: true)
    app.buttons["save-copied-link"].tap()
    waitForQueue("tagging", in: app)
    waitForQueue("idle", in: app)
    XCTAssertTrue(app.buttons["article-story"].exists)
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
    XCTAssertFalse(app.buttons["folder-tag-Engineering"].exists)

    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertTrue(app.buttons["edit-automatic-tags"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.buttons["folder-tag-Engineering"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.buttons["folder-tag-Engineering"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
  }

  @MainActor private func launchTagging(failure: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-test-clipboard", "-test-tagging",
      failure ? "-test-tagging-delayed" : "-test-tagging-held",
    ]
    if failure { app.launchArguments.append("-test-tagging-failure") }
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    return app
  }

  @MainActor private func releaseResponse(in app: XCUIApplication) {
    let release = app.buttons["finish-test-tagging"]
    XCTAssertTrue(release.waitForExistence(timeout: 5))
    let held = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: release)
    wait(for: [held], timeout: 5)
    release.tap()
  }

  @MainActor private func waitForQueue(_ state: String, in app: XCUIApplication) {
    let status = app.staticTexts["tagging-test-state"]
    XCTAssertTrue(status.waitForExistence(timeout: 5))
    let changed = expectation(for: NSPredicate(format: "label == %@", state), evaluatedWith: status)
    wait(for: [changed], timeout: 15)
  }
}

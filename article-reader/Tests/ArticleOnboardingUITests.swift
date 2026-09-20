import XCTest

final class ArticleOnboardingUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  @MainActor func testThreePagesSkipAndPersist() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-test-onboarding", "-reset-onboarding", "-reset-store"]
    app.launch()
    XCTAssertTrue(app.buttons["onboarding-next"].waitForExistence(timeout: 10))
    capture(app, "onboarding-share-light")
    app.buttons["onboarding-next"].tap()
    XCTAssertTrue(app.buttons["onboarding-open-settings"].waitForExistence(timeout: 5))
    capture(app, "onboarding-paste-light")
    app.buttons["onboarding-next"].tap()
    XCTAssertTrue(app.secureTextFields.firstMatch.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["onboarding-finish"].isEnabled)
    capture(app, "onboarding-tags-light")
    app.buttons["onboarding-skip"].tap()
    XCTAssertTrue(app.buttons["folder-saved"].waitForExistence(timeout: 5))
    app.terminate()
    app.launchArguments = ["-ui-testing", "-test-onboarding"]
    app.launch()
    XCTAssertTrue(app.buttons["folder-saved"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["onboarding-next"].exists)
  }

  @MainActor func testDemonstrationsCompleteAndReplay() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-test-onboarding", "-reset-onboarding"]
    app.launch()
    let share = app.otherElements["onboarding-share-demo"]
    XCTAssertTrue(share.waitForExistence(timeout: 10))
    XCTAssertGreaterThan(share.frame.height, 390)
    XCTAssertTrue(share.label.contains("Glacial Longings"))
    waitForDemo(share, value: "link")
    capture(app, "arctic-share-url-preview")
    waitForDemo(share, value: "saved")
    capture(app, "arctic-share-demo-complete")
    app.buttons["onboarding-replay-share"].tap()
    XCTAssertNotEqual(share.value as? String, "saved")
    capture(app, "arctic-article-page")
    waitForDemo(share, value: "saved")
    app.buttons["onboarding-next"].tap()
    let paste = app.otherElements["onboarding-paste-demo"]
    XCTAssertTrue(paste.waitForExistence(timeout: 5))
    waitForDemo(paste, value: "allowed")
    capture(app, "arctic-settings-demo-complete")
    app.buttons["onboarding-open-settings"].tap()
    let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
    XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 5))
    capture(settings, "arctic-system-settings-reference")
    app.activate()
    app.buttons["onboarding-next"].tap()
    let tags = app.otherElements["onboarding-tags-demo"]
    XCTAssertTrue(tags.waitForExistence(timeout: 5))
    waitForDemo(tags, value: "tagged")
    XCTAssertGreaterThanOrEqual(tags.frame.minX, 24)
    XCTAssertLessThanOrEqual(tags.frame.maxX, app.frame.width - 24)
    assertPrivacyFits(in: app)
    XCTAssertTrue(app.staticTexts["A little magic."].exists)
    let privacy = app.descendants(matching: .any)
      .matching(identifier: "onboarding-privacy-note").firstMatch
    XCTAssertLessThanOrEqual(privacy.frame.height, 36)
    capture(app, "arctic-tags-demo-complete")
    app.buttons["What is sent to Jev"].tap()
    XCTAssertTrue(
      app.staticTexts[
        "Saved article titles and descriptions are sent to Jev to choose your tags. Your API key stays in Keychain on this device."
      ].waitForExistence(timeout: 3))

  }

  @MainActor private func assertPrivacyFits(in app: XCUIApplication) {
    let privacy = app.descendants(matching: .any)
      .matching(identifier: "onboarding-privacy-note").firstMatch
    let footer = app.descendants(matching: .any)
      .matching(identifier: "onboarding-footer").firstMatch
    XCTAssertTrue(privacy.exists)
    XCTAssertTrue(footer.exists)
    XCTAssertLessThan(privacy.frame.maxY, footer.frame.minY)
  }

  @MainActor private func waitForDemo(_ element: XCUIElement, value: String) {
    let finished = expectation(
      for: NSPredicate(format: "value == %@", value), evaluatedWith: element)
    wait(for: [finished], timeout: 12)
  }

  @MainActor func testReplayTutorialFromLibrary() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    XCTAssertTrue(app.buttons["Sort and filter"].waitForExistence(timeout: 10))
    app.buttons["Sort and filter"].tap()
    app.buttons["Getting started"].tap()
    XCTAssertTrue(app.buttons["onboarding-next"].waitForExistence(timeout: 5))
    app.buttons["onboarding-skip"].tap()
    XCTAssertTrue(app.buttons["folder-saved"].waitForExistence(timeout: 5))
  }

  @MainActor func testPasteOffersOnlyOpen() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-tagging", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["save-copied-link"].exists)
    app.buttons["open-copied-link"].tap()
    XCTAssertTrue(app.buttons["reader-save"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.buttons["reader-save"].value as? String, "Not saved")
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
  }

  @MainActor func testDarkOnboardingAndLargeText() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-test-onboarding", "-reset-onboarding", "-dark-ui", "-reduce-motion",
    ]
    app.launch()
    XCTAssertTrue(app.buttons["onboarding-next"].waitForExistence(timeout: 10))
    capture(app, "onboarding-share-dark")
    app.buttons["onboarding-next"].tap()
    XCTAssertTrue(app.buttons["onboarding-open-settings"].waitForExistence(timeout: 5))
    capture(app, "onboarding-paste-dark")
    app.buttons["onboarding-next"].tap()
    XCTAssertTrue(app.secureTextFields.firstMatch.waitForExistence(timeout: 5))
    assertPrivacyFits(in: app)
    capture(app, "onboarding-tags-dark")
    app.terminate()
    app.launchArguments += ["-large-type"]
    app.launch()
    XCTAssertTrue(app.buttons["onboarding-next"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["onboarding-next"].isHittable)
    capture(app, "onboarding-large-type")
    app.buttons["onboarding-next"].tap()
    app.buttons["onboarding-next"].tap()
    XCTAssertTrue(app.buttons["onboarding-skip"].isHittable)
    app.buttons["onboarding-skip"].tap()
    XCTAssertTrue(app.buttons["folder-saved"].waitForExistence(timeout: 5))
  }

  @MainActor func testTagsOnlyAfterSaveAndManualRemovalPersists() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-tagging", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    app.buttons["open-copied-link"].tap()
    XCTAssertTrue(app.buttons["reader-save"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.buttons["reader-save"].value as? String, "Not saved")
    XCTAssertFalse(app.otherElements["tagging-notice"].exists)
    app.buttons["reader-save"].tap()
    XCTAssertTrue(app.buttons["edit-automatic-tags"].waitForExistence(timeout: 15))
    capture(app, "automatic-tags-feedback")
    app.buttons["edit-automatic-tags"].tap()
    let tag = app.buttons["tag-option-Engineering"]
    XCTAssertTrue(tag.waitForExistence(timeout: 5))
    XCTAssertEqual(tag.value as? String, "Selected")
    tag.tap()
    app.textFields["tag-name"].tap()
    app.textFields["tag-name"].typeText("Keep")
    app.buttons["save-tags"].tap()
    app.terminate()
    app.launchArguments = ["-ui-testing", "-test-tagging"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.buttons["folder-tag-Keep"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["folder-tag-Engineering"].exists)
    XCTAssertFalse(app.otherElements["tagging-notice"].exists)
  }

  @MainActor func testKeySetupFailureAndSuccess() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-test-onboarding", "-reset-onboarding", "-test-key-failure",
    ]
    app.launch()
    XCTAssertTrue(app.buttons["onboarding-next"].waitForExistence(timeout: 10))
    app.buttons["onboarding-next"].tap()
    app.buttons["onboarding-next"].tap()
    let field = app.secureTextFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("fixture-invalid-key")
    app.buttons["onboarding-finish"].tap()
    XCTAssertTrue(app.staticTexts["onboarding-key-error"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["folder-saved"].exists)
    app.buttons["onboarding-skip"].tap()
    XCTAssertTrue(app.buttons["folder-saved"].waitForExistence(timeout: 5))
    app.terminate()
    app.launchArguments = [
      "-ui-testing", "-test-onboarding", "-reset-onboarding", "-test-key-success",
    ]
    app.launch()
    app.buttons["onboarding-next"].tap()
    app.buttons["onboarding-next"].tap()
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("fixture-valid-key")
    app.buttons["onboarding-finish"].tap()
    XCTAssertTrue(app.buttons["folder-saved"].waitForExistence(timeout: 5))
  }

  @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

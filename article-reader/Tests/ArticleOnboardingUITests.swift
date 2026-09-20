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

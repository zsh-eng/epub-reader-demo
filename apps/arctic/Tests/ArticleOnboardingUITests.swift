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
        "When you share or paste a link, its title, description, and sometimes a short excerpt go to Jev before you save. Tags are kept only if you save. Your API key stays in Keychain on this device."
      ].waitForExistence(timeout: 3))
    let disclosure = app.staticTexts[
      "When you share or paste a link, its title, description, and sometimes a short excerpt go to Jev before you save. Tags are kept only if you save. Your API key stays in Keychain on this device."
    ]
    XCTAssertGreaterThan(disclosure.frame.height, 50)
    capture(app, "arctic-key-disclosure")

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

  @MainActor func testArticleReplayLoopsAndClosesWithoutSaving() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    XCTAssertTrue(app.buttons["Sort and filter"].waitForExistence(timeout: 10))
    app.buttons["Sort and filter"].tap()
    app.buttons["Article replay"].tap()
    let scene = app.otherElements["article-replay-scene"]
    XCTAssertTrue(scene.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(scene.frame.height, 400)
    XCTAssertLessThanOrEqual(scene.frame.maxY, app.frame.maxY)
    XCTAssertFalse(app.buttons["onboarding-replay-share"].exists)
    XCTAssertFalse(app.buttons["onboarding-next"].exists)
    capture(app, "native-replay-article")
    waitForDemo(scene, value: "1:tagged")
    capture(app, "native-replay-tags")
    waitForDemo(scene, value: "1:library")
    capture(app, "native-replay-saved")
    waitForDemo(scene, value: "2:article")
    XCUIDevice.shared.press(.home)
    app.activate()
    waitForDemo(scene, value: "3:article")
    app.buttons["close-article-replay"].tap()
    XCTAssertTrue(app.buttons["Sort and filter"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["An Alien Mind"].exists)
    app.buttons["Sort and filter"].tap()
    app.buttons["Article replay"].tap()
    XCTAssertTrue(scene.waitForExistence(timeout: 5))
    let restarted = expectation(
      for: NSPredicate(format: "value BEGINSWITH %@", "1:"), evaluatedWith: scene)
    wait(for: [restarted], timeout: 5)
  }

  @MainActor func testArticleReplayDarkReducedMotion() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-dark-ui", "-reduce-motion"]
    app.launch()
    XCTAssertTrue(app.buttons["Sort and filter"].waitForExistence(timeout: 10))
    app.buttons["Sort and filter"].tap()
    app.buttons["Article replay"].tap()
    let scene = app.otherElements["article-replay-scene"]
    XCTAssertTrue(scene.waitForExistence(timeout: 5))
    waitForDemo(scene, value: "0:library")
    capture(app, "native-replay-dark-reduced-motion")
    XCTAssertTrue(app.buttons["close-article-replay"].isHittable)
    app.buttons["close-article-replay"].tap()
    XCTAssertTrue(app.buttons["Sort and filter"].waitForExistence(timeout: 5))
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

  @MainActor func testKeyEntryFloatsAboveKeyboardWithoutMovingIllustration() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-test-onboarding", "-reset-onboarding", "-test-key-failure",
    ]
    app.launch()
    XCTAssertTrue(app.buttons["onboarding-next"].waitForExistence(timeout: 10))
    app.buttons["onboarding-next"].tap()
    app.buttons["onboarding-next"].tap()
    let illustration = app.otherElements["onboarding-tags-demo"]
    waitForDemo(illustration, value: "tagged")
    let illustrationFrame = illustration.frame
    let field = app.secureTextFields.firstMatch
    XCTAssertTrue(field.isHittable)
    field.tap()
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
    let dismiss = app.buttons["onboarding-dismiss-keyboard"]
    XCTAssertTrue(dismiss.waitForExistence(timeout: 5))
    field.typeText("fixture-invalid-key")
    let enable = app.buttons["onboarding-finish"]
    XCTAssertTrue(field.isHittable)
    XCTAssertTrue(enable.isHittable)
    XCTAssertLessThan(field.frame.maxY, enable.frame.minY)
    XCTAssertLessThanOrEqual(enable.frame.maxY, keyboard.frame.minY - 4)
    XCTAssertEqual(illustration.frame.minY, illustrationFrame.minY, accuracy: 2)
    XCTAssertEqual(illustration.frame.height, illustrationFrame.height, accuracy: 2)
    let actionY = enable.frame.midY
    capture(app, "onboarding-keyboard-dock")
    enable.tap()
    XCTAssertTrue(app.staticTexts["onboarding-key-error"].waitForExistence(timeout: 5))
    XCTAssertEqual(enable.frame.midY, actionY, accuracy: 2)
    XCTAssertTrue(keyboard.exists)
    dismiss.tap()
    let hidden = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: keyboard)
    wait(for: [hidden], timeout: 5)
    XCTAssertTrue(app.buttons["onboarding-skip"].isHittable)
    XCTAssertEqual(illustration.frame.minY, illustrationFrame.minY, accuracy: 2)
    capture(app, "onboarding-keyboard-dismissed")
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
    app.buttons["onboarding-dismiss-keyboard"].tap()
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

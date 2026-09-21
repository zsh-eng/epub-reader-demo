import XCTest

final class LibraryAnnotationsUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  @MainActor func testGlobalPassagesSearchEditAndOfflineSourceJump() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/unicode"
    app.launch()
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    open.tap()
    let save = app.buttons["reader-save"]
    XCTAssertTrue(save.waitForExistence(timeout: 5))
    if save.value as? String == "Not saved" { save.tap() }
    let toggle = app.buttons["reader-toggle"]
    expectation(
      for: NSPredicate(format: "exists == true AND enabled == true"), evaluatedWith: toggle)
    waitForExpectations(timeout: 20)
    if toggle.label == "Reader" { toggle.tap() }
    let paragraph = "“Slow down,” she said — café, naïve, 日本語. Keep every character intact."
    let text = app.webViews.staticTexts[paragraph].firstMatch
    XCTAssertTrue(text.waitForExistence(timeout: 10))
    text.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).press(forDuration: 1.2)
    XCTAssertTrue(app.menuItems["Copy"].waitForExistence(timeout: 5))
    tapSelectionAction("Highlight", in: app)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    let collection = app.buttons["library-annotations"]
    XCTAssertTrue(collection.waitForExistence(timeout: 5))
    collection.tap()
    let row = app.buttons.matching(
      NSPredicate(
        format:
          "identifier BEGINSWITH 'library-passage-' AND NOT identifier BEGINSWITH 'library-passage-open-' "
      )
    ).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), app.debugDescription)
    capture(app, "global-passages-collection")
    app.segmentedControls.buttons["Notes"].tap()
    XCTAssertTrue(app.staticTexts["Keep a thought"].waitForExistence(timeout: 5))
    app.segmentedControls.buttons["All"].tap()
    row.tap()
    let editor = app.textViews["annotation-note"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    capture(app, "global-passage-medium-editor")
    editor.tap()
    editor.typeText("A thought from the library.")
    app.navigationBars.buttons["Done"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts["A thought from the library."].waitForExistence(timeout: 5))
    XCTAssertFalse(app.searchFields["article-search"].exists)
    let search = app.searchFields["Passage, note, or article"]
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    search.typeText("no matching passage")
    XCTAssertTrue(app.staticTexts["No passages found"].waitForExistence(timeout: 5))

    // A fresh process has no Reader webview or annotation script to reuse.
    // The source jump must wait for the offline document before revealing it.
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-disable-preloading"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(collection.waitForExistence(timeout: 10))
    collection.tap()
    XCTAssertTrue(app.staticTexts["A thought from the library."].waitForExistence(timeout: 5))
    app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'library-passage-open-' "))
      .firstMatch.tap()
    XCTAssertTrue(app.buttons["reader-notes"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.webViews.staticTexts[paragraph].firstMatch.waitForExistence(timeout: 15))
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "global-passage-offline-source"
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  @MainActor private func tapSelectionAction(_ name: String, in app: XCUIApplication) {
    for _ in 0..<4 {
      for action in [app.menuItems[name], app.buttons[name]]
      where action.exists && action.isHittable {
        action.tap()
        return
      }
      if app.buttons["Next"].exists {
        app.buttons["Next"].tap()
      } else if app.buttons["More"].exists {
        app.buttons["More"].tap()
      } else {
        break
      }
    }
    XCTFail("Missing selection action \(name): \(app.debugDescription)")
  }
}

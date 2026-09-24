import XCTest

@MainActor final class MacUITests: XCTestCase {
  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-seed-preload-fixtures"]
    app.launch()
    return app
  }
  func testOpenSwitchNotesAndShortcuts() throws {
    let app = launch()
    let grid = app.collectionViews["article-grid"]
    XCTAssertTrue(grid.waitForExistence(timeout: 10))
    grid.buttons["Cached story 00"].click()
    XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
    app.typeKey("l", modifierFlags: .command)
    grid.buttons["Cached story 01"].click()
    app.typeKey(.tab, modifierFlags: [.control, .shift])
    XCTAssertTrue(
      app.webViews.firstMatch.staticTexts.containing(
        NSPredicate(format: "label CONTAINS %@", "Slow down")
      ).firstMatch.waitForExistence(timeout: 10))
    app.typeKey("b", modifierFlags: [.command, .option])
    let input = app.textViews["note-input"]
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    input.click()
    input.typeText("A note from the Mac.")
    input.typeKey(.return, modifierFlags: [])
    XCTAssertTrue(app.staticTexts["A note from the Mac."].waitForExistence(timeout: 5))
    app.typeKey("/", modifierFlags: [.command, .shift])
    XCTAssertTrue(app.staticTexts["A little more fluent."].waitForExistence(timeout: 5))
    app.buttons["Done"].click()
    app.typeKey("b", modifierFlags: [.command])
    app.typeKey("b", modifierFlags: [.command])
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
  func testManyOpenTabsStayResponsive() throws {
    let app = launch()
    let grid = app.collectionViews["article-grid"]
    XCTAssertTrue(grid.waitForExistence(timeout: 10))
    for index in 0..<6 {
      app.typeKey("k", modifierFlags: .command)
      let input = app.textFields["open-input"]
      XCTAssertTrue(input.waitForExistence(timeout: 5))
      input.typeText(String(format: "Cached story %02d", index))
      input.typeKey(.return, modifierFlags: [])
      XCTAssertTrue(app.buttons["tab-cached-\(index)"].waitForExistence(timeout: 8))
    }
    for index in [4, 5, 3, 0, 5, 4] { app.buttons["tab-cached-\(index)"].click() }
    app.typeKey("w", modifierFlags: .command)
    XCTAssertFalse(app.buttons["tab-cached-4"].exists)
    app.typeKey("t", modifierFlags: [.command, .shift])
    XCTAssertTrue(app.buttons["tab-cached-4"].waitForExistence(timeout: 5))
  }
}

import XCTest

final class FavouritesUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  /// A favourite stays discoverable after archiving. Tag filtering is separate
  /// from the ordinary inbox view, and both actions survive an app relaunch.
  @MainActor func testArchivedFavouritePersistsAndTagFilterIncludesIt() {
    let app = launchFixtures()
    let card = app.buttons["article-cached-0"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.press(forDuration: 1)
    let favourite = app.buttons["favourite-article"]
    XCTAssertTrue(favourite.waitForExistence(timeout: 3))
    XCTAssertEqual(favourite.label, "Favourite")
    favourite.tap()
    card.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    waitForAbsence(card)

    openFolder("folder-favourites", in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    openFolder("folder-tag-Even", in: app)
    waitForAbsence(card)
    let filter = app.buttons["filter-tag-favourites"]
    XCTAssertTrue(filter.waitForExistence(timeout: 5))
    XCTAssertEqual(filter.value as? String, "Off")
    filter.tap()
    expectation(for: NSPredicate(format: "value == 'On'"), evaluatedWith: filter)
    waitForExpectations(timeout: 5)
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-cached-2"].exists)
    filter.tap()
    expectation(for: NSPredicate(format: "value == 'Off'"), evaluatedWith: filter)
    waitForExpectations(timeout: 5)
    waitForAbsence(card)
    XCTAssertTrue(app.buttons["article-cached-2"].waitForExistence(timeout: 5))

    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-disable-preloading"]
    app.launch()
    openFolder("folder-favourites", in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.press(forDuration: 1)
    let unfavourite = app.buttons["favourite-article"]
    XCTAssertTrue(unfavourite.waitForExistence(timeout: 3))
    XCTAssertEqual(unfavourite.label, "Unfavourite")
    unfavourite.tap()
    waitForAbsence(card)
    XCTAssertTrue(app.staticTexts["Worth keeping close."].waitForExistence(timeout: 5))
    openFolder("folder-archive", in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 5), "Unfavourite must not unarchive or delete")

    app.terminate()
    app.launch()
    openFolder("folder-favourites", in: app)
    XCTAssertTrue(app.staticTexts["Worth keeping close."].waitForExistence(timeout: 5))
    XCTAssertFalse(card.exists)
  }

  @MainActor func testReaderPageOptionsToggleFavourite() {
    let app = launchFixtures()
    let card = app.buttons["article-cached-0"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.tap()
    let options = app.buttons["Page options"]
    XCTAssertTrue(options.waitForExistence(timeout: 10))
    options.tap()
    let favourite = app.buttons["reader-favourite"]
    XCTAssertTrue(favourite.waitForExistence(timeout: 3))
    XCTAssertEqual(favourite.label, "Favourite")
    favourite.tap()
    options.tap()
    XCTAssertTrue(favourite.waitForExistence(timeout: 3))
    XCTAssertEqual(favourite.label, "Unfavourite")
    favourite.tap()
    options.tap()
    XCTAssertTrue(favourite.waitForExistence(timeout: 3))
    XCTAssertEqual(favourite.label, "Favourite")
    favourite.tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    openFolder("folder-favourites", in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 5))
  }

  @MainActor func testArchiveAndUnarchiveUndoSurviveReaderCloseAndRelaunch() {
    let app = launchFixtures()
    let card = app.buttons["article-cached-0"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.tap()
    app.buttons["Page options"].tap()
    app.buttons["reader-archive-menu"].tap()
    let undo = app.buttons["archive-undo"]
    XCTAssertTrue(undo.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Article archived"].exists)
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "archive-undo-after-reader-close"; shot.lifetime = .keepAlways; add(shot)
    undo.tap()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-disable-preloading"]
    app.launch()
    XCTAssertTrue(card.waitForExistence(timeout: 10), "Undo must persist the saved membership")
    card.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    openFolder("folder-archive", in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    XCTAssertTrue(app.staticTexts["Returned to Saved"].waitForExistence(timeout: 5))
    undo.tap()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    app.terminate(); app.launch()
    openFolder("folder-archive", in: app)
    XCTAssertTrue(
      card.waitForExistence(timeout: 5), "Undo Unarchive must persist archive membership")
  }

  @MainActor private func launchFixtures() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-preload-fixtures",
      "-articles-offline", "-disable-preloading",
    ]
    app.launch()
    return app
  }

  @MainActor private func openFolder(_ identifier: String, in app: XCUIApplication) {
    let button = app.buttons[identifier]
    let strip = app.scrollViews.containing(.button, identifier: "folder-saved").firstMatch
    XCTAssertTrue(strip.waitForExistence(timeout: 5))
    for _ in 0..<5 {
      if button.exists && button.isHittable { break }
      strip.swipeLeft()
    }
    XCTAssertTrue(button.isHittable, "Folder should be visible: \(identifier)")
    button.tap()
    expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: button)
    waitForExpectations(timeout: 5)
  }

  @MainActor private func waitForAbsence(_ element: XCUIElement) {
    expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
    waitForExpectations(timeout: 5)
  }
}

import XCTest
import UIKit

final class LibraryAnnotationsUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  @MainActor func testStoryTemplatesPaginateAndExportOffline() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance", "-test-notebook-count", "1", "-test-story-long", "-articles-offline", "-images-offline", "-dark-ui"]
    app.launch()
    XCTAssertTrue(app.buttons["library-annotations"].waitForExistence(timeout: 10))
    app.buttons["library-annotations"].tap()
    XCTAssertTrue(app.buttons["Passage options"].waitForExistence(timeout: 5))
    app.buttons["Passage options"].tap()
    app.buttons["share-passage-image"].tap()
    let preview = app.otherElements["story-preview"]
    XCTAssertTrue(preview.waitForExistence(timeout: 5), app.debugDescription)
    let initialText = preview.label
    for style in ["Paper", "Ink", "Ice", "Folio", "Field", "Signal", "Index", "Dusk", "Cutout", "Ribbon"] {
      let button = app.buttons["story-style-" + style]
      for _ in 0..<4 {
        if button.isHittable { break }
        app.scrollViews["story-styles"].swipeLeft()
      }
      XCTAssertTrue(button.isHittable, style)
      button.tap()
      XCTAssertTrue((preview.value as? String ?? "").hasPrefix(style))
      XCTAssertEqual(preview.label, initialText, "Changing style must not change the passage")
      capture(app, "passage-story-" + style.lowercased())
    }
    XCTAssertTrue(app.buttons["Next card"].isEnabled)
    let first = preview.label
    app.buttons["Next card"].tap()
    XCTAssertNotEqual(preview.label, first)
    app.buttons["story-export"].tap()
    XCTAssertTrue(app.collectionViews["activityCollectionView"].waitForExistence(timeout: 10), app.debugDescription)
    capture(app, "passage-story-export")
    // Bitmap dimensions were checked with Copy in the simulator. Do not read
    // the cross-app pasteboard here: iOS consent would block unattended runs.
  }

  @MainActor func testDistinctEmptyPassagesInDarkMode() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance", "-dark-ui"]
    app.launch()
    let collection = app.buttons["library-annotations"]
    XCTAssertTrue(collection.waitForExistence(timeout: 10))
    capture(app, "arctic-empty-saved-dark")
    collection.tap()
    XCTAssertTrue(app.staticTexts["Keep a thought"].waitForExistence(timeout: 5))
    XCTAssertGreaterThan(
      app.navigationBars["Highlights & notes"].frame.minY, app.frame.height * 0.3)
    capture(app, "arctic-empty-passages-dark")
    app.segmentedControls.buttons["Highlights"].tap()
    XCTAssertTrue(app.staticTexts["Keep a line."].waitForExistence(timeout: 5))
    capture(app, "arctic-empty-highlights-dark")
    app.segmentedControls.buttons["Notes"].tap()
    XCTAssertTrue(
      app.staticTexts["Leave yourself a note while you read."].waitForExistence(timeout: 5))
    capture(app, "arctic-empty-notes-dark")
    let search = app.searchFields["Passage, note, or article"]
    search.tap()
    search.typeText("a missing line")
    XCTAssertTrue(app.staticTexts["No passages found"].waitForExistence(timeout: 5))
    capture(app, "arctic-empty-search-dark")
  }

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
    app.buttons["annotation-save"].tap()
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

  @MainActor func testStandaloneNoteShowsFullBodyAndLinksToArticleOffline() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/unicode"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    app.buttons["open-copied-link"].tap()
    let compose = app.buttons["reader-add-note"]
    XCTAssertTrue(compose.waitForExistence(timeout: 10))
    compose.tap()
    let input = app.descendants(matching: .any).matching(identifier: "note-message-input")
      .firstMatch
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    let note =
      "A note without selecting a passage. "
      + String(
        repeating: "The full thought stays visible when I return to my notebook. ", count: 5)
      + "This is the final sentence."
    input.typeText(note)
    app.buttons["note-send"].tap()
    XCTAssertTrue(compose.waitForExistence(timeout: 5))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons["library-annotations"].tap()
    let body = app.buttons.matching(NSPredicate(format: "label == %@", note)).firstMatch
    XCTAssertTrue(body.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(
      body.frame.height, 120, "Notebook must render the full note, not five lines")
    XCTAssertFalse(app.staticTexts["annotation-quote-preview"].exists)
    capture(app, "standalone-note-full-notebook")
    let source = app.buttons.matching(
      NSPredicate(format: "identifier BEGINSWITH 'library-passage-open-'")
    )
    .firstMatch
    XCTAssertEqual(source.label, "Open article")
    source.tap()
    XCTAssertTrue(app.buttons["reader-add-note"].waitForExistence(timeout: 10))

    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-disable-preloading"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.buttons["library-annotations"].waitForExistence(timeout: 10))
    app.buttons["library-annotations"].tap()
    XCTAssertTrue(
      app.buttons.matching(NSPredicate(format: "label == %@", note)).firstMatch
        .waitForExistence(timeout: 5))
    app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'library-passage-open-'"))
      .firstMatch.tap()
    XCTAssertTrue(app.buttons["reader-notes"].waitForExistence(timeout: 10))
    XCTAssertTrue(
      app.buttons["reader-notes"].isEnabled, "Local notes must not wait for page loading")
    app.buttons["reader-notes"].tap()
    XCTAssertTrue(
      app.staticTexts.matching(NSPredicate(format: "label == %@", note)).firstMatch
        .waitForExistence(timeout: 5))
  }

  @MainActor func testLargeNotebookScrollAndSearch() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-test-notebook-count", "1000",
      "-dark-ui",
    ]
    app.launch()
    XCTAssertTrue(app.buttons["library-annotations"].waitForExistence(timeout: 10))
    app.buttons["library-annotations"].tap()
    let scroll = app.scrollViews["notebook-scroll"]
    XCTAssertTrue(scroll.waitForExistence(timeout: 5))
    for _ in 0..<4 { scroll.swipeUp(velocity: .fast) }
    for _ in 0..<4 { scroll.swipeDown(velocity: .fast) }
    let search = app.searchFields["Passage, note, or article"]
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    search.typeText("Notebook thought 999")
    let result = app.buttons.matching(
      NSPredicate(
        format:
          "identifier BEGINSWITH 'library-passage-' AND NOT identifier BEGINSWITH 'library-passage-open-'"
      ))
    expectation(for: NSPredicate(format: "count == 1"), evaluatedWith: result)
    waitForExpectations(timeout: 5)
    capture(app, "notebook-thousand-notes-search-dark")
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

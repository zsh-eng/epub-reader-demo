import XCTest

final class AnnotationUITests: XCTestCase {
  private let paragraph = "“Slow down,” she said — café, naïve, 日本語. Keep every character intact."
  override func setUp() { continueAfterFailure = false }

  @MainActor func testHighlightsAndNotesPersistAndRemoveIndependently() {
    let app = openFixture()
    selectPassage(in: app)
    tapSelectionAction("Highlight", in: app)
    let notes = app.buttons["reader-notes"]
    expectValue("1 passage", on: notes)
    notes.tap()
    let passage = annotationRows(in: app).firstMatch
    XCTAssertTrue(passage.waitForExistence(timeout: 5), app.debugDescription)
    capture(app, "annotation-light-collection")
    passage.tap()
    let editor = app.textViews["annotation-note"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap()
    editor.typeText("Keep this thought for tomorrow.")
    app.navigationBars.buttons["Done"].tap()
    XCTAssertTrue(app.staticTexts["Keep this thought for tomorrow."].waitForExistence(timeout: 5))

    // Terminating while the collection is open proves the draft was written,
    // rather than merely copied into the presenting view's state.
    reopenOffline(app)
    expectValue("1 passage", on: notes)
    notes.tap()
    XCTAssertTrue(app.staticTexts["Keep this thought for tomorrow."].waitForExistence(timeout: 5))
    XCTAssertEqual(annotationRows(in: app).count, 1)
    app.buttons["Passage options"].tap()
    app.buttons["Remove highlight"].tap()
    XCTAssertTrue(app.staticTexts["Keep this thought for tomorrow."].exists)
    XCTAssertEqual(annotationRows(in: app).count, 1)
    app.buttons["Passage options"].tap()
    XCTAssertFalse(app.buttons["Remove highlight"].exists)
    app.buttons["Delete note"].tap()
    XCTAssertTrue(app.staticTexts["Keep a thought"].waitForExistence(timeout: 5))

    reopenOffline(app)
    expectValue("0 passages", on: notes)
    notes.tap()
    XCTAssertTrue(app.staticTexts["Keep a thought"].waitForExistence(timeout: 5))
  }

  @MainActor func testNoteOnlyPassageSurvivesClearingAndRewriting() {
    let app = openFixture()
    selectPassage(in: app)
    tapSelectionAction("Add note", in: app)
    let editor = app.textViews["annotation-note"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap()
    let original = "Old thought."
    editor.typeText(original)
    app.navigationBars.buttons["Done"].tap()
    XCTAssertTrue(app.staticTexts[original].waitForExistence(timeout: 5))
    let passageID = annotationRows(in: app).firstMatch.identifier
    app.buttons["Passage options"].tap()
    app.buttons["Remove highlight"].tap()
    annotationRows(in: app).firstMatch.tap()
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap()
    editor.press(forDuration: 1.1)
    tapSelectionAction("Select All", in: app)
    editor.typeText(XCUIKeyboardKey.delete.rawValue)
    // Clearing the final character is an intermediate draft edit, not deletion.
    XCTAssertTrue(editor.exists)
    XCTAssertEqual(editor.value as? String ?? "", "")
    let replacement = "A better thought for tomorrow."
    editor.typeText(replacement)
    app.navigationBars.buttons["Done"].tap()
    XCTAssertTrue(app.staticTexts[replacement].waitForExistence(timeout: 5))
    capture(app, "rewritten-note-without-highlight")

    reopenOffline(app)
    let notes = app.buttons["reader-notes"]
    expectValue("1 passage", on: notes)
    notes.tap()
    XCTAssertTrue(app.staticTexts[replacement].waitForExistence(timeout: 5))
    XCTAssertEqual(annotationRows(in: app).firstMatch.identifier, passageID)
    app.buttons["Passage options"].tap()
    XCTAssertFalse(app.buttons["Remove highlight"].exists)
    app.buttons["Delete note"].tap()
    XCTAssertTrue(app.staticTexts["Keep a thought"].waitForExistence(timeout: 5))
  }

  @MainActor func testSelectedTextOpensNativeNoteEditorInDarkMode() {
    let app = openFixture(dark: true)
    selectPassage(in: app)
    XCTAssertTrue(app.menuItems["Copy"].exists, app.debugDescription)
    tapSelectionAction("Add note", in: app)
    let editor = app.textViews["annotation-note"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
    editor.tap()
    editor.typeText("A little room to think.")
    capture(app, "annotation-dark-note-editor")
    app.navigationBars.buttons["Done"].tap()
    XCTAssertTrue(app.staticTexts["A little room to think."].waitForExistence(timeout: 5))
    capture(app, "annotation-dark-collection")
    app.buttons["Show in article"].tap()
    XCTAssertTrue(app.buttons["reader-notes"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.webViews.staticTexts[paragraph].firstMatch.isHittable)
  }

  @MainActor private func openFixture(dark: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard"]
    if dark { app.launchArguments.append("-dark-ui") }
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/unicode"
    app.launch()
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(open.waitForExistence(timeout: 10), app.debugDescription)
    open.tap()
    let bookmark = app.buttons["reader-save"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    if bookmark.value as? String == "Not saved" { bookmark.tap() }
    showReader(app)
    return app
  }

  @MainActor private func reopenOffline(_ app: XCUIApplication) {
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline"]
    app.launchEnvironment = [:]
    app.launch()
    let card = app.buttons["article-unicode"]
    XCTAssertTrue(card.waitForExistence(timeout: 10), app.debugDescription)
    card.tap()
    showReader(app)
  }

  @MainActor private func showReader(_ app: XCUIApplication) {
    let toggle = app.buttons["reader-toggle"]
    let enabled = expectation(
      for: NSPredicate(format: "exists == true AND enabled == true"), evaluatedWith: toggle)
    wait(for: [enabled], timeout: 20)
    if toggle.label == "Reader" { toggle.tap() }
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertTrue(app.webViews.staticTexts[paragraph].firstMatch.waitForExistence(timeout: 10))
  }

  @MainActor private func selectPassage(in app: XCUIApplication) {
    let text = app.webViews.staticTexts[paragraph].firstMatch
    XCTAssertTrue(text.isHittable)
    text.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).press(forDuration: 1.2)
    XCTAssertTrue(app.menuItems["Copy"].waitForExistence(timeout: 5), app.debugDescription)
  }

  @MainActor private func tapSelectionAction(_ name: String, in app: XCUIApplication) {
    for _ in 0..<4 {
      let item = app.menuItems[name]
      if item.exists && item.isHittable {
        item.tap()
        return
      }
      let button = app.buttons[name]
      if button.exists && button.isHittable {
        button.tap()
        return
      }
      let next = app.buttons["Next"].firstMatch
      let more = app.buttons["More"].firstMatch
      if next.exists && next.isHittable {
        next.tap()
      } else if more.exists && more.isHittable {
        more.tap()
      } else {
        break
      }
    }
    XCTFail("Missing selection action: \(name)\n\(app.debugDescription)")
  }

  @MainActor private func annotationRows(in app: XCUIApplication) -> XCUIElementQuery {
    app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'annotation-'"))
  }

  @MainActor private func expectValue(_ value: String, on element: XCUIElement) {
    let ready = expectation(for: NSPredicate(format: "value == %@", value), evaluatedWith: element)
    wait(for: [ready], timeout: 5)
  }

  @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

import XCTest

final class ArticleReaderUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }
  @MainActor
  func testSaveRestartBrowseReadAndRemove() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    add("https://fixture.example/story", to: app)
    XCTAssertTrue(
      app.staticTexts["The quiet art of paying attention"].waitForExistence(timeout: 15))
    capture(app, "01-library")

    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launch()
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.tap()
    let toggle = app.buttons["reader-toggle"]
    waitEnabled(toggle)
    XCTAssertFalse(app.buttons["Back"].isEnabled)
    XCTAssertFalse(app.buttons["Forward"].isEnabled)
    capture(app, "02-browser")
    toggle.tap()
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertFalse(app.webViews.staticTexts["Publisher navigation"].exists)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    capture(app, "03-reader")
    toggle.tap()
    XCTAssertTrue(app.webViews.staticTexts["Publisher navigation"].waitForExistence(timeout: 5))

    let next = app.webViews.links["Read the next story"]
    for _ in 0..<5 where !next.isHittable { app.webViews.firstMatch.swipeUp() }
    XCTAssertTrue(next.isHittable)
    next.tap()
    XCTAssertTrue(app.webViews.staticTexts["A second story"].waitForExistence(timeout: 5))
    waitEnabled(app.buttons["Back"])
    XCTAssertFalse(app.buttons["Forward"].isEnabled)
    app.buttons["Back"].tap()
    XCTAssertTrue(next.waitForExistence(timeout: 5))
    waitEnabled(app.buttons["Forward"])
    XCTAssertFalse(app.buttons["Back"].isEnabled)
    app.buttons["Forward"].tap()
    XCTAssertTrue(app.webViews.staticTexts["A second story"].waitForExistence(timeout: 5))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-next"].exists)
    app.buttons["folder-history"].tap()
    XCTAssertTrue(app.buttons["article-next"].waitForExistence(timeout: 5))
    app.buttons["folder-saved"].tap()
    card.press(forDuration: 1)
    app.buttons["Remove link"].tap()
    XCTAssertTrue(app.staticTexts["Something worth reading"].waitForExistence(timeout: 5))
    app.terminate()
    app.launch()
    XCTAssertTrue(app.staticTexts["Something worth reading"].waitForExistence(timeout: 5))
  }

  @MainActor
  func testArticleFrameAndSwipeBack() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    add("https://fixture.example/frame", to: app)
    let card = app.buttons["article-frame"]
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.tap()
    waitEnabled(app.buttons["reader-toggle"])
    app.buttons["reader-toggle"].tap()
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    XCTAssertFalse(app.webViews.staticTexts["Unwall shell fixture"].exists)
    let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.45))
    edge.press(
      forDuration: 0.1,
      thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.45)))
    XCTAssertTrue(card.waitForExistence(timeout: 5))
  }

  @MainActor func testReaderLayoutLiveControlsAndDiskImages() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    add("https://fixture.example/story", to: app)
    XCTAssertTrue(app.images["Article preview"].firstMatch.waitForExistence(timeout: 10))
    XCTAssertTrue(app.images["Site icon"].firstMatch.waitForExistence(timeout: 10))
    capture(app, "10-editorial-library")
    app.terminate()
    app.launchArguments = ["-ui-testing", "-images-offline"]
    app.launch()
    XCTAssertTrue(app.images["Article preview"].firstMatch.waitForExistence(timeout: 10))
    XCTAssertTrue(app.images["Site icon"].firstMatch.waitForExistence(timeout: 10))
    app.buttons["article-story"].tap()
    waitEnabled(app.buttons["reader-toggle"])
    app.buttons["reader-toggle"].tap()
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10))
    XCTAssertTrue(
      app.webViews.staticTexts[
        "On walking slowly, noticing more, and making room for a good story."
      ].exists)
    XCTAssertTrue(app.webViews.staticTexts["Alex Reader"].exists)
    let heading = app.webViews.staticTexts["The quiet art of paying attention"].firstMatch
    XCTAssertGreaterThanOrEqual(heading.frame.minY, app.navigationBars.firstMatch.frame.maxY)
    capture(app, "11-editorial-reader")
    app.webViews.firstMatch.swipeUp()
    app.buttons["reader-appearance"].tap()
    XCTAssertFalse(app.staticTexts["A little room to read."].exists)
    XCTAssertTrue(app.staticTexts["Reader appearance"].waitForExistence(timeout: 5))
    let panelHeight =
      app.sliders["Line spacing"].frame.maxY - app.staticTexts["Reader appearance"].frame.minY + 36
    XCTAssertLessThan(panelHeight, app.frame.height * 0.4)
    app.descendants(matching: .any)["reader-font"].firstMatch.tap()
    app.buttons["Georgia"].tap()
    app.sliders["Side padding"].adjust(toNormalizedSliderPosition: 0)
    app.sliders["Line spacing"].adjust(toNormalizedSliderPosition: 1)
    app.descendants(matching: .any)["reader-theme"].firstMatch.tap()
    app.buttons["Paper"].tap()
    capture(app, "12-live-paper-controls")
    app.buttons["Done"].tap()
    let applied = expectation(
      for: NSPredicate(
        format:
          "value CONTAINS 'Georgia' AND value CONTAINS '8px padding' AND value CONTAINS '1.95 spacing' AND value CONTAINS 'Paper'"
      ), evaluatedWith: app.buttons["reader-appearance"])
    wait(for: [applied], timeout: 8)
    app.buttons["reader-appearance"].tap()
    app.descendants(matching: .any)["reader-theme"].firstMatch.tap()
    app.buttons["Ink"].tap()
    app.buttons["Done"].tap()
    capture(app, "13-ink-reader")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
    app.terminate()
    app.launchArguments = ["-ui-testing", "-images-offline", "-dark-ui"]
    app.launch()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
    capture(app, "14-dark-library")
  }

  @MainActor private func add(_ url: String, to app: XCUIApplication) {
    app.terminate()
    app.launchArguments.removeAll { $0 == "-reset-store" || $0 == "-reset-appearance" }
    if !app.launchArguments.contains("-test-clipboard") {
      app.launchArguments.append("-test-clipboard")
    }
    app.launchEnvironment["TEST_CLIPBOARD"] = url
    app.launch()
    app.launchEnvironment = [:]
    XCTAssertTrue(
      app.buttons["save-copied-link"].waitForExistence(timeout: 10), app.debugDescription)
    app.buttons["save-copied-link"].tap()

  }

  @MainActor func testClipboardSaveAndSearch() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["add-link"].exists)
    XCTAssertFalse(app.tabBars.firstMatch.exists)
    add("https://fixture.example/story", to: app)
    add("https://fixture.example/next", to: app)
    XCTAssertTrue(
      app.staticTexts["The quiet art of paying attention"].waitForExistence(timeout: 10))
    let search = app.searchFields.firstMatch
    search.tap()
    search.typeText("QUIET")
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-next"].exists)
    capture(app, "05-search-results")
    app.buttons["article-story"].tap()
    XCTAssertTrue(app.buttons["reader-toggle"].waitForExistence(timeout: 5))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertEqual(search.value as? String, "QUIET")
    app.searchFields.buttons["Clear text"].tap()
    search.typeText("nothing-matches-this")
    XCTAssertTrue(app.staticTexts["No articles found"].waitForExistence(timeout: 5))
    app.searchFields.buttons["Clear text"].tap()
    search.typeText("fixture.example")
    XCTAssertTrue(app.buttons["article-story"].exists)
    XCTAssertTrue(app.buttons["article-next"].exists)
    app.buttons["close"].tap()
    XCTAssertTrue(app.buttons["article-next"].exists)
    XCTAssertFalse(app.buttons["close"].exists)
    XCTAssertTrue(app.buttons["select-articles"].isHittable)
    // Reversing search must leave one usable set of controls, with no stale overlay.
    search.tap()
    XCTAssertTrue(app.buttons["close"].waitForExistence(timeout: 5))
    search.typeText("QUIET")
    expectation(
      for: NSPredicate(format: "hittable == false"), evaluatedWith: app.buttons["select-articles"])
    waitForExpectations(timeout: 5)
    XCTAssertTrue(app.buttons["article-story"].isHittable)
    XCTAssertFalse(app.buttons["article-next"].exists)
    capture(app, "06-search-reopened")
    app.buttons["close"].tap()
    XCTAssertTrue(app.buttons["Sort and filter"].isHittable)
  }

  @MainActor func testFolderSwipesAndDownloadedReaderSurviveRestart() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    add("https://fixture.example/story", to: app)
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    XCTAssertLessThan(card.frame.height, 145)
    card.press(forDuration: 1)
    capture(app, "40-padded-card-preview")
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.85)).tap()
    card.tap()
    let ready = NSPredicate(format: "value == 'Ready'")
    expectation(for: ready, evaluatedWith: app.buttons["reader-toggle"])
    waitForExpectations(timeout: 15)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    swipeLibrary(app, left: true)
    XCTAssertTrue(app.buttons["folder-history"].isSelected)
    XCTAssertTrue(card.exists)
    swipeLibrary(app, left: true)
    XCTAssertTrue(app.buttons["folder-archive"].isSelected)
    XCTAssertTrue(app.staticTexts["Nothing archived"].exists)
    swipeLibrary(app, left: true)
    XCTAssertTrue(app.buttons["folder-downloaded"].isSelected)
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    capture(app, "41-downloaded-folder")
    swipeLibrary(app, left: false)
    XCTAssertTrue(app.buttons["folder-archive"].isSelected)

    // No publisher/fixture load is permitted on this fresh process.
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-images-offline"]
    app.launch()
    app.buttons["folder-downloaded"].tap()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.tap()
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["Website"].exists)
    XCTAssertFalse(app.buttons["Back"].isEnabled)
    XCTAssertFalse(app.buttons["Forward"].isEnabled)
    XCTAssertFalse(app.alerts["Could not open article"].exists)
    app.buttons["reader-appearance"].tap()
    XCTAssertTrue(app.buttons["reader-font"].waitForExistence(timeout: 5))
    capture(app, "42-offline-reader-appearance")
    app.buttons["Done"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    card.press(forDuration: 1)
    app.buttons["Remove link"].tap()
    XCTAssertTrue(app.staticTexts["Ready for later"].waitForExistence(timeout: 5))
    app.terminate()
    app.launch()
    app.buttons["folder-downloaded"].tap()
    XCTAssertFalse(card.exists)
  }

  @MainActor private func swipeLibrary(_ app: XCUIApplication, left: Bool) {
    let start = app.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.85 : 0.15, dy: 0.5))
    let end = app.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.15 : 0.85, dy: 0.5))
    start.press(forDuration: 0.05, thenDragTo: end)
  }

  @MainActor func testChromeHTMLImport() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-stage-import"]
    app.launch()
    app.buttons["Sort and filter"].tap()
    app.buttons["import-reading-list"].tap()
    XCTAssertTrue(app.tabBars.buttons["Browse"].waitForExistence(timeout: 5), app.debugDescription)
    app.tabBars.buttons["Browse"].tap()
    let file = app.cells.matching(NSPredicate(format: "label CONTAINS 'Reading List'")).firstMatch
    // Files can restore the app folder from a previous import.
    if !file.waitForExistence(timeout: 2) {
      let localFiles = app.cells.containing(.staticText, identifier: "On My iPhone").firstMatch
      if localFiles.waitForExistence(timeout: 2) { localFiles.tap() }
      let articlesFolder = app.cells.matching(NSPredicate(format: "label BEGINSWITH 'Articles'"))
        .firstMatch
      XCTAssertTrue(articlesFolder.waitForExistence(timeout: 5), app.debugDescription)
      articlesFolder.tap()
    }
    XCTAssertTrue(file.waitForExistence(timeout: 5), app.debugDescription)
    file.tap()
    XCTAssertTrue(
      app.alerts["Reading list imported"].waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertTrue(app.staticTexts["Added 2 links. Skipped 1 duplicate."].exists)
    app.buttons["Done"].tap()
    XCTAssertTrue(app.buttons["article-story"].exists)
    XCTAssertTrue(app.buttons["article-next"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launch()
    XCTAssertTrue(app.buttons["article-story"].exists)
    XCTAssertTrue(app.buttons["article-next"].exists)
  }

  @MainActor func testSavedHistoryTagsAndArchivePersist() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    // Merely preloading the clipboard must not create a history entry.
    app.buttons["folder-history"].tap()
    XCTAssertFalse(app.buttons["article-story"].exists)
    app.buttons["open-copied-link"].tap()
    waitEnabled(app.buttons["reader-toggle"])
    app.navigationBars.buttons.element(boundBy: 0).tap()
    let article = app.buttons["article-story"]
    XCTAssertTrue(article.waitForExistence(timeout: 5))
    app.buttons["folder-saved"].tap()
    XCTAssertFalse(article.exists)
    app.buttons["folder-history"].tap()
    article.press(forDuration: 1)
    app.buttons["Save to inbox"].tap()
    app.buttons["folder-saved"].tap()
    XCTAssertTrue(article.exists)
    article.press(forDuration: 1)
    app.buttons["Tags"].tap()
    let tag = app.textFields["tag-name"]
    XCTAssertTrue(tag.waitForExistence(timeout: 5))
    tag.tap()
    tag.typeText("Ideas")
    app.buttons["add-tag"].tap()
    app.buttons["save-tags"].tap()
    app.buttons["folder-tag-Ideas"].tap()
    XCTAssertTrue(article.exists)
    capture(app, "15-tag-folder")
    article.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    XCTAssertFalse(article.exists)
    app.buttons["folder-archive"].tap()
    XCTAssertTrue(article.exists)
    capture(app, "16-archive")
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertFalse(article.exists)
    app.buttons["folder-history"].tap()
    XCTAssertTrue(article.exists)
    app.buttons["folder-archive"].tap()
    XCTAssertTrue(article.exists)
    article.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    app.buttons["folder-tag-Ideas"].tap()
    XCTAssertTrue(article.exists)
    article.press(forDuration: 1)
    app.buttons["Tags"].tap()
    app.buttons["tag-option-Ideas"].tap()
    app.buttons["save-tags"].tap()
    app.buttons["folder-saved"].tap()
    XCTAssertFalse(app.buttons["folder-tag-Ideas"].exists)
    XCTAssertTrue(article.exists)
    app.buttons["select-articles"].tap()
    article.tap()
    app.buttons["Archive options"].tap()
    app.buttons["archive-selected"].tap()
    XCTAssertFalse(article.exists)
    app.buttons["select-articles"].tap()
    app.buttons["folder-archive"].tap()
    XCTAssertTrue(article.exists)

  }

  @MainActor func testCopiedLinkPreloadsWithoutSavingOrRepeating() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(
      app.buttons["open-copied-link"].waitForExistence(timeout: 10), app.debugDescription)
    capture(app, "07-copied-link")
    app.buttons["open-copied-link"].tap()
    waitEnabled(app.buttons["reader-toggle"])
    XCTAssertTrue(app.webViews.staticTexts["Publisher navigation"].exists)
    app.buttons["reader-appearance"].tap()
    app.descendants(matching: .any)["reader-font"].firstMatch.tap()
    app.buttons["DM Sans"].tap()
    app.sliders["Text size"].adjust(toNormalizedSliderPosition: 1)
    app.buttons["Done"].tap()
    let applied = expectation(
      for: NSPredicate(format: "value CONTAINS 'DM Sans' AND value CONTAINS '30px'"),
      evaluatedWith: app.buttons["reader-appearance"])
    wait(for: [applied], timeout: 8)
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    capture(app, "09-copied-reader-appearance")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertFalse(app.buttons["article-story"].exists)
    XCTAssertFalse(app.buttons["open-copied-link"].exists)
    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertFalse(app.buttons["open-copied-link"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing", "-test-clipboard"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertFalse(app.buttons["open-copied-link"].exists)
  }

  @MainActor func testNonURLClipboardDoesNotOfferOpen() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "just a note, not a link"
    app.launch()
    XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["open-copied-link"].exists)
  }

  @MainActor func testDeepLinkReplacesVisiblePageAndRecordsHistory() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    XCUIDevice.shared.system.open(
      URL(string: "articles://open?url=https%3A%2F%2Ffixture.example%2Fstory")!)
    waitEnabled(app.buttons["reader-toggle"])
    XCTAssertTrue(app.webViews.staticTexts["Publisher navigation"].exists)
    XCUIDevice.shared.system.open(
      URL(string: "articles://open?url=https%3A%2F%2Ffixture.example%2Fnext")!)
    XCTAssertTrue(app.webViews.staticTexts["A second story"].waitForExistence(timeout: 10))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertFalse(app.buttons["article-story"].exists)
    XCTAssertFalse(app.buttons["article-next"].exists)
    app.buttons["folder-history"].tap()
    XCTAssertTrue(app.buttons["article-story"].exists)
    XCTAssertTrue(app.buttons["article-next"].exists)
  }

  @MainActor func testShareExtensionSavesToLibrary() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-share-fixture"]
    app.launch()
    app.buttons["share-fixture"].tap()
    let articles = app.cells["Articles"]
    if !articles.waitForExistence(timeout: 3) {
      let more = app.cells["More"]
      XCTAssertTrue(more.waitForExistence(timeout: 5), app.debugDescription)
      more.tap()
    }
    XCTAssertTrue(articles.waitForExistence(timeout: 5), app.debugDescription)
    articles.tap()
    let save = app.buttons["share-save"]
    XCTAssertTrue(save.waitForExistence(timeout: 10), app.debugDescription)
    waitEnabled(save)
    XCTAssertLessThan(app.otherElements["share-content"].frame.height, 400)
    capture(app, "08-share-extension")
    save.tap()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 10), app.debugDescription)
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launch()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
  }

  /// Opt-in smoke check. Publisher/network failures must not affect the local suite.
  @MainActor func testLiveArticle() throws {
    let url = ProcessInfo.processInfo.environment["ARTICLE_READER_LIVE_URL"] ?? ""
    try XCTSkipIf(url.isEmpty, "Set TEST_RUNNER_ARTICLE_READER_LIVE_URL to check a live site.")
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    add(url, to: app)
    let card = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'article-'"))
      .firstMatch
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    // The browser readiness check follows real page load, including its subframes.
    card.tap()
    waitEnabled(app.buttons["reader-toggle"])
    capture(app, "live-browser")
    app.buttons["reader-toggle"].tap()
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 15), app.debugDescription)
    capture(app, "live-reader")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    capture(app, "live-library")
  }

  @MainActor private func waitEnabled(_ element: XCUIElement) {
    let ready = expectation(
      for: NSPredicate(format: "exists == true AND enabled == true"), evaluatedWith: element)
    wait(for: [ready], timeout: 30)
  }

  @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

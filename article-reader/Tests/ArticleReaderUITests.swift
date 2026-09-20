import XCTest

final class ArticleReaderUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  @MainActor func testStationaryBarAndReaderBackSwipe() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    add("https://fixture.example/story", to: app)
    let folders = ["saved", "downloaded", "history", "archive"].map { app.buttons["folder-" + $0] }
    for index in 1..<folders.count {
      XCTAssertLessThan(folders[index - 1].frame.minX, folders[index].frame.minX)
    }
    let top = app.buttons["Sort and filter"].frame.minY
    app.buttons["article-story"].tap()
    let back = app.navigationBars.buttons.element(boundBy: 0)
    XCTAssertTrue(back.waitForExistence(timeout: 5))
    XCTAssertEqual(app.buttons["Page options"].frame.minY, top, accuracy: 1)
    XCTAssertEqual(back.frame.minY, top, accuracy: 1)
    XCTAssertTrue(app.buttons["Page options"].isHittable)
    waitEnabled(app.buttons["reader-toggle"])
    let controls = [
      "browser-back", "browser-forward", "reader-toggle", "reader-save", "reader-appearance",
    ]
    .map { app.buttons[$0] }
    for index in 1..<controls.count {
      XCTAssertGreaterThan(controls[index].frame.midX - controls[index - 1].frame.midX, 60)
    }
    capture(app, "71-shared-reader-bar")
    let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.45))
    let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.45))
    edge.press(forDuration: 0.05, thenDragTo: end)
    expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: back)
    waitForExpectations(timeout: 5)
    XCTAssertTrue(app.buttons["select-articles"].isHittable)
    app.buttons["article-story"].tap()
    XCTAssertTrue(back.waitForExistence(timeout: 5))
    back.tap()
    XCTAssertTrue(app.buttons["select-articles"].isHittable)
  }

  @MainActor func testInsetCardVariantsAndScrollMaterial() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    for name in ["story", "long", "short", "next"] {
      add("https://fixture.example/" + name, to: app)
    }
    let textCard = app.buttons["article-next"]
    XCTAssertTrue(textCard.waitForExistence(timeout: 10))
    XCTAssertLessThan(textCard.frame.height, 200)
    let short = app.buttons["article-short"]
    XCTAssertTrue(short.staticTexts["card-caption-subtitle"].exists)
    let long = app.buttons["article-long"]
    XCTAssertFalse(long.staticTexts["card-caption-subtitle"].exists)
    capture(app, "63-card-variants-and-search-material")
    app.swipeUp()
    capture(app, "64-cards-behind-search")
    let search = app.searchFields.firstMatch
    search.tap()
    search.typeText("fixture.example")
    let shortResult = app.buttons["article-short"]
    let longResult = app.buttons["article-long"]
    XCTAssertTrue(shortResult.waitForExistence(timeout: 5))
    XCTAssertTrue(shortResult.staticTexts["search-result-subtitle"].exists)
    XCTAssertFalse(longResult.staticTexts["search-result-subtitle"].exists)
    let title = longResult.staticTexts["article-title-two-lines"]
    XCTAssertTrue(title.exists)
    XCTAssertLessThanOrEqual(title.frame.height, 44)
    let subtitle = shortResult.staticTexts["search-result-subtitle"]
    let thumbnail = shortResult.images["Article preview"].firstMatch
    XCTAssertGreaterThanOrEqual(subtitle.frame.minY, thumbnail.frame.minY)
    XCTAssertLessThanOrEqual(subtitle.frame.maxY, thumbnail.frame.maxY + 1)
    capture(app, "65-search-title-variants")
  }

  @MainActor func testReaderBookmarkAndArchiveAtEnd() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    XCTAssertLessThan(open.frame.maxY, app.searchFields.firstMatch.frame.minY)
    let empty = app.staticTexts["Your next good read."]
    XCTAssertTrue(empty.exists)
    XCTAssertGreaterThan(empty.frame.midY, app.frame.height * 0.4)
    XCTAssertLessThan(empty.frame.midY, app.frame.height * 0.65)
    capture(app, "50-empty-library-and-bottom-paste")
    open.tap()
    waitEnabled(app.buttons["reader-toggle"])
    let save = app.buttons["reader-save"]
    XCTAssertEqual(save.value as? String, "Not saved")
    save.tap()
    XCTAssertEqual(save.value as? String, "Saved")
    save.tap()
    XCTAssertEqual(save.value as? String, "Not saved")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertFalse(app.buttons["article-story"].exists)
    app.buttons["folder-history"].tap()
    app.buttons["article-story"].tap()
    save.tap()
    XCTAssertEqual(save.value as? String, "Saved")
    showReader(app)
    let archive = app.buttons["reader-archive-prompt"]
    XCTAssertFalse(archive.exists)
    for _ in 0..<8 where !archive.exists { app.webViews.firstMatch.swipeUp() }
    XCTAssertTrue(archive.waitForExistence(timeout: 5))
    capture(app, "51-end-of-article-archive")
    archive.tap()
    XCTAssertTrue(app.buttons["folder-saved"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["reader-save"].exists)
    app.buttons["folder-saved"].tap()
    XCTAssertFalse(app.buttons["article-story"].exists)
    app.buttons["folder-archive"].tap()
    XCTAssertTrue(app.buttons["article-story"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launchEnvironment = [:]
    app.launch()
    app.buttons["folder-archive"].tap()
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    app.buttons["folder-saved"].tap()
    card.tap()
    app.buttons["Page options"].tap()
    XCTAssertFalse(app.buttons["Save to inbox"].exists)
    app.buttons["reader-archive-menu"].tap()
    XCTAssertTrue(app.buttons["folder-saved"].waitForExistence(timeout: 5))
    XCTAssertFalse(card.exists)
  }
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
    XCTAssertFalse(app.buttons["browser-back"].isEnabled)
    XCTAssertFalse(app.buttons["browser-forward"].isEnabled)
    capture(app, "02-browser")
    showReader(app)
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
    waitEnabled(app.buttons["browser-back"])
    XCTAssertFalse(app.buttons["browser-forward"].isEnabled)
    app.buttons["browser-back"].tap()
    XCTAssertTrue(next.waitForExistence(timeout: 5))
    waitEnabled(app.buttons["browser-forward"])
    XCTAssertFalse(app.buttons["browser-back"].isEnabled)
    app.buttons["browser-forward"].tap()
    XCTAssertTrue(app.webViews.staticTexts["A second story"].waitForExistence(timeout: 5))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-next"].exists)
    app.buttons["folder-history"].tap()
    XCTAssertTrue(app.buttons["article-next"].waitForExistence(timeout: 5))
    app.buttons["folder-saved"].tap()
    card.press(forDuration: 1)
    app.buttons["Remove link"].tap()
    XCTAssertTrue(app.staticTexts["Your next good read."].waitForExistence(timeout: 5))
    app.terminate()
    app.launch()
    XCTAssertTrue(app.staticTexts["Your next good read."].waitForExistence(timeout: 5))
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
    showReader(app)
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
    showReader(app)
    XCTAssertTrue(
      app.webViews.staticTexts[
        "On walking slowly, noticing more, and making room for a good story."
      ].exists)
    XCTAssertTrue(app.webViews.staticTexts["Alex Reader"].exists)
    let heading = app.webViews.staticTexts["The quiet art of paying attention"].firstMatch
    XCTAssertGreaterThanOrEqual(
      heading.frame.minY, app.navigationBars.buttons.element(boundBy: 0).frame.maxY)
    capture(app, "11-editorial-reader")
    app.webViews.firstMatch.swipeUp()
    app.buttons["reader-appearance"].tap()
    XCTAssertFalse(app.staticTexts["A little room to read."].exists)
    XCTAssertTrue(app.staticTexts["Reader appearance"].waitForExistence(timeout: 5))
    let panelHeight =
      app.buttons["reader-increase-line-spacing"].frame.maxY
      - app.staticTexts["Reader appearance"].frame.minY + 36
    XCTAssertLessThan(panelHeight, app.frame.height * 0.4)
    app.descendants(matching: .any)["reader-font"].firstMatch.tap()
    app.buttons["Georgia"].tap()
    for _ in 0..<5 { app.buttons["reader-decrease-side-padding"].tap() }
    XCTAssertFalse(app.buttons["reader-decrease-side-padding"].isEnabled)
    for _ in 0..<8 { app.buttons["reader-increase-line-spacing"].tap() }
    XCTAssertFalse(app.buttons["reader-increase-line-spacing"].isEnabled)
    XCTAssertEqual(app.sliders.count, 0)
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
      app.buttons["open-copied-link"].waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertFalse(app.buttons["save-copied-link"].exists)
    app.buttons["open-copied-link"].tap()
    let bookmark = app.buttons["reader-save"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    if bookmark.value as? String == "Not saved" { bookmark.tap() }
    app.navigationBars.buttons.element(boundBy: 0).tap()

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
    capture(app, "60-inset-image-and-text-card")
    let search = app.searchFields.firstMatch
    search.tap()
    search.typeText("QUIET")
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-next"].exists)
    XCTAssertLessThan(app.staticTexts["search-summary"].frame.minY, app.frame.height * 0.12)
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
    XCTAssertGreaterThan(card.frame.height, 190)
    XCTAssertLessThan(card.frame.height, 280)
    card.press(forDuration: 1)
    capture(app, "40-padded-card-preview")
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.85)).tap()
    card.tap()
    let ready = NSPredicate(format: "value == 'Ready'")
    expectation(for: ready, evaluatedWith: app.buttons["reader-toggle"])
    waitForExpectations(timeout: 15)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    swipeLibrary(app, left: true)
    XCTAssertTrue(app.buttons["folder-downloaded"].isSelected)
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    capture(app, "41-downloaded-folder")
    swipeLibrary(app, left: true)
    XCTAssertTrue(app.buttons["folder-history"].isSelected)
    XCTAssertTrue(card.exists)
    XCTAssertLessThan(card.frame.height, 145)
    capture(app, "70-compact-history")
    swipeLibrary(app, left: true)
    XCTAssertTrue(app.buttons["folder-archive"].isSelected)
    XCTAssertTrue(app.staticTexts["A place for finished stories."].exists)
    swipeLibrary(app, left: false)
    XCTAssertTrue(app.buttons["folder-history"].isSelected)

    // No publisher/fixture load is permitted on this fresh process.
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-images-offline"]
    app.launch()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.tap()
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.webViews.staticTexts["Publisher navigation"].exists)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons["folder-downloaded"].tap()
    card.tap()
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["Website"].exists)
    XCTAssertFalse(app.buttons["browser-back"].isEnabled)
    XCTAssertFalse(app.buttons["browser-forward"].isEnabled)
    XCTAssertFalse(app.alerts["Could not open article"].exists)
    app.buttons["reader-appearance"].tap()
    XCTAssertTrue(app.buttons["reader-font"].waitForExistence(timeout: 5))
    capture(app, "42-offline-reader-appearance")
    app.buttons["Done"].tap()
    // Toggling a saved link must preserve its already downloaded Reader copy.
    let save = app.buttons["reader-save"]
    save.tap()
    XCTAssertEqual(save.value as? String, "Not saved")
    save.tap()
    XCTAssertEqual(save.value as? String, "Saved")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    app.terminate()
    app.launch()
    app.buttons["folder-downloaded"].tap()
    card.tap()
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].waitForExistence(timeout: 10))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    card.press(forDuration: 1)
    app.buttons["Remove link"].tap()
    XCTAssertTrue(app.staticTexts["Take a good read with you."].waitForExistence(timeout: 5))
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
      let articlesFolder = app.cells.matching(NSPredicate(format: "label BEGINSWITH 'Arctic'"))
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
    XCTAssertTrue(
      app.staticTexts["The quiet art of paying attention"].waitForExistence(timeout: 10))
    capture(app, "61-prefetched-clipboard-preview")
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
    XCTAssertGreaterThan(tag.frame.minY, app.frame.height * 0.7)
    XCTAssertFalse(
      app.staticTexts["Tags group your saved articles. Tap a tag to add or remove it."].exists)
    capture(app, "62-compact-tags")
    tag.tap()
    tag.typeText("Ideas")
    app.buttons["add-tag"].tap()
    app.buttons["save-tags"].tap()
    let ideas = app.buttons["folder-tag-Ideas"]
    XCTAssertLessThan(ideas.frame.minX, app.buttons["folder-history"].frame.minX)
    XCTAssertLessThan(
      app.buttons["folder-history"].frame.minX, app.buttons["folder-archive"].frame.minX)
    ideas.tap()
    XCTAssertTrue(article.waitForExistence(timeout: 5))
    capture(app, "15-tag-folder")
    article.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    XCTAssertFalse(article.exists)
    app.buttons["folder-archive"].tap()
    XCTAssertTrue(article.exists)
    XCTAssertLessThan(article.frame.height, 145)
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
    let increase = app.buttons["reader-increase-text-size"]
    for _ in 0..<15 where increase.isEnabled { increase.tap() }
    XCTAssertFalse(increase.isEnabled)
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
    let articles = app.cells["Arctic"]
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
    let footerY = save.frame.midY
    let previewTitle = app.staticTexts["share-preview-title"]
    XCTAssertTrue(previewTitle.waitForExistence(timeout: 5))
    let revealed = expectation(
      for: NSPredicate(format: "hittable == true"), evaluatedWith: previewTitle)
    wait(for: [revealed], timeout: 5)
    XCTAssertEqual(save.frame.midY, footerY, accuracy: 2)
    XCTAssertLessThan(previewTitle.frame.maxY, save.frame.minY)
    capture(app, "08-share-extension")
    save.tap()
    let done = app.buttons["share-done"]
    XCTAssertTrue(done.waitForExistence(timeout: 5))
    done.tap()
    // Match the real Safari flow: finish sharing, then foreground Arctic.
    XCUIDevice.shared.press(.home)
    app.activate()
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
    showReader(app)
    capture(app, "live-reader")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    capture(app, "live-library")
  }

  @MainActor private func showReader(_ app: XCUIApplication) {
    let toggle = app.buttons["reader-toggle"]
    waitEnabled(toggle)
    if toggle.label == "Reader" { toggle.tap() }
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10), app.debugDescription)
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

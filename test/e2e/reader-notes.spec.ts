import {
  test,
  expect,
  openLocalBook,
  waitForReaderReady,
  nextSpread,
  currentPages,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("captures thoughts over a stable book and browses both notebook orders", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page
    .getByRole("button", { name: "Start reading", exact: true })
    .click();
  for (let pageIndex = 0; pageIndex < 8; pageIndex++) await nextSpread(page);
  await waitForReaderReady(page);
  const spread = page.locator('[data-reader-spread-layer="current"]');
  const bounds = await spread.boundingBox();
  if (!bounds) throw new Error("No reading spread");
  if (!(await page.getByRole("button", { name: "Jot a note" }).isVisible())) {
    await page.touchscreen.tap(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  }
  const trigger = page.getByRole("button", { name: "Jot a note" });
  const scrubber = page.locator("canvas.cursor-ew-resize");
  const triggerBounds = (await trigger.boundingBox())!;
  const scrubberBounds = (await scrubber.boundingBox())!;
  expect(triggerBounds.x).toBeGreaterThan(
    scrubberBounds.x + scrubberBounds.width * 0.8,
  );
  expect(triggerBounds.y + triggerBounds.height).toBeLessThan(scrubberBounds.y);
  await expect(trigger).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(
    Math.abs(scrubberBounds.x + scrubberBounds.width / 2 - 195),
  ).toBeLessThan(3);
  await trigger.click();
  const before = await currentPages(page);
  const stage = page.locator('[data-reader-stage-slot="content"]');
  const stageBefore = await stage.boundingBox();
  const input = page.getByRole("textbox", { name: "Write a note" });
  await expect(input).toBeFocused();
  const closedWidth = (await input.boundingBox())!.width;
  // Emulate the viewport signal, not an actual iOS keyboard.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", {
      configurable: true,
      value: window.innerHeight - 300,
    });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(async () => (await input.boundingBox())!.width)
    .toBeGreaterThan(closedWidth);
  await expect(page.locator("[data-note-composer]")).toHaveCSS(
    "padding-bottom",
    "0px",
  );
  const immediateBottom = await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "offsetTop", {
      configurable: true,
      value: 40,
    });
    window.visualViewport!.dispatchEvent(new Event("scroll"));
    return (document.querySelector("[data-note-composer]") as HTMLElement).style
      .bottom;
  });
  expect(immediateBottom).toBe("260px");
  await page.evaluate(() => {
    delete (window.visualViewport as unknown as { height?: number }).height;
    delete (window.visualViewport as unknown as { offsetTop?: number })
      .offsetTop;
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(async () => (await input.boundingBox())!.width)
    .toBe(closedWidth);
  const shortHeight = (await input.boundingBox())!.height;
  await input.fill(
    "How easily curiosity becomes courage.\nAlice follows the rabbit before she knows where it leads.\nIs the uncertainty part of the invitation?",
  );
  expect((await input.boundingBox())!.height).toBeGreaterThan(shortHeight);
  expect(await currentPages(page)).toEqual(before);
  expect(await stage.boundingBox()).toEqual(stageBefore);
  await page.screenshot({ path: "/tmp/reader-note-composer.png" });
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await page.context().setOffline(false);
  await expect(
    page.getByRole("button", { name: "Read latest note" }),
  ).toContainText("How easily curiosity");
  await page.touchscreen.tap(
    bounds.x + bounds.width * 0.9,
    bounds.y + bounds.height * 0.3,
  );
  await expect(input).not.toBeVisible();
  expect(await currentPages(page)).toEqual(before);
  await page.getByRole("button", { name: "Jot a note" }).click();
  await input.fill("Return to this idea later.");
  await page.touchscreen.tap(
    bounds.x + bounds.width * 0.9,
    bounds.y + bounds.height * 0.3,
  );
  await expect(input).not.toBeVisible();
  expect(await currentPages(page)).toEqual(before);
  // Chrome remains visible after leaving note capture.
  await page.getByRole("button", { name: "Jot a note" }).click();
  await expect(input).toHaveValue("Return to this idea later.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Read latest note" }),
  ).toContainText("Return to this idea later.");
  await page.getByRole("button", { name: "Read latest note" }).click();
  await expect(
    page.getByRole("region", { name: "Book notebook" }),
  ).toContainText("Notebook 2");
  await page.screenshot({ path: "/tmp/reader-notebook-chat.png" });
  await page.getByRole("button", { name: "Notebook order" }).click();
  await page.getByRole("menuitemradio", { name: "By book" }).click();
  await expect(
    page.getByText("Return to this idea later.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/reader-notebook-journal.png" });
  const sheet = page.getByRole("dialog", { name: "Notebook", exact: true });
  await expect(
    sheet.getByRole("textbox", { name: "Write a note" }),
  ).toBeVisible();
  await expect(input).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Book notebook" })).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await input.fill("A thought from the notebook.");
  await sheet.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    sheet.getByText("A thought from the notebook.", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await input.fill("Keep this draft.");
  await sheet.getByRole("button", { name: "Close notebook" }).click();
  await expect(sheet).not.toBeVisible();
  await expect(input).toHaveValue("Keep this draft.");
  await expect(input).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db: db } = await import(path);
        return (await db.noteDrafts.toArray())[0]?.content;
      }, "/src/lib/sync-v2/db.ts"),
    )
    .toBe("Keep this draft.");
  await page.reload();
  await waitForReaderReady(page);
  const reloadedSpread = await page
    .locator('[data-reader-spread-layer="current"]')
    .boundingBox();
  await page.touchscreen.tap(
    reloadedSpread!.x + reloadedSpread!.width / 2,
    reloadedSpread!.y + reloadedSpread!.height / 2,
  );
  await page.getByRole("button", { name: "Jot a note" }).click();
  await expect(input).toHaveValue("Keep this draft.");
  await input.press("Escape");
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  await page.getByRole("button", { name: /Notes/ }).click();
  await expect(
    page.getByRole("region", { name: "Book notebook" }),
  ).toContainText("A thought from the notebook.");
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db: db } = await import(path);
        return (await db.notes.toArray()).filter(
          (note: { isDeleted: boolean }) => !note.isDeleted,
        ).length;
      }, "/src/lib/sync-v2/db.ts"),
    )
    .toBe(3);
  await page.setViewportSize({ width: 430, height: 844 });
  await waitForReaderReady(page);
  const firstLocation = page
    .getByRole("region", { name: "Book notebook" })
    .getByRole("button", { name: /p\. \d+/ })
    .first();
  await expect(firstLocation).toBeEnabled();
  await firstLocation.click();
  await waitForReaderReady(page);
  const expectedPassage = await page.evaluate(async (path) => {
    const { syncV2Db: db } = await import(path);
    const notes = await db.notes.orderBy("createdAt").toArray();
    return notes[0].anchor.textAfter.trim().replace(/\s+/g, " ");
  }, "/src/lib/sync-v2/db.ts");
  await expect(
    page.locator('[data-reader-spread-layer="current"]'),
  ).toContainText(expectedPassage);
});

test.describe("Desktop margin notes", () => {
  test.use({
    viewport: { width: 1800, height: 1000 },
    hasTouch: false,
    isMobile: false,
  });
  test("remembers the sidebar tab after close and reload", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    await page.mouse.move(600, 20);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    const tools = page.getByRole("complementary", {
      name: "Reader tools",
      exact: true,
    });
    await tools.getByRole("button", { name: "Notes", exact: true }).click();
    const noteInput = tools.getByRole("textbox", { name: "Write a note" });
    await expect(noteInput).toBeFocused();
    await tools
      .getByRole("button", { name: "Close reader tools", exact: true })
      .last()
      .click();
    const closingSidebar = page.locator('aside[aria-label="Reader tools"]');
    await expect(closingSidebar).toHaveAttribute("aria-hidden", "true");
    await expect(
      closingSidebar.locator('button[aria-label="Notes"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      closingSidebar.locator('[aria-label="Book notebook"]'),
    ).toHaveCount(1);
    await expect(
      closingSidebar.locator('[aria-label="Write a note"]'),
    ).toHaveCount(1);

    await page.mouse.move(600, 20);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    await expect(
      tools.getByRole("button", { name: "Notes", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(noteInput).toBeFocused();
    await page.reload();
    await waitForReaderReady(page);
    await page.mouse.move(600, 20);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    await expect(
      tools.getByRole("button", { name: "Notes", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(noteInput).toBeFocused();
  });
  test("captures a margin note without resizing the book", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    const stage = page.locator('[data-reader-stage-slot="content"]');
    const before = await stage.boundingBox();
    for (let index = 0; index < 8; index++) await nextSpread(page);
    const anchorPages = await currentPages(page);
    await page.keyboard.press("n");
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).not.toBeVisible();
    async function openSelectionNote() {
      await page.evaluate(() => {
        const root = document.querySelector(
          '[data-reader-spread-layer="current"]',
        )!;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node && (node.textContent?.trim().length ?? 0) < 30)
          node = walker.nextNode();
        if (!node) throw new Error("No passage to select");
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 25);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
      });
      await expect
        .poll(() =>
          page.evaluate(() => window.getSelection()?.toString().length),
        )
        .toBe(25);
      await page.evaluate(() =>
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
      );
      await expect(
        page.getByRole("button", { name: "Note on highlight" }),
      ).toHaveCount(1);
      await page.getByRole("button", { name: "Note on highlight" }).click();
    }
    await openSelectionNote();
    const panel = page.locator("[data-note-composer]");
    await expect(panel).toBeVisible();
    expect((await panel.boundingBox())!.x).toBeGreaterThan(1200);
    await expect(
      page.getByRole("region", { name: "Book notebook" }),
    ).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Write a note" })
      .fill("A thought from the margin");
    const editorBounds = (await panel.boundingBox())!;
    expect(editorBounds.width).toBeLessThanOrEqual(260);
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Page margin notes" }),
    ).toContainText("A thought from the margin");
    const savedNote = page.locator("[data-margin-note]");
    await expect(savedNote).toBeVisible();
    const savedBounds = (await savedNote.boundingBox())!;
    expect(savedBounds.x).toBe(editorBounds.x);
    expect(savedBounds.width).toBe(editorBounds.width);
    expect(savedBounds.height).toBeLessThan(160);
    await openSelectionNote();
    await expect(savedNote).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open notebook", exact: true }),
    ).toHaveCount(0);
    expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(
      savedBounds.y + savedBounds.height,
    );
    await page
      .getByRole("textbox", { name: "Write a note" })
      .fill("A second thought");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(savedNote).toHaveCount(2);

    await page.screenshot({ path: "/tmp/desktop-margin-note.png" });
    expect(await stage.boundingBox()).toEqual(before);
    expect(await currentPages(page)).toEqual(anchorPages);
    await nextSpread(page);
    const notebookPages = await currentPages(page);
    await page.mouse.move(600, 20);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    const tools = page.getByRole("complementary", {
      name: "Reader tools",
      exact: true,
    });
    await tools.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(
      tools.getByRole("button", { name: "Notes", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const notebook = tools.getByRole("region", { name: "Book notebook" });
    await tools
      .getByRole("textbox", { name: "Write a note" })
      .fill("Written directly in the notebook");
    await tools.getByRole("button", { name: "Save note", exact: true }).click();
    const sidebarNote = notebook
      .locator("article")
      .filter({ hasText: "Written directly in the notebook" });
    await expect(
      sidebarNote.getByRole("button", { name: /p\./ }),
    ).toContainText(`p. ${notebookPages[0]}`);

    await expect(notebook).toContainText("A thought from the margin");
    await expect(
      tools.getByRole("button", { name: "Open notebook", exact: true }),
    ).toHaveCount(0);
    await tools.getByRole("button", { name: "Contents", exact: true }).click();
    await expect(notebook).not.toBeVisible();
    await tools.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(notebook).toContainText("A thought from the margin");
    await expect(
      tools.getByRole("button", { name: "Open notebook", exact: true }),
    ).toHaveCount(0);
    expect(await stage.boundingBox()).toEqual(before);
    await page.screenshot({ path: "/tmp/reader-notes-tab.png" });
  });
});

test.describe("Highlight note capture", () => {
  test.use({
    viewport: { width: 900, height: 900 },
    hasTouch: false,
    isMobile: false,
  });
  test("quotes a highlight in the compact composer", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    for (let index = 0; index < 8; index++) await nextSpread(page);
    await page.evaluate(() => {
      const root = document.querySelector(
        '[data-reader-spread-layer="current"]',
      )!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && (node.textContent?.trim().length ?? 0) < 30)
        node = walker.nextNode();
      if (!node) throw new Error("No passage to select");
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 25);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString().length))
      .toBe(25);
    await page.evaluate(() =>
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
    );
    await page.getByRole("button", { name: "Highlight with yellow" }).click();
    const highlight = page
      .locator('[data-reader-spread-layer="current"] [data-highlight-id]')
      .first();
    await highlight.click();
    await expect(page.locator(".highlight-toolbar")).toHaveCount(1);
    const copyButton = page.getByRole("button", {
      name: "Copy highlighted text",
    });
    const noteButton = page.getByRole("button", { name: "Note on highlight" });
    await expect(noteButton).toBeVisible();
    await expect
      .poll(async () => {
        const copy = (await copyButton.boundingBox())!;
        const note = (await noteButton.boundingBox())!;
        return Math.abs(copy.y - note.y);
      })
      .toBeLessThan(1);
    expect((await noteButton.boundingBox())!.x).toBeGreaterThan(
      (await copyButton.boundingBox())!.x,
    );
    await expect(
      page.getByRole("button", { name: "Note on highlight" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Note on highlight" }).click();
    const quote = page.getByTestId("note-quote");
    await expect(quote).toBeVisible();
    const quotedText = await quote.locator("span").textContent();
    await page
      .getByRole("textbox", { name: "Write a note" })
      .fill("This passage is worth revisiting.");
    await page.getByRole("button", { name: "Remove quote" }).click();
    await expect(quote).not.toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).toHaveValue("This passage is worth revisiting.");
    await highlight.click();
    await expect(
      page.getByRole("button", { name: "Note on highlight" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Note on highlight" }).click();
    await expect(quote).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).toHaveValue("This passage is worth revisiting.");

    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(quote).not.toBeVisible();
    await highlight.click();
    await expect(
      page.getByRole("button", { name: "Note on highlight" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Note on highlight" }).click();
    await page.getByRole("textbox", { name: "Write a note" }).press("Escape");
    await page.mouse.move(600, 20);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Book notebook" }).locator("blockquote"),
    ).toHaveText(quotedText!);
    await page
      .getByRole("region", { name: "Book notebook" })
      .locator("article")
      .first()
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit note" }).click();
    const editor = page.getByRole("textbox", {
      name: "Edit note",
      exact: true,
    });
    await expect(editor).toHaveValue("This passage is worth revisiting.");
    await expect(page.getByTestId("note-quote")).toContainText(quotedText!);
    await expect(
      page.getByRole("button", { name: "Remove quote" }),
    ).toHaveCount(0);
    await editor.fill("A revised reading of this passage.");
    await editor.press("Control+Enter");
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).toHaveValue("");
    await expect(
      page.getByRole("region", { name: "Book notebook" }),
    ).toContainText("A revised reading of this passage.");
    await expect(
      page.getByRole("region", { name: "Book notebook" }).locator("blockquote"),
    ).toHaveText(quotedText!);
  });
});

test("swipes to edit without losing the compose draft or changing the note anchor", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page
    .getByRole("button", { name: "Start reading", exact: true })
    .click();
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await waitForReaderReady(page);
  const spread = page.locator('[data-reader-spread-layer="current"]');
  const bounds = (await spread.boundingBox())!;
  const trigger = page.getByRole("button", { name: "Jot a note" });
  if (!(await trigger.isVisible()))
    await page.touchscreen.tap(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  await trigger.click();
  const compose = page.getByRole("textbox", { name: "Write a note" });
  await compose.fill("The original thought.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(compose).toHaveValue("");
  const readNotes = () =>
    page.evaluate(async (path) => {
      const { syncV2Db: db } = await import(path);
      return (await db.notes.toArray()).filter(
        (note: { isDeleted?: boolean }) => !note.isDeleted,
      );
    }, "/src/lib/sync-v2/db.ts");
  const original = (await readNotes())[0];
  await compose.fill("Keep my next thought.");
  await page.getByRole("button", { name: "Open notebook" }).click();
  const row = page.locator(`[data-note-id="${original.id}"]`);
  const notebookList = row.locator("..");
  async function expectNoHorizontalOverflow() {
    expect(
      await notebookList.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBe(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBe(0);
  }
  await expectNoHorizontalOverflow();
  const cdp = await page.context().newCDPSession(page);
  async function drag(distances: number[], cancel = false) {
    const rect = (await row.locator("article").boundingBox())!;
    const x = rect.x + rect.width * 0.75;
    const y = rect.y + 20;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (const distance of distances) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x - distance, y }],
      });
    }
    if (distances.at(-1)! >= 72)
      await expect(row.locator("[data-swipe-ready=true]")).toBeVisible();
    else await expect(row.locator("[data-swipe-ready=true]")).toHaveCount(0);
    await expectNoHorizontalOverflow();
    if (!cancel && distances.at(-1)! >= 72)
      await page.screenshot({ path: "/tmp/reader-note-swipe-cue.png" });
    await cdp.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
  }
  await drag([12, 30]);
  await expect(compose).toHaveValue("Keep my next thought.");
  await drag([12, 40, 85, 30]);
  await expect(compose).toHaveValue("Keep my next thought.");
  await drag([12, 40, 85], true);
  await expect(compose).toHaveValue("Keep my next thought.");
  await drag([12, 40, 85]);
  const editor = page.getByRole("textbox", { name: "Edit note", exact: true });
  await expect(editor).toHaveValue("The original thought.");
  await expect(page.getByText("Editing note", { exact: true })).toBeVisible();
  await editor.fill("   ");
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await editor.fill("The revised thought.");
  await page.screenshot({ path: "/tmp/reader-note-edit.png" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(compose).toHaveValue("Keep my next thought.");
  await expect(row).toContainText("The revised thought.");
  const saved = await readNotes();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    id: original.id,
    anchor: original.anchor,
    createdAt: original.createdAt,
    content: "The revised thought.",
  });
  await row.locator("article").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit note" }).click();
  await expect(editor).toHaveValue("The revised thought.");
  await editor.fill("Discard this edit.");
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await expect(compose).toHaveValue("Keep my next thought.");
  expect((await readNotes())[0].content).toBe("The revised thought.");
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db: db } = await import(path);
        return (await db.noteDrafts.toArray()).map(
          (draft: { content: string; purpose: string }) => ({
            content: draft.content,
            purpose: draft.purpose,
          }),
        );
      }, "/src/lib/sync-v2/db.ts"),
    )
    .toEqual([{ content: "Keep my next thought.", purpose: "create" }]);
  await expect(page.getByRole("menuitem", { name: "Edit note" })).toBeHidden();
  // Long press provides the same action without requiring a swipe.
  const rect = (await row.locator("article").boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + 20 }],
  });
  await expect(
    page
      .locator('[data-slot="context-menu-content"]')
      .getByRole("menuitem", { name: "Edit note" }),
  ).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page
    .locator('[data-slot="context-menu-content"]')
    .getByRole("menuitem", { name: "Edit note" })
    .click();
  await expect(editor).toHaveValue("The revised thought.");
  await editor.fill("Resume this edit.");
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db: db } = await import(path);
        return (await db.noteDrafts.toArray()).find(
          (draft: { purpose: string }) => draft.purpose === "edit",
        )?.content;
      }, "/src/lib/sync-v2/db.ts"),
    )
    .toBe("Resume this edit.");
  await page.reload();
  await waitForReaderReady(page);
  // The first spread can be ready before loading chrome finishes its exit.
  // Wait before deciding whether the footer needs to be revealed by a tap.
  await expect(
    page.locator('button[aria-label="Jot a note"]:disabled'),
  ).toHaveCount(0);
  if (!(await trigger.isVisible())) {
    const current = (await spread.boundingBox())!;
    await page.touchscreen.tap(
      current.x + current.width / 2,
      current.y + current.height / 2,
    );
  }
  await trigger.click();
  await expect(compose).toHaveValue("Keep my next thought.");
  await page.getByRole("button", { name: "Open notebook" }).click();
  await row.locator("article").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit note" }).click();
  await expect(editor).toHaveValue("Resume this edit.");
  // A received edit must not be overwritten by this stale edit draft.
  await page.evaluate(
    async ({ path, id }) => {
      const { updateNote } = await import(path);
      await updateNote(id, "Changed elsewhere.");
    },
    { path: "/src/data/notes.ts", id: original.id },
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "changed on another device",
  );
  await expect(editor).toHaveValue("Resume this edit.");
  expect((await readNotes())[0].content).toBe("Changed elsewhere.");
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await expect(compose).toHaveValue("Keep my next thought.");
  await cdp.detach();
});

test("keeps the mobile draft and its full height when moving between composer and notebook", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page
    .getByRole("button", { name: "Start reading", exact: true })
    .click();
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await waitForReaderReady(page);
  const spread = page.locator('[data-reader-spread-layer="current"]');
  const trigger = page.getByRole("button", { name: "Jot a note" });
  if (!(await trigger.isVisible())) {
    const bounds = (await spread.boundingBox())!;
    await page.touchscreen.tap(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  }
  await trigger.click();
  const text =
    "First line of my thought.\nThe next part is here.\nA third line to remember.";
  const input = page.getByRole("textbox", { name: "Write a note" });
  await input.fill(text);
  const floatingHeight = (await input.boundingBox())!.height;
  await page.getByRole("button", { name: "Open notebook" }).click();
  const sheet = page.getByRole("dialog", { name: "Notebook", exact: true });
  const sheetInput = sheet.getByRole("textbox", { name: "Write a note" });
  await expect(sheetInput).toHaveValue(text);
  await expect
    .poll(async () => (await sheetInput.boundingBox())!.height)
    .toBe(floatingHeight);
  await sheetInput.fill(`${text}\nWritten in the notebook.`);
  await expect
    .poll(async () => (await sheetInput.boundingBox())!.height)
    .toBeGreaterThan(floatingHeight);
  await sheet.getByRole("button", { name: "Close notebook" }).click();
  await expect(sheet).not.toBeVisible();
  await expect(input).toHaveValue(`${text}\nWritten in the notebook.`);
  await input.fill("Now a shorter thought.");
  await page.getByRole("button", { name: "Open notebook" }).click();
  await expect(sheetInput).toHaveValue("Now a shorter thought.");
  await expect
    .poll(async () => (await sheetInput.boundingBox())!.height)
    .toBeLessThan(floatingHeight);
});

test("swipes right to delete and undo while keeping the compose draft", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page
    .getByRole("button", { name: "Start reading", exact: true })
    .click();
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await waitForReaderReady(page);
  const trigger = page.getByRole("button", { name: "Jot a note" });
  if (!(await trigger.isVisible())) {
    const rect = (await page
      .locator('[data-reader-spread-layer="current"]')
      .boundingBox())!;
    await page.touchscreen.tap(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
  }
  await trigger.click();
  const compose = page.getByRole("textbox", { name: "Write a note" });
  await compose.fill("A thought to delete.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(compose).toHaveValue("");
  const readNotes = () =>
    page.evaluate(async (path) => {
      const { syncV2Db: db } = await import(path);
      return db.notes.toArray();
    }, "/src/lib/sync-v2/db.ts");
  const original = (await readNotes())[0];
  await compose.fill("Keep this draft.");
  await page.getByRole("button", { name: "Open notebook" }).click();
  await expect(page.getByRole("button", { name: "Note actions" })).toHaveCount(
    0,
  );
  const row = page.locator(`[data-note-id="${original.id}"]`);
  const cdp = await page.context().newCDPSession(page);
  async function swipe(travel: number[], cancel = false) {
    const rect = (await row.locator("article").boundingBox())!;
    const x = rect.x + rect.width * 0.25,
      y = rect.y + 20;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (const dx of travel)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + dx, y }],
      });
    await expect(row).toContainText("A thought to delete.");
    expect(
      await row
        .locator("..")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBe(0);
    await cdp.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
  }
  await swipe([12, 35]);
  await expect(row).toBeVisible();
  await swipe([12, 40, 90, 30]);
  await expect(row).toBeVisible();
  await swipe([12, 40, 90], true);
  await expect(row).toBeVisible();
  await page.context().setOffline(true);
  await swipe([12, 40, 90]);
  await expect(row).toHaveCount(0);
  await expect(compose).toHaveValue("Keep this draft.");
  expect((await readNotes())[0].isDeleted).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row).toBeVisible();
  expect((await readNotes())[0]).toMatchObject({
    id: original.id,
    content: original.content,
    anchor: original.anchor,
    createdAt: original.createdAt,
    isDeleted: false,
  });
  await expect(row).toHaveCSS("opacity", "1");
  await expect(row.locator("article")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await row.locator("article").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit note" }).click();
  await page
    .getByRole("textbox", { name: "Edit note", exact: true })
    .fill("An unfinished edit.");
  await swipe([12, 40, 90]);
  await expect(row).toHaveCount(0);
  await expect(compose).toHaveValue("Keep this draft.");
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db: db } = await import(path);
        return (await db.noteDrafts.toArray()).map(
          (draft: { purpose: string }) => draft.purpose,
        );
      }, "/src/lib/sync-v2/db.ts"),
    )
    .toEqual(["create"]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row).toContainText("A thought to delete.");
  await page.context().setOffline(false);
  await cdp.detach();
});

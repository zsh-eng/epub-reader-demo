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
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
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
});

test.describe("Desktop margin notes", () => {
  test.use({
    viewport: { width: 1800, height: 1000 },
    hasTouch: false,
    isMobile: false,
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
    await expect(sidebarNote.getByRole("button")).toContainText(
      `p. ${notebookPages[0]}`,
    );

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
  });
});

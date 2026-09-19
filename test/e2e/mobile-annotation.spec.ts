import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { test, expect, openLocalBook, nextSpread } from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("mobile annotation keeps the passage, draft and book note count", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await selectPassage(page);
  const colors = page.getByRole("group", { name: "Highlight colors" });
  const input = page.getByRole("textbox", { name: "Write a note" });
  const notebook = page.getByRole("button", {
    name: "Open notebook",
    exact: true,
  });
  await expect(colors).toBeVisible();
  await expect(input).not.toBeFocused();
  await expect(notebook).toHaveAttribute(
    "aria-description",
    "0 notes in this book",
  );
  await expect(
    page.getByRole("button", { name: "Highlight with yellow" }),
  ).toHaveCSS("box-shadow", "none");
  await expect(colors).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(
    page.getByRole("button", { name: "Highlight with yellow" }),
  ).toHaveCSS("height", "32px");
  await mkdir("diagnostics/interface-review/annotation-after", {
    recursive: true,
  });
  const screenshot = (name: string) =>
    page.screenshot({
      path: `diagnostics/interface-review/annotation-after/${name}.png`,
      animations: "disabled",
    });
  await expect(page.locator("[data-note-composer]")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  const surface = page.locator("[data-note-input-surface]");
  await expect(surface).toHaveCSS("box-shadow", "none");
  await expect(surface).toHaveCSS("border-radius", "0px");
  expect((await surface.boundingBox())!.width).toBe(390);
  const icon = await notebook.locator("svg").boundingBox();
  expect(icon!.width).toBe(icon!.height);
  await screenshot("mobile-picker");
  await input.fill("A useful thought from this passage.");
  await expect(page.getByTestId("note-quote")).toBeVisible();
  const quote = await page
    .getByTestId("note-quote")
    .locator("span")
    .innerText();
  await expect(colors).toBeVisible();
  // Emulate the visual viewport signal; this does not emulate an iOS keyboard.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", {
      configurable: true,
      value: window.innerHeight - 300,
    });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("[data-note-composer]")).toHaveCSS(
    "bottom",
    "300px",
  );
  await screenshot("typing");
  await page.evaluate(() => {
    delete (window.visualViewport as unknown as { height?: number }).height;
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await page.touchscreen.tap(195, 300);
  await expect(input).not.toBeVisible();
  await page.touchscreen.tap(195, 300);
  await page.getByRole("button", { name: "Jot a note" }).click();
  await expect(input).toHaveValue("A useful thought from this passage.");
  await expect(page.getByTestId("note-quote").locator("span")).toHaveText(
    quote,
  );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(notebook).toHaveAttribute(
    "aria-description",
    "1 note in this book",
  );
  await expect(notebook).toHaveAttribute(
    "aria-description",
    "1 note in this book",
  );
  await expect(
    page
      .locator(
        '[data-reader-spread-layer="current"] mark[data-color="invisible"]',
      )
      .first(),
  ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await screenshot("saved");
  await notebook.click();
  const sheet = page.getByRole("dialog", { name: "Notebook", exact: true });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByText("A useful thought from this passage.", { exact: true }),
  ).toBeVisible();
  await expect(sheet.locator("blockquote")).toHaveText(quote);
  await screenshot("notebook");
  const saved = await page.evaluate(async () => {
    const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
    return {
      notes: await db.notes.toArray(),
      highlights: await db.highlights.toArray(),
    };
  });
  expect(saved.notes.filter((note) => !note.isDeleted)).toHaveLength(1);
  expect(
    saved.highlights.filter(
      (highlight) => !highlight.isDeleted && highlight.color !== "invisible",
    ),
  ).toHaveLength(0);
});

async function selectPassage(page: Page, length = 40) {
  await page.evaluate((length) => {
    // Selecting page text transfers focus away from the composer on a device.
    (document.activeElement as HTMLElement | null)?.blur();
    const root = document.querySelector(
      '[data-reader-spread-layer="current"]',
    )!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    const range = document.createRange();
    while (node) {
      range.selectNodeContents(node);
      // The state matrix starts with chrome visible. Select a passage below
      // the header, as a user would, rather than clicking text covered by it.
      if (
        (node.textContent?.trim().length ?? 0) >= length &&
        (length !== 20 || range.getBoundingClientRect().top >= 120)
      )
        break;
      node = walker.nextNode();
    }
    if (!node) throw new Error("No sample passage");
    range.setStart(node, 0);
    range.setEnd(node, length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  }, length);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
}

test("mobile note can remove its quote and add a highlight while typing", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await selectPassage(page);
  const input = page.getByRole("textbox", { name: "Write a note" });
  await expect(input).toBeVisible();
  await input.fill("A thought with a blue highlight.");
  await page.getByRole("button", { name: "Remove quote" }).click();
  await input.focus();
  await expect(page.getByTestId("note-quote")).not.toBeVisible();
  await expect(
    page.getByRole("group", { name: "Highlight colors" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Highlight with blue" }).click();
  await expect(input).toHaveValue("A thought with a blue highlight.");
  await expect(page.getByTestId("note-quote")).toBeVisible();
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Open notebook", exact: true }),
  ).toHaveAttribute("aria-description", "1 note in this book");
  const saved = await page.evaluate(async () => {
    const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
    return {
      notes: await db.notes.toArray(),
      highlights: await db.highlights.toArray(),
    };
  });
  expect(
    saved.highlights.filter((highlight) => !highlight.isDeleted),
  ).toHaveLength(1);
  expect(saved.notes[0]).toMatchObject({
    quote: { color: "blue" },
    highlightId: saved.highlights[0].id,
  });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({
    path: "diagnostics/interface-review/annotation-after/dark-saved.png",
    animations: "disabled",
  });
});

for (const reduced of [false, true]) {
  test(`annotation state matrix: ${reduced ? "narrow dark reduced motion" : "standard light motion"}`, async ({
    page,
    localBook,
  }, testInfo) => {
    test.setTimeout(60_000);
    if (reduced) await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await page.clock.install();
    await openLocalBook(page, localBook.id);
    for (let i = 0; i < 8; i++) await nextSpread(page);
    if (reduced)
      await page.evaluate(() => document.documentElement.classList.add("dark"));
    const width = page.viewportSize()!.width;
    const footer = page.locator("[data-reader-footer]");
    const panel = page.locator("[data-note-composer]");
    const colors = page.getByRole("group", { name: "Highlight colors" });
    const input = page.getByRole("textbox", { name: "Write a note" });
    const previous = page.getByRole("button", { name: "Read latest note" });
    const notebook = page.getByRole("button", {
      name: "Open notebook",
      exact: true,
    });
    if (!(await page.getByRole("button", { name: "Jot a note" }).isVisible()))
      await page.touchscreen.tap(width / 2, 300);
    await expect(footer).toBeVisible();
    await expect(footer).toHaveCSS("transform", "none");
    // Programmatic ranges skip the native long press. Advance past the tap's
    // intentional 500 ms selection guard before starting the new gesture.
    await page.clock.runFor(550);

    // Observe every painted frame, including entrance/exit and quick reversals.
    await page.evaluate(() => {
      const state = { running: true, overlaps: 0, shifts: [] as number[] };
      (
        window as unknown as { annotationFrames: typeof state }
      ).annotationFrames = state;
      const sample = () => {
        const composer = document.querySelector("[data-note-composer]");
        if (composer) {
          if (document.querySelector("[data-reader-footer]")) state.overlaps++;
          state.shifts.push(
            new DOMMatrixReadOnly(getComputedStyle(composer).transform).m42,
          );
        }
        if (state.running) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    // Selection before input focus replaces already-visible reading chrome.
    await selectPassage(page, 20);
    await expect(colors).toBeVisible();
    await expect(footer).toHaveCount(0);
    await expect(input).not.toBeFocused();
    await expect(previous).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save note", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Highlight with yellow" }).click();
    await expect(panel).toHaveCount(0);
    await expect(footer).toBeVisible();

    // Existing highlight, save, then return to selection with a previous note.
    const mark = page
      .locator('[data-reader-spread-layer="current"] mark[data-highlight-id]')
      .first();
    await mark.click();
    await expect(
      page.getByRole("button", { name: "Delete highlight", exact: true }),
    ).toBeVisible();
    await expect(footer).toHaveCount(0);
    await input.fill("First saved thought");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(previous).toContainText("First saved thought");
    await expect(colors).toHaveCount(0);
    // Reopen an existing highlight during the composer's 180 ms exit.
    await input.press("Escape");
    await mark.click();
    await expect(colors).toBeVisible();
    await expect(panel).toHaveCount(1);
    await expect(previous).toBeVisible();
    await selectPassage(page, 20);
    await expect(colors).toBeVisible();
    await expect(previous).toBeVisible();
    await input.fill("Keep this unfinished thought");
    await expect(page.getByTestId("note-quote")).toBeVisible();
    await expect(previous).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("selection-with-previous-note.png"),
      animations: "disabled",
    });

    // Notebook entry is explicit: leave highlight mode, retain draft and preview.
    await notebook.click();
    const sheet = page.getByRole("dialog", { name: "Notebook", exact: true });
    await expect(sheet).toBeVisible();
    await expect(footer).toHaveCount(0);
    await expect(sheet.getByRole("textbox")).toHaveValue(
      "Keep this unfinished thought",
    );
    await sheet.getByRole("button", { name: "Close notebook" }).click();
    await expect(sheet).not.toBeVisible();
    await expect(colors).toHaveCount(0);
    await expect(previous).toBeVisible();
    await expect(input).toHaveValue("Keep this unfinished thought");

    // Dismiss and reopen an existing highlight; recolor then delete while typing.
    await input.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(footer).toBeVisible();
    await mark.click();
    await expect(colors).toBeVisible();
    await expect(previous).toBeVisible();
    await input.focus();
    await page.getByRole("button", { name: "Highlight with green" }).click();
    await expect(mark).toHaveAttribute("data-color", "green");
    await expect(input).toHaveValue("Keep this unfinished thought");
    await page
      .getByRole("button", { name: "Delete highlight", exact: true })
      .click();
    await expect(mark).toHaveCount(0);
    await expect(input).toHaveValue("Keep this unfinished thought");
    await expect(previous).toBeVisible();
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(notebook).toHaveAttribute(
      "aria-description",
      "2 notes in this book",
    );
    await expect(previous).toContainText("Keep this unfinished thought");
    await previous.click();
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByText("First saved thought", { exact: true }),
    ).toBeVisible();
    await sheet.getByRole("button", { name: "Close notebook" }).click();
    await expect(sheet).not.toBeVisible();

    // Returning to selection must not leave two panels or resurrect reading chrome.
    await input.press("Escape");
    await selectPassage(page, 20);
    await expect(colors).toBeVisible();
    await expect(panel).toHaveCount(1);
    await expect(previous).toBeVisible();
    await expect(footer).toHaveCount(0);
    const frames = await page.evaluate(() => {
      const state = (
        window as unknown as {
          annotationFrames: {
            running: boolean;
            overlaps: number;
            shifts: number[];
          };
        }
      ).annotationFrames;
      state.running = false;
      return state;
    });
    expect(frames.overlaps).toBe(0);
    expect(frames.shifts.length).toBeGreaterThan(0);
    expect(Math.max(...frames.shifts)).toBeLessThanOrEqual(8.1);
    if (reduced) expect(frames.shifts.every((shift) => shift === 0)).toBe(true);
    else expect(frames.shifts.some((shift) => shift > 0)).toBe(true);
    const saved = await page.evaluate(async () => {
      const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
      return (await db.notes.toArray()).filter((note) => !note.isDeleted);
    });
    expect(saved).toHaveLength(2);
  });
}

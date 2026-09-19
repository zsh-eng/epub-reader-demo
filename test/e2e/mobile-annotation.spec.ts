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
  await expect(notebook).toHaveText("0");
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
  await expect(notebook).toHaveText("1");
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

async function selectPassage(page: Page) {
  await page.evaluate(() => {
    const root = document.querySelector(
      '[data-reader-spread-layer="current"]',
    )!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && (node.textContent?.trim().length ?? 0) < 40)
      node = walker.nextNode();
    if (!node) throw new Error("No sample passage");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 40);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
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
  ).toHaveText("1");
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

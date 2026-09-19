import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { test, expect, openLocalBook, nextSpread } from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

async function selectPassage(page: Page, index = 0) {
  await page.evaluate((index) => {
    (document.activeElement as HTMLElement | null)?.blur();
    const root = document.querySelector(
      '[data-reader-spread-layer="current"]',
    )!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node = walker.nextNode();
    let found = 0;
    while (node) {
      range.selectNodeContents(node);
      if (
        (node.textContent?.trim().length ?? 0) >= 20 &&
        range.getBoundingClientRect().top >= 120 &&
        found++ === index
      )
        break;
      node = walker.nextNode();
    }
    if (!node) throw new Error("No sample passage");
    range.setStart(node, 0);
    range.setEnd(node, 20);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  }, index);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
}

async function jot(page: Page) {
  await expect(page.locator("[data-note-composer]")).toHaveCount(0);
  if (!(await page.getByRole("button", { name: "Jot a note" }).isVisible()))
    await page.touchscreen.tap(page.viewportSize()!.width / 2, 300);
  await page.getByRole("button", { name: "Jot a note" }).click();
}

for (const reduced of [false, true]) {
  test(`compact annotation and retained draft ownership${reduced ? " narrow dark reduced motion" : ""}`, async ({
    page,
    localBook,
  }) => {
    test.setTimeout(60_000);
    if (reduced) await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await openLocalBook(page, localBook.id);
    for (let i = 0; i < 8; i++) await nextSpread(page);
    if (reduced)
      await page.evaluate(() => document.documentElement.classList.add("dark"));
    const input = page.getByRole("textbox", { name: "Write a note" });
    const colors = page.getByRole("group", { name: "Highlight colors" });
    const quote = page.getByTestId("note-quote");
    const footer = page.locator("[data-reader-footer]");
    const directory = "diagnostics/interface-review/annotation-simplified";
    await mkdir(directory, { recursive: true });
    const capture = (name: string) =>
      page.screenshot({
        path: `${directory}/${reduced ? "dark-" : ""}${name}.png`,
        animations: "disabled",
      });
    // Observe footer exclusion throughout entrance, dismissal and reopening.
    await page.evaluate(() => {
      const state = { running: true, overlaps: 0 };
      (
        window as unknown as { annotationFrames: typeof state }
      ).annotationFrames = state;
      const sample = () => {
        if (
          document.querySelector("[data-note-composer]") &&
          document.querySelector("[data-reader-footer]")
        )
          state.overlaps++;
        if (state.running) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await selectPassage(page);
    await expect(colors).toBeVisible();
    await expect(quote).toHaveCount(0);
    await expect(input).not.toBeFocused();
    await expect(footer).toHaveCount(0);
    await capture("selection");
    await input.fill("This draft belongs to the original passage.");
    await expect(colors).toHaveCount(0);
    await expect(quote).toBeVisible();
    const originalQuote = await quote.locator("span").first().innerText();
    await capture("writing");
    const panel = page.locator("[data-note-composer]");
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, "height", {
        configurable: true,
        value: window.innerHeight - 300,
      });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect
      .poll(async () => {
        const box = (await panel.boundingBox())!;
        return Math.round(box.y + box.height);
      })
      .toBe(page.viewportSize()!.height - 300);
    await expect(quote).toBeVisible();
    await expect(colors).toHaveCount(0);
    await capture("keyboard");
    await page.evaluate(() => {
      delete (window.visualViewport as unknown as { height?: number }).height;
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect(colors).toBeVisible();
    await expect(quote).toHaveCount(0);
    await input.blur();
    await input.focus();
    await expect(quote).toBeVisible();
    await expect(colors).toHaveCount(0);
    await input.press("Escape");
    await expect(page.locator("[data-note-composer]")).toHaveCount(0);
    await selectPassage(page, 2);
    await expect(input).toHaveValue(
      "This draft belongs to the original passage.",
    );
    await expect(quote.locator("span").first()).toHaveText(originalQuote);
    await expect(input).not.toBeFocused();
    await input.focus();
    await expect(quote.locator("span").first()).toHaveText(originalQuote);
    await page.getByRole("button", { name: "Note attachment" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Use selected passage" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    // Returning to the original passage must clear the earlier alternative.
    // Let the 300 ms touch-selection debounce resolve before focusing the input.
    await page.clock.install();
    await selectPassage(page);
    await page.clock.runFor(350);
    await input.focus();
    await page.getByRole("button", { name: "Note attachment" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Use selected passage" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.locator("[data-note-composer]")).toHaveCount(0);
    const saved = await page.evaluate(async () => {
      const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
      return (await db.notes.toArray()).filter((note) => !note.isDeleted);
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ quote: { text: originalQuote } });
    await jot(page);
    await expect(
      page.getByRole("button", { name: "Read latest note" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Open notebook", exact: true })
      .click();
    const sheet = page.getByRole("dialog", { name: "Notebook", exact: true });
    await expect(sheet).toContainText(
      "This draft belongs to the original passage.",
    );
    await expect(
      sheet.getByRole("button", { name: "Open notebook", exact: true }),
    ).toHaveAttribute("aria-description", "1 note in this book");
    await capture("notebook");
    const overlaps = await page.evaluate(() => {
      const state = (
        window as unknown as {
          annotationFrames: { running: boolean; overlaps: number };
        }
      ).annotationFrames;
      state.running = false;
      return state.overlaps;
    });
    expect(overlaps).toBe(0);
  });
}

test("explicit reassignment, quote removal and highlight deletion preserve note intent", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  const input = page.getByRole("textbox", { name: "Write a note" });
  const quote = page.getByTestId("note-quote");
  await selectPassage(page);
  await page.getByRole("button", { name: "Highlight with yellow" }).click();
  const mark = page
    .locator('[data-reader-spread-layer="current"] mark')
    .first();
  await mark.click();
  const yellow = page.getByRole("button", { name: "Highlight with yellow" });
  await expect(yellow).toHaveAttribute("aria-pressed", "true");
  await yellow.click();
  await expect(mark).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove highlight", exact: true }),
  ).toBeVisible();
  await input.fill("Retained thought");
  const first = await quote.locator("span").first().innerText();
  await input.press("Escape");
  await expect(page.locator("[data-note-composer]")).toHaveCount(0);
  await selectPassage(page, 2);
  await input.focus();
  await page.getByRole("button", { name: "Note attachment" }).click();
  await page.getByRole("menuitem", { name: "Use selected passage" }).click();
  await expect(quote.locator("span").first()).not.toHaveText(first);
  await expect(input).toHaveValue("Retained thought");
  await page.getByRole("button", { name: "Note attachment" }).click();
  await page.getByRole("menuitem", { name: "Remove quote" }).click();
  await input.focus();
  await expect(quote).toHaveCount(0);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator("[data-note-composer]")).toHaveCount(0);
  await mark.click();
  await page
    .getByRole("button", { name: "Remove highlight", exact: true })
    .click();
  await expect(mark).toHaveCount(0);
  const saved = await page.evaluate(async () => {
    const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
    return (await db.notes.toArray()).filter((note) => !note.isDeleted);
  });
  expect(saved[0]).toMatchObject({ content: "Retained thought" });
  expect(saved[0]).not.toHaveProperty("quote");
});

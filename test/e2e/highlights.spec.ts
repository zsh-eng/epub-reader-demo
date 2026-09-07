import { expect, test } from "./helpers/fixtures";

test("renders highlight cards after a cold query resolves", async ({
  page,
  localBook,
}) => {
  await page.evaluate(async (bookId) => {
    const path = "/src/lib/db.ts";
    await (
      await import(path)
    ).addHighlight({
      id: "cold-card",
      bookId,
      spineItemId: "chapter",
      startOffset: 0,
      endOffset: 16,
      selectedText: "Cold query card.",
      textBefore: "",
      textAfter: "",
      color: "yellow",
      createdAt: Date.now(),
    });
  }, localBook.id);
  await page.goto("/highlights");
  await expect(
    page.getByText("Cold query card.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy highlight to clipboard" }),
  ).toBeVisible();
});

test.describe("Mobile highlight durability", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("saves offline and supports keyboard activation and pointer cancellation", async ({
    page,
    localBook,
  }) => {
    const { openLocalBook, nextSpread } = await import("./helpers/fixtures");
    await openLocalBook(page, localBook.id);
    for (let index = 0; index < 8; index++) await nextSpread(page);
    // Load the existing database module before taking the browser offline.
    await page.evaluate(async () => {
      const path = "/src/lib/db.ts";
      await import(path);
    });
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
    const yellow = page.getByRole("button", { name: "Highlight with yellow" });
    await expect(yellow).toBeVisible();
    await page.context().setOffline(true);
    await yellow.tap();
    const savedHighlights = () =>
      page.evaluate(async (bookId) => {
        const path = "/src/lib/db.ts";
        return (await import(path)).getBookHighlights(bookId);
      }, localBook.id);
    await expect
      .poll(async () =>
        (await savedHighlights()).map((h: { color: string }) => h.color),
      )
      .toEqual(["yellow"]);
    const passage = page
      .locator('[data-reader-spread-layer="current"] [data-highlight-id]')
      .first();
    await passage.tap();
    const remove = page.getByRole("button", { name: "Delete highlight" });
    await expect(remove).toBeVisible();
    await remove.dispatchEvent("pointerdown", {
      pointerId: 3,
      pointerType: "touch",
      bubbles: true,
      cancelable: true,
    });
    await remove.dispatchEvent("pointercancel", {
      pointerId: 3,
      pointerType: "touch",
      bubbles: true,
    });
    await expect(remove).toBeVisible();
    expect(
      (await savedHighlights()).map((h: { color: string }) => h.color),
    ).toEqual(["yellow"]);
    const green = page.getByRole("button", { name: "Highlight with green" });
    await green.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () =>
        (await savedHighlights()).map((h: { color: string }) => h.color),
      )
      .toEqual(["green"]);
    await remove.focus();
    await page.keyboard.press("Space");
    await expect.poll(savedHighlights).toEqual([]);
    await expect(remove).not.toBeVisible();
    await expect(passage).toHaveCount(0);
    await page.context().setOffline(false);
  });
});

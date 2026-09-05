import {
  currentPages,
  expect,
  nextSpread,
  openLocalBook,
  SAMPLE_BOOK_TITLE,
  test,
  waitForReaderReady,
} from "./helpers/fixtures";

async function returnToLibrary(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
}

test.describe("Reader with local EPUB data", () => {
  test.beforeEach(async ({ page, localBook }) => {
    await openLocalBook(page, localBook.id);
  });

  test("should display content and turn a page", async ({ page }) => {
    await nextSpread(page);
    expect((await currentPages(page)).length).toBeGreaterThan(0);
  });

  test("should navigate back to library", async ({ page }) => {
    await returnToLibrary(page);
    await expect(
      page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
    ).toBeVisible();
  });

  test("should show table of contents", async ({ page }) => {
    await page.mouse.move(600, 20);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /CHAPTER I\. Down the Rabbit-Hole/i }),
    ).toBeVisible();
  });

  test("should restore the saved spread after leaving and reopening", async ({
    page,
    localBook,
  }) => {
    await nextSpread(page);
    const pagesBefore = await currentPages(page);
    await returnToLibrary(page);
    const checkpoint = await page.evaluate(async (bookId) => {
      const modulePath = "/src/lib/sync-v2/db.ts";
      const { syncV2Db: db } = await import(modulePath);
      return db.readingCheckpoints.where("bookId").equals(bookId).first();
    }, localBook.id);
    expect(checkpoint).toMatchObject({ bookId: localBook.id });
    expect(
      checkpoint.currentSpineIndex > 0 || checkpoint.scrollProgress > 0,
    ).toBe(true);
    await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
    await waitForReaderReady(page);
    await expect.poll(() => currentPages(page)).toEqual(pagesBefore);
  });
});

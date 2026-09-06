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

test("scrubs after a resize and restores the committed spread", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page.setViewportSize({ width: 1000, height: 780 });
  await waitForReaderReady(page);
  await page.locator('[data-reader-chrome-rail="bottom"]').hover();
  const scrubber = page.locator("canvas.cursor-ew-resize");
  await expect(scrubber).toBeVisible();
  const before = await currentPages(page);
  const bounds = await scrubber.boundingBox();
  if (!bounds) throw new Error("Scrubber has no visible bounds");
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 - 60,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.up();
  await expect.poll(() => currentPages(page)).not.toEqual(before);
  // A fling previews pages until it settles. Wait for its durable commit.
  await expect
    .poll(() =>
      page.evaluate(async (bookId) => {
        const modulePath = "/src/lib/db.ts";
        const checkpoint = await (
          await import(modulePath)
        ).getCurrentDeviceReadingCheckpoint(bookId);
        return (
          !!checkpoint &&
          (checkpoint.currentSpineIndex > 0 || checkpoint.scrollProgress > 0)
        );
      }, localBook.id),
    )
    .toBe(true);
  await waitForReaderReady(page);
  const committed = await currentPages(page);
  await returnToLibrary(page);
  await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
  await waitForReaderReady(page);
  await expect.poll(() => currentPages(page)).toEqual(committed);
});

test.describe("Reader touch subscriptions", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("turns pages with a tap followed by a swipe after rerender", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    const current = page.locator('[data-reader-spread-layer="current"]');
    const beforeTap = await currentPages(page);
    let bounds = await current.boundingBox();
    if (!bounds) throw new Error("Reader has no visible spread");
    await page.touchscreen.tap(
      bounds.x + bounds.width * 0.9,
      bounds.y + bounds.height * 0.5,
    );
    await expect.poll(() => currentPages(page)).not.toEqual(beforeTap);
    await waitForReaderReady(page);
    const beforeSwipe = await currentPages(page);
    bounds = await current.boundingBox();
    if (!bounds) throw new Error("Reader has no visible spread after tapping");
    const cdp = await page.context().newCDPSession(page);
    const y = bounds.y + bounds.height * 0.5;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: bounds.x + bounds.width * 0.85, y }],
    });
    for (const fraction of [0.7, 0.5, 0.3, 0.15]) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: bounds.x + bounds.width * fraction, y }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
    await expect.poll(() => currentPages(page)).not.toEqual(beforeSwipe);
    await waitForReaderReady(page);
  });
});

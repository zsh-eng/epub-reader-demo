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
  await page.evaluate(() => {
    delete (window.visualViewport as unknown as { height?: number }).height;
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
    const pages = await currentPages(page);
    await page.getByRole("button", { name: "Add margin note" }).click();
    await page
      .getByRole("textbox", { name: "Write a note" })
      .fill("A thought from the margin");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).toHaveValue("");
    await page.getByRole("button", { name: "Read latest note" }).click();
    await expect(
      page.getByRole("region", { name: "Book notebook" }),
    ).toContainText("A thought from the margin");
    expect(await stage.boundingBox()).toEqual(before);
    expect(await currentPages(page)).toEqual(pages);
  });
});

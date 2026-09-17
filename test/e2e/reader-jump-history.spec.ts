import {
  test,
  expect,
  openLocalBook,
  nextSpread,
  currentPages,
  waitForReaderReady,
} from "./helpers/fixtures";
import type { Page } from "@playwright/test";
import type { ReaderJumpHistory } from "../../src/features/reader/jump-history";

async function history(page: Page, bookId: string): Promise<ReaderJumpHistory> {
  return page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("reader-jump-history-v1") ?? "[]").find(
        (record: { bookId: string }) => record.bookId === id,
      )?.history,
    bookId,
  );
}

test("records committed scrub and normal visits across reload and offline reflow", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await nextSpread(page);
  const before = await history(page, localBook.id);
  const beforePages = await currentPages(page);
  expect(before.entries.map((entry) => entry.kind)).toEqual(["normal"]);
  await page.locator('[data-reader-chrome-rail="bottom"]').hover();
  const scrubber = page.locator("canvas.cursor-ew-resize");
  await expect(scrubber).toBeVisible();
  const bounds = await scrubber.boundingBox();
  if (!bounds) throw new Error("Missing scrubber");
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x - 90, center.y, { steps: 10 });
  await expect.poll(() => currentPages(page)).not.toEqual(beforePages);
  expect(await history(page, localBook.id)).toEqual(before);
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await history(page, localBook.id)).entries.map((entry) => entry.kind),
    )
    .toEqual(["normal", "scrubber"]);
  await page.mouse.move(500, 300);
  await nextSpread(page);
  await nextSpread(page);
  await expect
    .poll(async () =>
      (await history(page, localBook.id)).entries.map((entry) => entry.kind),
    )
    .toEqual(["normal", "scrubber", "normal"]);
  const saved = await history(page, localBook.id);
  const pages = await currentPages(page);
  await page.reload();
  await waitForReaderReady(page);
  await expect.poll(() => currentPages(page)).toEqual(pages);
  expect(await history(page, localBook.id)).toEqual(saved);
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1000, height: 650 });
  await waitForReaderReady(page);
  expect(await history(page, localBook.id)).toEqual(saved);
  const blockId = saved.entries[saved.cursor].anchor.blockId;
  await expect(
    page
      .locator(
        `[data-reader-spread-layer="current"] [data-reader-block-id="${blockId}"]`,
      )
      .first(),
  ).toBeVisible();
});

test("coalesces contents jumps and adds a separate normal navigation visit", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page.mouse.move(600, 20);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  await page
    .getByRole("button", { name: /CHAPTER II\. The Pool of Tears/i })
    .click();
  await expect
    .poll(async () => (await history(page, localBook.id)).entries.length)
    .toBe(2);
  const previousChapter = (await history(page, localBook.id)).entries.at(-1)!
    .anchor.chapterIndex;
  await page
    .getByRole("button", { name: /CHAPTER III\. A Caucus-Race/i })
    .click();
  await expect
    .poll(
      async () =>
        (await history(page, localBook.id)).entries.at(-1)?.anchor.chapterIndex,
    )
    .not.toBe(previousChapter);
  expect((await history(page, localBook.id)).entries).toHaveLength(2);
  await page
    .getByRole("navigation", { name: "Reader tools" })
    .getByRole("button", { name: "Close reader tools", exact: true })
    .click();
  await nextSpread(page);
  await nextSpread(page);
  expect(
    (await history(page, localBook.id)).entries.map((entry) => entry.kind),
  ).toEqual(["normal", "toc", "normal"]);
});

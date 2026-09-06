import { test, expect } from "@playwright/test";
import {
  importSampleBook,
  SAMPLE_BOOK_TITLE,
  waitForReaderReady,
  nextSpread,
} from "./helpers/fixtures";

test("cached production PWA opens in a fresh page offline and reconnects", async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    localStorage.setItem("reader-performance-tracing-enabled-v1", "true"),
  );
  await page.goto("/");
  await importSampleBook(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
  await waitForReaderReady(page);
  await page.locator('[data-reader-chrome-rail="bottom"]').hover();
  await expect(page.locator("canvas.cursor-ew-resize")).toBeAttached();
  await nextSpread(page);
  const url = page.url();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("epub-reader-db-v2");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<boolean>((resolve, reject) => {
            const request = db
              .transaction("readingCheckpoints")
              .objectStore("readingCheckpoints")
              .getAll();
            request.onsuccess = () =>
              resolve(
                request.result.some(
                  (row) => row.currentSpineIndex > 0 || row.scrollProgress > 0,
                ),
              );
            request.onerror = () => reject(request.error);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBe(true);
  await page.close();
  await context.setOffline(true);
  const fresh = await context.newPage();
  await fresh.goto(url);
  await waitForReaderReady(fresh);
  expect(await fresh.evaluate(() => navigator.onLine)).toBe(false);
  expect(await fresh.evaluate(() => !!navigator.serviceWorker.controller)).toBe(
    true,
  );
  await fresh.locator('[data-reader-chrome-rail="bottom"]').hover();
  await expect(fresh.locator("canvas.cursor-ew-resize")).toBeVisible();
  await nextSpread(fresh);
  await context.setOffline(false);
  await nextSpread(fresh);
});

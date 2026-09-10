import {
  test,
  expect,
  SAMPLE_EPUB_PATH,
  SAMPLE_BOOK_TITLE,
  waitForReaderReady,
} from "./helpers/fixtures";

test("duplicate batches show existing books while malformed files still report failure", async ({
  page,
  localBook,
}) => {
  expect(localBook.id).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const chooseFiles = async () => {
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add book", exact: true }).click();
    return chooser;
  };
  await (await chooseFiles()).setFiles([SAMPLE_EPUB_PATH, SAMPLE_EPUB_PATH]);
  await expect(
    page.getByText("Already in library", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("2 skipped (already in library)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Import failed", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toHaveCount(1);

  await (
    await chooseFiles()
  ).setFiles([
    {
      name: "broken.epub",
      mimeType: "application/epub+zip",
      buffer: Buffer.from("invalid epub"),
    },
  ]);
  await expect(page.getByText("Import failed", { exact: true })).toBeVisible();
  await expect(page.getByText("1 failed", { exact: true })).toBeVisible();
});

test("signed-out Devices does not request account sessions", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/sessions", async (route) => {
    requests += 1;
    await route.fulfill({ json: { sessions: [] } });
  });
  await page.goto("/devices");
  await expect(
    page.getByRole("button", { name: "Import EPUB", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(requests).toBe(0);
});

test("mobile import offers Open book after durable preparation without opening automatically", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import EPUB", exact: true }).click();
  await (await chooser).setFiles(SAMPLE_EPUB_PATH);
  const openBook = page.getByRole("button", { name: "Open book", exact: true });
  await expect(openBook).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  const prepared = await page.evaluate(async (modulePath) => {
    const { syncV2Db: db } = await import(modulePath);
    const book = await db.books.toCollection().first();
    const marker = await db.bookMaterializations.get(book.id);
    return {
      id: book.id,
      source: book.sourceFileId,
      markerSource: marker?.sourceFileId,
      entries: await db.bookFiles.where("bookId").equals(book.id).count(),
    };
  }, "/src/lib/sync-v2/db.ts");
  expect(prepared.markerSource).toBe(prepared.source);
  expect(prepared.entries).toBeGreaterThan(0);
  await openBook.click();
  await expect(page).toHaveURL(new RegExp(`/reader/${prepared.id}$`));
  await waitForReaderReady(page);
});

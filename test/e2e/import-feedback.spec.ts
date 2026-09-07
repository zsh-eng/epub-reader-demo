import {
  test,
  expect,
  SAMPLE_EPUB_PATH,
  SAMPLE_BOOK_TITLE,
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

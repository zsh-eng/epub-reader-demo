import {
  expect,
  SAMPLE_BOOK_TITLE,
  test,
  waitForReaderReady,
  nextSpread,
} from "./helpers/fixtures";

test.describe("Library", () => {
  test("should display empty library initially", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Your library is empty")).toBeVisible();
    await expect(
      page.getByText("Drag and drop an EPUB file here", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Import EPUB" }),
    ).toBeVisible();
  });

  test("should add a book via file picker", async ({ page, addSampleBook }) => {
    await page.goto("/");
    await addSampleBook();
    await expect(page.getByText("Your library is empty")).not.toBeVisible();

    const artifacts = await page.evaluate(async () => {
      const readRequest = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("epub-reader-db-v2");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(
        ["books", "files", "bookFiles", "bookMaterializations"],
        "readonly",
      );
      const [books, localFiles, expandedFiles, materializations] =
        (await Promise.all([
          readRequest(transaction.objectStore("books").getAll()),
          readRequest(transaction.objectStore("files").getAll()),
          readRequest(transaction.objectStore("bookFiles").getAll()),
          readRequest(transaction.objectStore("bookMaterializations").getAll()),
        ])) as Record<string, unknown>[][];
      database.close();

      const book = books.find((row) => row.isDeleted !== true);
      if (!book) throw new Error("Imported Book row was not stored");
      const cover = book.cover as {
        fileId: string;
        blurHash: string | null;
      } | null;
      if (!cover) throw new Error("Imported Book has no cover reference");
      const localCover = localFiles.find((row) => row.id === cover.fileId);
      if (!localCover) throw new Error("Optimized cover file was not stored");
      const coverBlob = localCover.blob as Blob;
      const bitmap = await createImageBitmap(coverBlob);
      const marker = materializations.find((row) => row.bookId === book.id);

      const result = {
        sourceFileId: book.sourceFileId,
        blurHash: cover.blurHash,
        coverType: coverBlob.type,
        coverSize: coverBlob.size,
        coverWidth: bitmap.width,
        coverHeight: bitmap.height,
        expandedFileCount: expandedFiles.filter((row) => row.bookId === book.id)
          .length,
        materializedSourceFileId: marker?.sourceFileId,
        materializationRecipeVersion: marker?.recipeVersion,
      };
      bitmap.close();
      return result;
    });

    expect(artifacts.coverType).toBe("image/webp");
    expect(artifacts.coverSize).toBeGreaterThan(0);
    expect(artifacts.coverWidth).toBe(480);
    expect(artifacts.coverHeight).toBeGreaterThan(0);
    expect(artifacts.blurHash).toHaveLength(28);
    expect(artifacts.expandedFileCount).toBeGreaterThan(0);
    expect(artifacts.materializedSourceFileId).toBe(artifacts.sourceFileId);
    expect(artifacts.materializationRecipeVersion).toBe(1);
  });

  test("should search books by title", async ({ page, localBook }) => {
    expect(localBook.id).toBeTruthy();
    const bookHeading = page.getByRole("heading", { name: SAMPLE_BOOK_TITLE });
    const searchInput = page.getByRole("searchbox", { name: "Search library" });
    await searchInput.fill("Alice");
    await expect(bookHeading).toBeVisible();
    await searchInput.fill("Nonexistent Book");
    await expect(page.getByText("Nothing on these shelves")).toBeVisible();
    await expect(bookHeading).not.toBeVisible();
    await searchInput.fill("");
    await expect(bookHeading).toBeVisible();
  });

  test("should open a book from library", async ({ page, localBook }) => {
    await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
    await expect(page).toHaveURL(`/reader/${localBook.id}`);
  });
});

test("updates reading status and library placement while offline", async ({
  page,
  localBook,
  context,
}) => {
  await context.setOffline(true);
  const book = page.getByRole("heading", { name: SAMPLE_BOOK_TITLE });
  await book.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Reading", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Continue Reading", exact: true }),
  ).toBeVisible();
  await book.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Finished", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Continue Reading", exact: true }),
  ).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const modulePath = "/src/lib/db.ts";
        return (await import(modulePath)).getReadingStatus(id);
      }, localBook.id),
    )
    .toBe("finished");
});

test("imports then immediately opens a new EPUB", async ({
  page,
  addSampleBook,
}) => {
  await page.goto("/");
  await addSampleBook();
  await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
  await waitForReaderReady(page);
  await nextSpread(page);
});

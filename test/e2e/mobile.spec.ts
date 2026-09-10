import type { Page } from "@playwright/test";
import {
  test,
  expect,
  SAMPLE_EPUB_PATH,
  SAMPLE_BOOK_TITLE,
  openLocalBook,
  nextSpread,
  currentPages,
} from "./helpers/fixtures";

type NativeMessage = {
  type: string;
  id?: string;
  bookId?: string;
  path?: string;
  duplicate?: boolean;
  error?: string;
};
interface TestWindow extends Window {
  nativeMessages: NativeMessage[];
}
const DB_MODULE = "/src/lib/sync-v2/db.ts";

async function send(page: Page, command: Record<string, unknown>) {
  await page.evaluate(
    (data) =>
      window.dispatchEvent(
        new MessageEvent("reader-native", { data: { version: 1, ...data } }),
      ),
    command,
  );
}

async function messages(page: Page) {
  return page.evaluate(() => (window as unknown as TestWindow).nativeMessages);
}

async function importBook(page: Page, id = crypto.randomUUID()) {
  await page.route(`**/native-import/${id}`, (route) =>
    route.fulfill({
      path: SAMPLE_EPUB_PATH,
      contentType: "application/epub+zip",
    }),
  );
  await send(page, {
    type: "import",
    id,
    name: "Alice.epub",
    url: `http://127.0.0.1:5192/native-import/${id}`,
  });
  await expect
    .poll(async () =>
      (await messages(page)).find(
        (message) => message.type === "imported" && message.id === id,
      ),
    )
    .toBeTruthy();
  return (await messages(page)).find(
    (message) => message.type === "imported" && message.id === id,
  )!;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as TestWindow;
    target.nativeMessages = [];
    window.ReactNativeWebView = {
      postMessage: (message) => target.nativeMessages.push(JSON.parse(message)),
    };
  });
  await page.goto("/");
  await expect
    .poll(async () =>
      (await messages(page)).some(({ type }) => type === "ready"),
    )
    .toBe(true);
});

test("imports locally, filters with native search, and delegates navigation", async ({
  page,
}) => {
  const imported = await importBook(page);
  await expect(
    page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search library" }),
  ).toBeHidden();
  await send(page, { type: "search", query: "does not match any book" });
  await expect(
    page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toBeHidden();
  await send(page, { type: "search", query: "alice" });
  await expect(
    page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toBeVisible();
  await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
  await expect
    .poll(
      async () =>
        (await messages(page)).find(({ type }) => type === "navigate")?.path,
    )
    .toBe(`/reader/${imported.bookId}`);
  expect(new URL(page.url()).pathname).toBe("/");
  const duplicate = await importBook(page);
  expect(duplicate.duplicate).toBe(true);
  expect(duplicate.bookId).toBe(imported.bookId);
  const rows = await page.evaluate(async (modulePath) => {
    const { syncV2Db: db } = await import(modulePath);
    return {
      books: await db.books.count(),
      materializations: await db.bookMaterializations.count(),
      files: await db.files.count(),
    };
  }, DB_MODULE);
  expect(rows.books).toBe(1);
  expect(rows.materializations).toBe(1);
  expect(rows.files).toBeGreaterThan(0);
});

test("rejects a malformed EPUB and an import from another origin", async ({
  page,
}) => {
  const id = crypto.randomUUID();
  await page.route(`**/native-import/${id}`, (route) =>
    route.fulfill({ body: "not an epub" }),
  );
  await send(page, {
    type: "import",
    id,
    name: "Broken.epub",
    url: `http://127.0.0.1:5192/native-import/${id}`,
  });
  await expect
    .poll(
      async () =>
        (await messages(page)).find(
          (message) => message.type === "import-error" && message.id === id,
        )?.error,
    )
    .toBeTruthy();
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("example.invalid"))
      externalRequests.push(request.url());
  });
  await send(page, {
    type: "import",
    id: crypto.randomUUID(),
    name: "Other.epub",
    url: "https://example.invalid/book.epub",
  });
  await send(page, { type: "search", query: "" });
  expect(externalRequests).toEqual([]);
  expect(
    await page.evaluate(
      async (modulePath) => (await import(modulePath)).syncV2Db.books.count(),
      DB_MODULE,
    ),
  ).toBe(0);
});

test("native background saves the reading position and note draft before reopen", async ({
  page,
}) => {
  const { bookId } = await importBook(page);
  await openLocalBook(page, bookId!);
  await page
    .getByRole("button", { name: "Start reading", exact: true })
    .click();
  for (let i = 0; i < 8; i++) await nextSpread(page);
  const before = await currentPages(page);
  const note = page.getByRole("button", { name: "Jot a note" });
  if (!(await note.isVisible())) {
    const bounds = await page
      .locator('[data-reader-spread-layer="current"]')
      .boundingBox();
    await page.touchscreen.tap(
      bounds!.x + bounds!.width / 2,
      bounds!.y + bounds!.height / 2,
    );
  }
  await note.click();
  await page
    .getByRole("textbox", { name: "Write a note" })
    .fill("A draft saved when the native app goes to sleep.");
  await send(page, { type: "lifecycle", active: false });
  await expect
    .poll(() =>
      page.evaluate(async (modulePath) => {
        const { syncV2Db: db } = await import(modulePath);
        return (await db.noteDrafts.toArray())[0]?.content;
      }, DB_MODULE),
    )
    .toBe("A draft saved when the native app goes to sleep.");
  await expect
    .poll(() =>
      page.evaluate(async (modulePath) => {
        const { syncV2Db: db } = await import(modulePath);
        return db.readingCheckpoints.count();
      }, DB_MODULE),
    )
    .toBeGreaterThan(0);
  await page.reload();
  await expect.poll(() => currentPages(page)).toEqual(before);
  const reopened = await page
    .locator('[data-reader-spread-layer="current"]')
    .boundingBox();
  await page.touchscreen.tap(
    reopened!.x + reopened!.width / 2,
    reopened!.y + reopened!.height / 2,
  );
  await page.getByRole("button", { name: "Jot a note" }).click();
  await expect(page.getByRole("textbox", { name: "Write a note" })).toHaveValue(
    "A draft saved when the native app goes to sleep.",
  );
});

test("a highlight saved in native mode remains visible after reopening", async ({
  page,
}) => {
  const { bookId } = await importBook(page);
  await openLocalBook(page, bookId!);
  await page
    .getByRole("button", { name: "Start reading", exact: true })
    .click();
  for (let index = 0; index < 8; index++) await nextSpread(page);
  // Set a DOM selection as in the shared highlight test. This checks the
  // Reader's selection/save path; it does not simulate an iOS long press.
  const selected = await page.evaluate(() => {
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
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe(selected);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
  await page.getByRole("button", { name: "Highlight with yellow" }).tap();
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db: db } = await import(path);
        return (await db.highlights.toArray()).map(
          (row: { selectedText: string }) =>
            row.selectedText.replace(/\s+/g, " ").trim(),
        );
      }, DB_MODULE),
    )
    .toEqual([selected.replace(/\s+/g, " ").trim()]);
  await page.reload();
  await expect(
    page
      .locator('[data-reader-spread-layer="current"] [data-highlight-id]')
      .first(),
  ).toBeVisible();
  await page.goto("/highlights");
  await expect(
    page.getByText(selected, { exact: false }).first(),
  ).toBeVisible();
  await send(page, { type: "search", query: "no matching passage exists" });
  await expect(page.getByText(selected, { exact: false }).first()).toBeHidden();
  await send(page, { type: "search", query: "" });
  await expect(
    page.getByText(selected, { exact: false }).first(),
  ).toBeVisible();
});

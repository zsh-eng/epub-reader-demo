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
  state?: NativeReaderState;
};
interface NativeReaderState {
  session: string;
  bookId: string;
  acknowledged: number;
  draft: { content: string; editingId: string; ready: boolean };
  notes: { id: string; text: string }[];
  settings: { theme: string; fontSize: number };
}
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

async function readerState(page: Page) {
  return (await messages(page))
    .filter((message) => message.type === "reader-state")
    .at(-1)?.state;
}

async function readerCommand(page: Page, command: Record<string, unknown>) {
  await expect
    .poll(async () => (await readerState(page))?.draft.ready)
    .toBe(true);
  const state = (await readerState(page))!;
  const sequence = state.acknowledged + 1;
  await send(page, {
    type: "reader-command",
    bookId: state.bookId,
    session: state.session,
    sequence,
    command,
  });
  await expect
    .poll(async () => (await readerState(page))?.acknowledged)
    .toBe(sequence);
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

test.beforeEach(async ({ page, context }) => {
  await context.addInitScript(() => {
    const target = window as unknown as TestWindow;
    target.nativeMessages = [];
    window.webkit = {
      messageHandlers: {
        reader: {
          postMessage: (message) =>
            target.nativeMessages.push(message as NativeMessage),
        },
      },
    };
  });
  await page.goto("/");
  await expect
    .poll(async () =>
      (await messages(page)).some(({ type }) => type === "ready"),
    )
    .toBe(true);
});

test("a warm Library adopts Reader appearance when its native tab becomes active", async ({
  page,
  context,
}) => {
  const { bookId } = await importBook(page);
  await send(page, { type: "lifecycle", active: false });
  const reader = await context.newPage();
  await openLocalBook(reader, bookId!);
  await readerCommand(reader, {
    action: "settings",
    patch: { theme: "flexoki-dark" },
  });
  await expect(reader.locator("html")).toHaveClass(/flexoki-dark/);
  await send(page, { type: "lifecycle", active: true });
  await expect(page.locator("html")).toHaveClass(/flexoki-dark/);
  const readBackground = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await readBackground(page)).toBe(await readBackground(reader));
  await reader.close();
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
  await readerCommand(page, { action: "start-reading" });
  for (let i = 0; i < 8; i++) await nextSpread(page);
  const before = await currentPages(page);
  await readerCommand(page, {
    action: "draft",
    content: "A draft saved when the native app goes to sleep.",
  });
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
  await expect
    .poll(async () => (await readerState(page))?.draft.content)
    .toBe("A draft saved when the native app goes to sleep.");
});

test("a highlight saved in native mode remains visible after reopening", async ({
  page,
}) => {
  const { bookId } = await importBook(page);
  await openLocalBook(page, bookId!);
  await readerCommand(page, { action: "start-reading" });
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

test("native notebook saves, edits, restores a compose draft, deletes and undoes locally", async ({
  page,
}) => {
  const { bookId } = await importBook(page);
  await openLocalBook(page, bookId!);
  await readerCommand(page, { action: "start-reading" });
  for (let index = 0; index < 8; index++) await nextSpread(page);
  const before = await currentPages(page);
  const geometry = await page
    .locator('[data-reader-spread-layer="current"]')
    .boundingBox();
  await readerCommand(page, { action: "draft", content: "A native note." });
  await readerCommand(page, { action: "save" });
  await expect
    .poll(async () => (await readerState(page))?.notes.map((note) => note.text))
    .toEqual(["A native note."]);
  const id = (await readerState(page))!.notes[0].id;
  await readerCommand(page, {
    action: "draft",
    content: "Keep this unfinished thought.",
  });
  await readerCommand(page, { action: "edit", id });
  await expect
    .poll(async () => (await readerState(page))?.draft.content)
    .toBe("A native note.");
  await readerCommand(page, {
    action: "draft",
    content: "An edited native note.",
  });
  await readerCommand(page, { action: "save" });
  await expect
    .poll(async () => (await readerState(page))?.draft.content)
    .toBe("Keep this unfinished thought.");
  await readerCommand(page, { action: "delete", id });
  await expect
    .poll(async () => (await readerState(page))?.notes.length)
    .toBe(0);
  await readerCommand(page, { action: "undo", id });
  await expect
    .poll(async () => (await readerState(page))?.notes[0]?.text)
    .toBe("An edited native note.");
  await readerCommand(page, { action: "close" });
  expect(await currentPages(page)).toEqual(before);
  expect(
    await page.locator('[data-reader-spread-layer="current"]').boundingBox(),
  ).toEqual(geometry);
  await page.reload();
  await expect
    .poll(async () => (await readerState(page))?.draft.content)
    .toBe("Keep this unfinished thought.");
  await expect
    .poll(async () => (await readerState(page))?.notes[0]?.text)
    .toBe("An edited native note.");
});

test("native commands reject stale sessions and invalid settings, and commit ordered draft input", async ({
  page,
}) => {
  const { bookId } = await importBook(page);
  await openLocalBook(page, bookId!);
  await readerCommand(page, { action: "draft", content: "First" });
  const state = (await readerState(page))!;
  const envelope = {
    type: "reader-command",
    bookId,
    session: state.session,
    sequence: state.acknowledged + 1,
  };
  await send(page, {
    ...envelope,
    session: "old-session",
    command: { action: "draft", content: "Wrong session" },
  });
  await send(page, {
    ...envelope,
    bookId: "other-book",
    command: { action: "draft", content: "Wrong book" },
  });
  await send(page, {
    ...envelope,
    command: { action: "settings", patch: { fontSize: -12 } },
  });
  await send(page, {
    ...envelope,
    command: { action: "draft", content: "Second" },
  });
  await send(page, {
    ...envelope,
    sequence: envelope.sequence + 1,
    command: { action: "draft", content: "Latest" },
  });
  await expect
    .poll(async () => (await readerState(page))?.acknowledged)
    .toBe(envelope.sequence + 1);
  await expect
    .poll(async () => (await readerState(page))?.draft.content)
    .toBe("Latest");
  // The Swift host can release this WebView only after close is acknowledged.
  // At that point the latest queued text must already be durable, without polling.
  await readerCommand(page, { action: "close" });
  expect(
    await page.evaluate(async (modulePath) => {
      const { syncV2Db: db } = await import(/* @vite-ignore */ modulePath);
      return (await db.noteDrafts.toArray())[0]?.content;
    }, DB_MODULE),
  ).toBe("Latest");
  await readerCommand(page, { action: "save" });
  await expect
    .poll(async () => (await readerState(page))?.notes[0]?.text)
    .toBe("Latest");
  expect((await readerState(page))!.settings.fontSize).toBe(
    state.settings.fontSize,
  );
  await readerCommand(page, {
    action: "settings",
    patch: { theme: "flexoki-light" },
  });
  await expect(page.locator("html")).toHaveClass(/flexoki-light/);
});

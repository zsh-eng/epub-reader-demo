import {
  expect,
  test,
  waitForReaderReady,
  SAMPLE_EPUB_PATH,
} from "./helpers/fixtures";
import { readFile } from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

test.use({
  viewport: { width: 1440, height: 900 },
  isMobile: false,
  hasTouch: false,
  signedIn: true,
});

test("keeps sidebar controls selected and edge corners concentric", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "Toggle sidebar",
    exact: true,
  });
  await expect(trigger).toHaveAttribute("aria-pressed", "false");
  await trigger.click();
  const panel = page.locator('[data-slot="sidebar-inner"]');
  const close = panel.getByRole("button", {
    name: "Toggle sidebar",
    exact: true,
  });
  await expect(close).toHaveAttribute("aria-pressed", "true");
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toHaveCSS("box-shadow", "none");

  await expect(
    panel.getByRole("link", { name: "Reader", exact: true }),
  ).toHaveCount(0);
  const library = panel.getByRole("link", { name: "Library", exact: true });
  await library.hover();
  await expect(library).toHaveCSS("border-top-left-radius", "15px");
  const account = panel.getByRole("button", {
    name: /Test Reader.*reader@example.test/,
  });
  await expect(account).toBeVisible();
  const corners = await panel.evaluate((outer) => {
    const library = outer.querySelector(
      '[data-slot="sidebar-header"] a[href="/"]',
    )!;
    const account = outer.querySelector(
      '[data-slot="sidebar-footer"] button[aria-haspopup="menu"]',
    )!;
    const panelBounds = outer.getBoundingClientRect();
    const libraryBounds = library.getBoundingClientRect();
    const accountBounds = account.getBoundingClientRect();
    const panelStyle = getComputedStyle(outer);
    const libraryStyle = getComputedStyle(library);
    const accountStyle = getComputedStyle(account);
    return {
      libraryRadius: parseFloat(libraryStyle.borderTopLeftRadius),
      libraryInnerRadius: parseFloat(libraryStyle.borderBottomLeftRadius),
      accountRadius: parseFloat(accountStyle.borderBottomLeftRadius),
      accountInnerRadius: parseFloat(accountStyle.borderTopLeftRadius),
      outerRadius: parseFloat(panelStyle.borderTopLeftRadius),
      libraryGapX: libraryBounds.left - panelBounds.left,
      libraryGapY: libraryBounds.top - panelBounds.top,
      accountGapX: accountBounds.left - panelBounds.left,
      accountGapY: panelBounds.bottom - accountBounds.bottom,
    };
  });
  expect(corners.libraryRadius).toBeLessThan(corners.outerRadius);
  expect(corners.libraryInnerRadius).toBeLessThan(corners.libraryRadius);
  expect(corners.accountInnerRadius).toBeLessThan(corners.accountRadius);
  expect(corners.libraryGapX + corners.libraryRadius).toBeCloseTo(
    corners.outerRadius,
    1,
  );
  expect(corners.libraryGapY + corners.libraryRadius).toBeCloseTo(
    corners.outerRadius,
    1,
  );
  expect(corners.accountGapX + corners.accountRadius).toBeCloseTo(
    corners.outerRadius,
    1,
  );
  expect(corners.accountGapY + corners.accountRadius).toBeCloseTo(
    corners.outerRadius,
    1,
  );
  await expect(account).toHaveCSS(
    "border-bottom-right-radius",
    `${corners.accountRadius}px`,
  );
  await page.screenshot({
    path: testInfo.outputPath("sidebar-library-corner.png"),
  });

  await account.hover();
  const hoverColor = await account.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
    return getComputedStyle(element).backgroundColor;
  });
  await account.click();
  await expect(page.getByRole("menuitem", { name: "Devices" })).toBeVisible();
  await page.mouse.move(800, 400);
  await expect(account).toHaveCSS("background-color", hoverColor);
  await page.screenshot({
    path: testInfo.outputPath("sidebar-account-corners.png"),
  });
  await page.keyboard.press("Escape");
  await close.click();
  await expect(trigger).toHaveAttribute("aria-pressed", "false");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  const modifier = await page.evaluate(() =>
    /Mac/i.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${modifier}+Backslash`);
  await expect(close).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press(`${modifier}+Backslash`);
  await expect(trigger).toHaveAttribute("aria-pressed", "false");
});

test.describe("Reading order", () => {
  test.use({ signedIn: false });

  test("keeps reading destinations in place until the sidebar reopens", async ({
    page,
    localBook,
  }) => {
    // Prepare a second valid EPUB through the importer. Distinct source bytes
    // preserve the database's unique source-file invariant.
    const entries = unzipSync(await readFile(SAMPLE_EPUB_PATH));
    const opf = Object.keys(entries).find((path) => path.endsWith(".opf"))!;
    entries[opf] = strToU8(
      strFromU8(entries[opf]).replaceAll(
        "Alice's Adventures in Wonderland",
        "Second local book",
      ),
    );
    // A populated Library accepts another EPUB through its drop target.
    const dataTransfer = await page.evaluateHandle(
      (bytes) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array(bytes)], "second.epub", {
            type: "application/epub+zip",
          }),
        );
        return transfer;
      },
      [...zipSync(entries)],
    );
    await page.locator("main").last().dispatchEvent("drop", { dataTransfer });
    await dataTransfer.dispose();
    await expect(
      page.getByRole("heading", { name: "Second local book", exact: true }),
    ).toBeVisible();
    const secondId = await page.evaluate(async () => {
      const dataPath = "/src/lib/db.ts";
      const data = await import(dataPath);
      const books = await data.getAllBooks();
      return books.find(
        (book: { title: string }) => book.title === "Second local book",
      ).id as string;
    });
    await page.evaluate(
      async ({ firstId, secondId }) => {
        const dataPath = "/src/lib/db.ts";
        const data = await import(dataPath);
        await data.setReadingStatus(firstId, "reading");
        await data.setReadingStatus(secondId, "reading");
        for (const [index, id] of [firstId, secondId].entries()) {
          await data.upsertCurrentDeviceReadingCheckpoint({
            bookId: id,
            currentSpineIndex: 0,
            scrollProgress: 0,
            lastRead: Date.now() - (index + 1) * 10 * 60_000,
          });
        }
      },
      { firstId: localBook.id, secondId },
    );
    await page
      .getByRole("button", { name: "Toggle sidebar", exact: true })
      .click();
    const panel = page.locator('[data-slot="sidebar-inner"]');
    const destinations = panel.getByRole("link", {
      name: /^Continue reading /,
    });
    const order = () =>
      destinations.evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")),
      );
    const originalOrder = [`/reader/${localBook.id}`, `/reader/${secondId}`];
    await expect.poll(order).toEqual(originalOrder);
    const first = panel.locator(`a[href="/reader/${localBook.id}"]`);
    const second = panel.getByRole("link", {
      name: "Continue reading Second local book",
      exact: true,
    });
    await expect(second).toContainText("20m");

    for (const [destination, id] of [
      [second, secondId],
      [first, localBook.id],
      [second, secondId],
    ] as const) {
      await destination.click();
      await expect(page).toHaveURL(`/reader/${id}`);
      await waitForReaderReady(page);
      await expect(destination).toHaveAttribute("aria-current", "page");
      await expect(destination).toContainText("now");
      await expect.poll(order).toEqual(originalOrder);
    }
    // Leaving the Reader flushes its checkpoint. The visible list still must not move.
    await panel.getByRole("link", { name: "Library", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect
      .poll(() =>
        page.evaluate(
          async ({ firstId, secondId }) => {
            const dataPath = "/src/lib/db.ts";
            const data = await import(dataPath);
            const reads = await data.getAllReadingCheckpointLastReads();
            return reads.get(secondId) > reads.get(firstId);
          },
          { firstId: localBook.id, secondId },
        ),
      )
      .toBe(true);
    await expect(second).toContainText("now");
    await expect.poll(order).toEqual(originalOrder);
    await panel
      .getByRole("button", { name: "Toggle sidebar", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Toggle sidebar", exact: true })
      .click();
    await expect.poll(order).toEqual([...originalOrder].reverse());
  });
});

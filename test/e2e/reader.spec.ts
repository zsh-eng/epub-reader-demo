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

  for (const { reducedMotion, bottomInset } of [
    { reducedMotion: "no-preference", bottomInset: 0 },
    { reducedMotion: "no-preference", bottomInset: 34 },
    { reducedMotion: "reduce", bottomInset: 34 },
  ] as const) {
    test(`peeks at page count only while dragging upwards (${reducedMotion}, ${bottomInset}px inset)`, async ({
      page,
      localBook,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: 0, right: 0, bottom: bottomInset, left: 0 },
      });
      await openLocalBook(page, localBook.id);
      const footer = page.locator("[data-reader-footer]");
      const peek = page.locator("[data-reader-progress-peek]");
      await expect(peek).toHaveCSS("visibility", "visible");
      await nextSpread(page);
      const tools = page.getByRole("button", {
        name: "Open reader tools",
        exact: true,
      });
      await expect(footer).not.toBeInViewport();
      const content = page
        .locator(
          '[data-reader-spread-layer="current"] [data-reader-page-content]',
        )
        .first();
      await expect(content).toBeInViewport();
      await expect(peek).not.toBeInViewport();
      const before = await currentPages(page);
      const peekIndicator = peek.getByTestId("reader-peek-page-indicator");
      await expect(peekIndicator).toContainText(`p. ${before[0]}`);
      const readPosition = () =>
        page.evaluate(async (bookId) => {
          const modulePath = "/src/lib/db.ts";
          const checkpoint = await (
            await import(modulePath)
          ).getCurrentDeviceReadingCheckpoint(bookId);
          return (
            checkpoint && [
              checkpoint.currentSpineIndex,
              checkpoint.scrollProgress,
            ]
          );
        }, localBook.id);
      await expect.poll(readPosition).toBeTruthy();
      const position = await readPosition();
      const x = 195;
      const y = 550;
      const start = () =>
        cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
      const move = (distance: number) =>
        cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - distance }],
        });
      const exposedHeight = () =>
        peek.evaluate(
          (element) => window.innerHeight - element.getBoundingClientRect().top,
        );
      await start();
      for (const distance of [12, 28, 18, 0, 22, 0, 30]) {
        await move(distance);
        await expect.poll(exposedHeight).toBeCloseTo(distance, 0);
        await expect(footer).not.toBeInViewport();
      }
      // Check several rendered frames while held partway, not just its final position.
      const heldPositions = await peek.evaluate(async (element) => {
        const positions: number[] = [];
        for (let frame = 0; frame < 8; frame++) {
          await new Promise(requestAnimationFrame);
          positions.push(element.getBoundingClientRect().top);
        }
        return positions;
      });
      expect(
        Math.max(...heldPositions) - Math.min(...heldPositions),
      ).toBeLessThan(0.5);
      await move(180);
      await expect(peek).toBeInViewport({ ratio: 1 });
      await expect(peekIndicator).toBeInViewport();
      await expect(peek.locator("canvas")).toBeInViewport();
      await expect(tools).not.toBeInViewport();
      await expect(footer).not.toBeInViewport();
      // Hold past the old release-gesture limit; this is intentional input timing.
      await page.waitForTimeout(800);
      await expect(content).toBeInViewport();
      await expect(peek).toHaveCSS(
        "padding-bottom",
        bottomInset > 0 ? "16px" : "4px",
      );
      await expect(peek.locator("canvas")).toHaveCSS("height", "56px");
      await expect
        .poll(() =>
          peekIndicator.evaluate(
            (element) =>
              window.innerHeight - element.getBoundingClientRect().bottom,
          ),
        )
        .toBeCloseTo(bottomInset > 0 ? 16 : 4, 0);
      const peekScrubberPixels = await peek
        .locator("canvas")
        .evaluate((canvas) => canvas.toDataURL());
      await page.screenshot({ path: testInfo.outputPath("progress-peek.png") });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(peek).not.toBeInViewport();
      await expect(tools).not.toBeInViewport();

      await start();
      await move(30);
      await expect.poll(exposedHeight).toBeCloseTo(30, 0);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchCancel",
        touchPoints: [],
      });
      await expect(peek).not.toBeInViewport();
      expect(await currentPages(page)).toEqual(before);
      expect(await readPosition()).toEqual(position);

      // A normal center tap still reveals the controls after peeking.
      await page.touchscreen.tap(x, y);
      await expect(tools).toBeInViewport();
      await expect(peek).not.toBeInViewport();
      await expect(page.getByTestId("reader-page-indicator")).toBeInViewport();
      await expect(footer.locator("canvas")).toHaveCSS("height", "56px");
      await expect
        .poll(() =>
          footer.locator("canvas").evaluate((canvas) => canvas.toDataURL()),
        )
        .toBe(peekScrubberPixels);
      const bottomPadding = await page.evaluate(() => {
        const peek = document.querySelector("[data-reader-progress-peek]")!;
        const footer = document.querySelector("[data-reader-footer]")!;
        return [
          getComputedStyle(peek).paddingBottom,
          getComputedStyle(footer).paddingBottom,
        ];
      });
      expect(bottomPadding).toEqual([
        bottomInset > 0 ? "16px" : "4px",
        bottomInset > 0 ? "34px" : "12px",
      ]);
      await cdp.detach();
    });
  }

  test("interrupts the progress peek return from its current position", async ({
    page,
    localBook,
  }) => {
    await page.clock.install();
    await openLocalBook(page, localBook.id);
    const peek = page.locator("[data-reader-progress-peek]");
    await expect(peek).toHaveCSS("visibility", "visible");
    await nextSpread(page);
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", y = 550) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }],
      });
    const exposedHeight = () =>
      peek.evaluate(
        (element) => window.innerHeight - element.getBoundingClientRect().top,
      );
    await touch("touchStart");
    await touch("touchMove", 520);
    await page.clock.runFor(32);
    expect(await exposedHeight()).toBeCloseTo(30, 0);
    await touch("touchEnd");
    await page.clock.runFor(64);
    const returningHeight = await exposedHeight();
    expect(returningHeight).toBeGreaterThan(0);
    expect(returningHeight).toBeLessThan(30);
    await touch("touchStart");
    await touch("touchMove", 538);
    await page.clock.runFor(32);
    const grabbedHeight = await exposedHeight();
    // The return can advance between the sampled frame and pointer dispatch.
    // Re-grabbing must retain that offset, then track further movement exactly.
    expect(grabbedHeight).toBeGreaterThan(12);
    expect(grabbedHeight).toBeLessThanOrEqual(returningHeight + 12);
    await touch("touchMove", 532);
    await page.clock.runFor(32);
    expect(await exposedHeight()).toBeCloseTo(grabbedHeight + 6, 0);
    await touch("touchEnd");
    await page.clock.runFor(200);
    expect(await exposedHeight()).toBeCloseTo(0, 0);
    await cdp.detach();
    await page.clock.resume();
  });

  test("dismisses chrome with a tap and swipes through visible chrome", async ({
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
    const scrubber = page.locator("canvas.cursor-ew-resize");
    await page.touchscreen.tap(
      bounds.x + bounds.width * 0.5,
      bounds.y + bounds.height * 0.5,
    );
    await expect(scrubber).toBeInViewport();
    await page.touchscreen.tap(
      bounds.x + bounds.width * 0.9,
      bounds.y + bounds.height * 0.5,
    );
    await expect(scrubber).not.toBeInViewport();
    expect(await currentPages(page)).toEqual(beforeSwipe);
    await page.touchscreen.tap(
      bounds.x + bounds.width * 0.5,
      bounds.y + bounds.height * 0.5,
    );
    await expect(scrubber).toBeInViewport();
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
    await expect(scrubber).not.toBeInViewport();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
    await expect.poll(() => currentPages(page)).not.toEqual(beforeSwipe);
    await waitForReaderReady(page);
  });
});

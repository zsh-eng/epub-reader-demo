import { test, expect } from "./helpers/fixtures";

test.use({
  viewport: { width: 1440, height: 1040 },
  isMobile: false,
  hasTouch: false,
});

test("keeps only the top chrome visible until each prompt is explicitly resolved", async ({
  page,
}) => {
  await page.goto("/debug/chrome-accessories");
  const preview = page.getByTestId("chrome-preview");
  const header = page.getByTestId("chrome-preview-header");
  const footer = page.getByTestId("chrome-preview-footer");
  const reading = preview.getByRole("region", { name: "Reading preview" });
  await expect(
    page.getByRole("heading", { name: "Chrome accessories", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await reading.hover();
  await reading.click();
  await expect(header).toHaveCSS("opacity", "1");
  await expect(footer).toHaveCSS("opacity", "0");
  await reading.press("Escape");
  await expect(
    preview.getByRole("button", { name: "Mark as reading", exact: true }),
  ).toBeVisible();
  const bookmark = await page
    .getByTestId("chrome-preview-bookmark")
    .boundingBox();
  await preview
    .getByRole("button", { name: "Dismiss reading status prompt", exact: true })
    .click();
  await reading.hover();
  await expect(header).toHaveCSS("opacity", "0");
  await expect(header).toHaveAttribute("inert", "");
  await expect(page.getByRole("status")).toContainText(
    "Book status is unchanged",
  );

  await page.getByRole("button", { name: "Both queued", exact: true }).click();
  await reading.hover();
  await expect(header).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("chrome-preview-bookmark")).toHaveJSProperty(
    "offsetWidth",
    36,
  );
  expect(
    await page.getByTestId("chrome-preview-bookmark").boundingBox(),
  ).toEqual(bookmark);
  await expect(
    preview.getByRole("button", { name: /Continue at p. 84/ }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Mark as reading", exact: true }),
  ).toHaveCount(0);
  await preview.getByRole("button", { name: /Continue at p. 84/ }).click();
  await reading.hover();
  await expect(page.getByTestId("chrome-preview-page")).toHaveText(
    "Preview page 84 / 240",
  );
  await expect(header).toHaveCSS("opacity", "1");
  await preview
    .getByRole("button", { name: "Mark as reading", exact: true })
    .click();
  await reading.hover();
  await expect(header).toHaveCSS("opacity", "0");
  await expect(page.getByRole("status")).toContainText(
    "Book marked as currently reading",
  );

  await page.getByRole("button", { name: "Sync handoff", exact: true }).click();
  await preview
    .getByRole("button", { name: "Dismiss sync prompt", exact: true })
    .click();
  await reading.hover();
  await expect(header).toHaveCSS("opacity", "0");
  await expect(page.getByTestId("chrome-preview-page")).toHaveText(
    "Preview page 42 / 240",
  );
  await page
    .getByRole("button", { name: "Replay prompt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reveal chrome", exact: true })
    .click();
  await expect(footer).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "Hide chrome", exact: true }).click();
  await expect(footer).toHaveCSS("opacity", "0");
  await expect(header).toHaveCSS("opacity", "1");
});

test("fits the prompt beside fixed toolbar icons at desktop widths and supports local appearance controls", async ({
  page,
}, testInfo) => {
  await page.goto("/debug/chrome-accessories");
  await page.getByRole("button", { name: "Sync handoff", exact: true }).click();
  await page
    .getByLabel("Book title", { exact: true })
    .fill(
      "A very long book title that should fit without overlapping either toolbar group",
    );
  await page
    .getByLabel("Source device", { exact: true })
    .fill("A particularly long MacBook Pro device name");
  await page.getByLabel("Sync target page", { exact: true }).fill("240");
  await page
    .getByRole("combobox", { name: "Preview width", exact: true })
    .selectOption("768");
  const accessory = page.getByTestId("chrome-accessory");
  const title = page.locator("[data-reader-header-title]");
  const bookmark = page.getByTestId("chrome-preview-bookmark");
  await expect(title).toHaveCSS("text-align", "left");
  for (const appearance of ["soft", "minimal", "outline"]) {
    await page
      .getByRole("combobox", { name: "Appearance", exact: true })
      .selectOption(appearance);
    const a = (await accessory.boundingBox())!;
    const t = (await title.boundingBox())!;
    const b = (await bookmark.boundingBox())!;
    expect(t.x + t.width).toBeLessThanOrEqual(a.x);
    expect(a.x + a.width).toBeLessThan(b.x);
    expect(a.y + a.height / 2).toBeCloseTo(b.y + b.height / 2, 1);
    expect(
      await accessory.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await accessory
        .locator("button span")
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
  }

  // This uses the preview container width, even on a wide browser window.
  for (const width of ["960", "1280", "768"]) {
    await page
      .getByRole("combobox", { name: "Preview width", exact: true })
      .selectOption(width);
    await expect(title).toHaveCSS(
      "text-align",
      width === "1280" ? "center" : "left",
    );
  }
  await expect(
    accessory.locator("[data-reader-jump-direction]"),
  ).toHaveAttribute("data-reader-jump-direction", "forward");
  await page.getByLabel("Sync target page", { exact: true }).fill("20");
  await expect(
    accessory.locator("[data-reader-jump-direction]"),
  ).toHaveAttribute("data-reader-jump-direction", "backward");
  await page.getByLabel("Sync target page", { exact: true }).fill("42");
  await expect(accessory.locator("[data-reader-jump-direction]")).toHaveCount(
    0,
  );
  await page.getByLabel("Sync target page", { exact: true }).fill("240");
  await page
    .getByRole("combobox", { name: "Preview theme", exact: true })
    .selectOption("night");
  await expect(page.getByTestId("chrome-preview")).toHaveClass(/night/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByTestId("chrome-preview-header")).toHaveCSS(
    "transition-property",
    "none",
  );
  await page.screenshot({
    path: testInfo.outputPath("compact-night-chrome.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Reading status", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Previous status", exact: true })
    .selectOption("dnf");
  const action = page.getByRole("button", {
    name: "Mark as reading",
    exact: true,
  });
  await action.focus();
  await action.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Dismiss reading status prompt",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(title).toHaveCSS("text-align", "center");
  await expect(page.getByRole("status")).toContainText(
    "Book status is unchanged",
  );
});

test("gates the playground behind the existing debug preference", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("reader-debug-enabled-v1", "false"),
  );
  await page.goto("/debug/chrome-accessories");
  await expect(
    page.getByRole("heading", { name: "Debug mode is off" }),
  ).toBeVisible();
  await expect(page.getByTestId("chrome-preview")).toHaveCount(0);
});

test("explains each status change with bold status names on hover and keyboard focus", async ({
  page,
}) => {
  await page.goto("/debug/chrome-accessories");
  const action = page.getByRole("button", {
    name: "Mark as reading",
    exact: true,
  });
  const tooltip = page.getByRole("tooltip");
  for (const [value, expected, statuses] of [
    ["none", "Set this book’s status to Reading", ["Reading"]],
    [
      "want-to-read",
      "Change from Want to read to Reading",
      ["Want to read", "Reading"],
    ],
    [
      "dnf",
      "Change from Did not finish to Reading",
      ["Did not finish", "Reading"],
    ],
  ] as const) {
    const statusSelect = page.getByRole("combobox", {
      name: "Previous status",
      exact: true,
    });
    // Move off the action before reopening a tooltip dismissed with Escape.
    await statusSelect.hover();
    await statusSelect.selectOption(value);
    await action.hover();
    await expect(tooltip).toHaveText(expected);
    await expect(tooltip.locator("strong")).toHaveText([...statuses]);
    for (const name of statuses)
      await expect(tooltip.getByText(name, { exact: true })).toHaveCSS(
        "font-weight",
        "700",
      );
    await action.press("Escape");
    await expect(tooltip).toBeHidden();
  }
  await page
    .getByRole("combobox", { name: "Previous status", exact: true })
    .focus();
  await action.focus();
  await expect(tooltip).toHaveText("Change from Did not finish to Reading");
  await action.press("Enter");
  await expect(tooltip).toBeHidden();
  await expect(page.getByRole("status")).toContainText(
    "Book marked as currently reading",
  );
  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Changed Did Not Finish to Reading." });
  await expect(toast).toBeVisible();
  await expect(toast.locator("strong")).toHaveText([
    "Did Not Finish",
    "Reading",
  ]);
  await page.setViewportSize({ width: 360, height: 844 });
  const message = toast.locator("[data-title]");
  expect(
    await message.evaluate(
      (node) =>
        node.getBoundingClientRect().height <=
          parseFloat(getComputedStyle(node).lineHeight) + 1 &&
        node.scrollWidth <= node.clientWidth,
    ),
  ).toBe(true);
});

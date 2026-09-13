import { expect, test } from "./helpers/fixtures";

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

  const brand = panel.getByRole("link", { name: "Reader", exact: true });
  await brand.hover();
  await expect(brand).toHaveCSS("border-top-left-radius", "15px");
  const account = panel.getByRole("button", {
    name: /Test Reader.*reader@example.test/,
  });
  await expect(account).toBeVisible();
  const corners = await panel.evaluate((outer) => {
    const brand = outer.querySelector('a[title="Go to library"]')!;
    const account = outer.querySelector(
      '[data-slot="sidebar-footer"] button[aria-haspopup="menu"]',
    )!;
    const panelBounds = outer.getBoundingClientRect();
    const brandBounds = brand.getBoundingClientRect();
    const accountBounds = account.getBoundingClientRect();
    const panelStyle = getComputedStyle(outer);
    const brandStyle = getComputedStyle(brand);
    const accountStyle = getComputedStyle(account);
    return {
      brandRadius: parseFloat(brandStyle.borderTopLeftRadius),
      brandInnerRadius: parseFloat(brandStyle.borderBottomLeftRadius),
      accountRadius: parseFloat(accountStyle.borderBottomLeftRadius),
      accountInnerRadius: parseFloat(accountStyle.borderTopLeftRadius),
      outerRadius: parseFloat(panelStyle.borderTopLeftRadius),
      brandGapX: brandBounds.left - panelBounds.left,
      brandGapY: brandBounds.top - panelBounds.top,
      accountGapX: accountBounds.left - panelBounds.left,
      accountGapY: panelBounds.bottom - accountBounds.bottom,
    };
  });
  expect(corners.brandRadius).toBeLessThan(corners.outerRadius);
  expect(corners.brandInnerRadius).toBeLessThan(corners.brandRadius);
  expect(corners.accountInnerRadius).toBeLessThan(corners.accountRadius);
  expect(corners.brandGapX + corners.brandRadius).toBeCloseTo(
    corners.outerRadius,
    1,
  );
  expect(corners.brandGapY + corners.brandRadius).toBeCloseTo(
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
    path: testInfo.outputPath("sidebar-brand-corner.png"),
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

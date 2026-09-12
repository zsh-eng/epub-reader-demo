import { test, expect, openLocalBook } from "./helpers/fixtures";

// Keep reviewable reference images of the web design next to native simulator
// captures. Use the real local-book fixture and the same logical reading viewport.
test.use({
  viewport: { width: 402, height: 778 },
  isMobile: true,
  hasTouch: true,
});

test("web design reference for the Swift controls", async ({
  page,
  localBook,
}, info) => {
  await page.addInitScript(() => {
    const current = JSON.parse(
      localStorage.getItem("epub-reader-settings") ?? "{}",
    );
    localStorage.setItem(
      "epub-reader-settings",
      JSON.stringify({ ...current, theme: "flexoki-light" }),
    );
    localStorage.setItem("epub-reader-appearance", "light");
  });
  const capture = async (name: string) => {
    await page.screenshot({
      path: info.outputPath(`${name}.png`),
      animations: "disabled",
    });
  };
  await page.goto("/");
  await expect(
    page.getByRole("searchbox", { name: "Search library" }),
  ).toBeVisible();
  await capture("library");
  await openLocalBook(page, localBook.id);
  const tools = page.getByRole("button", {
    name: "Open reader tools",
    exact: true,
  });
  await page.touchscreen.tap(201, 389);
  await expect(tools).toBeInViewport();
  await expect(tools).toBeVisible();
  await capture("reader");
  await tools.click();
  await expect(
    page.getByRole("button", { name: /Themes & Settings$/ }),
  ).toBeVisible();
  await capture("tools");
  await page.getByRole("button", { name: /Themes & Settings$/ }).click();
  await expect(
    page.getByRole("button", { name: "Lora", exact: true }),
  ).toBeVisible();
  await capture("type");
  await page.getByRole("tab", { name: "Layout", exact: true }).click();
  await capture("layout");
  await page.getByRole("tab", { name: "Theme", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Flexoki Light", exact: true }),
  ).toBeVisible();
  await capture("theme");
});

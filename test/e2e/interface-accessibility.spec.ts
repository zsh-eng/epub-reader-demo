import { test, expect, openLocalBook } from "./helpers/fixtures";

test("library supports skip navigation and keyboard book opening", async ({ page, localBook }) => {
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name:"Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const book = page.getByRole("link", { name:/Open Alice/ });
  await book.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/reader/${localBook.id}`));
});

test("reading progress supports native keyboard navigation", async ({ page, localBook }) => {
  await openLocalBook(page, localBook.id);
  await page.locator('[data-reader-header="desktop"]').hover();
  const progress = page.getByRole("slider", { name:"Reading page" });
  await expect(progress).toBeAttached();
  await progress.focus();
  const before = Number(await progress.inputValue());
  await page.keyboard.press("ArrowRight");
  await expect(progress).toHaveValue(String(before + Number(await progress.getAttribute("step"))));
});

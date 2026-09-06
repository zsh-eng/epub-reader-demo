import { expect, test } from "./helpers/fixtures";

test("renders highlight cards after a cold query resolves", async ({
  page,
  localBook,
}) => {
  await page.evaluate(async (bookId) => {
    const path = "/src/lib/db.ts";
    await (
      await import(path)
    ).addHighlight({
      id: "cold-card",
      bookId,
      spineItemId: "chapter",
      startOffset: 0,
      endOffset: 16,
      selectedText: "Cold query card.",
      textBefore: "",
      textAfter: "",
      color: "yellow",
      createdAt: Date.now(),
    });
  }, localBook.id);
  await page.goto("/highlights");
  await expect(
    page.getByText("Cold query card.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy highlight to clipboard" }),
  ).toBeVisible();
});

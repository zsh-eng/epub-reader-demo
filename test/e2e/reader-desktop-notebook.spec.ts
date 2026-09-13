import { test, expect, openLocalBook } from "./helpers/fixtures";

test.use({
  viewport: { width: 1280, height: 900 },
  isMobile: false,
  hasTouch: false,
});

test("desktop composer keeps the send button outside single and multiline fields", async ({
  page,
  localBook,
}, testInfo) => {
  await openLocalBook(page, localBook.id);
  await page.mouse.move(200, 10);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("complementary", {
    name: "Reader tools",
    exact: true,
  });
  await tools.getByRole("button", { name: "Notes", exact: true }).click();
  const panel = tools.getByRole("region", { name: "Book notebook" });
  await expect(panel).toHaveCSS("transform", "none");
  await expect(panel).toHaveCSS("opacity", "1");
  expect(await panel.evaluate((node) => node.getAnimations().length)).toBe(0);
  const input = tools.getByRole("textbox", {
    name: "Write a note",
    exact: true,
  });
  const field = tools.locator("[data-note-input-surface]");
  const send = tools.locator('button[aria-label="Save note"]');
  await expect(input).toBeFocused();
  const emptyBounds = (await field.boundingBox())!;
  await expect(send).toHaveCSS("opacity", "0");
  await input.fill("A thought");
  await expect(send).toHaveCSS("opacity", "1");
  const oneLine = (await field.boundingBox())!;
  const sendBounds = (await send.boundingBox())!;
  expect(emptyBounds.width - oneLine.width).toBeCloseTo(40, 0);
  expect(sendBounds.x - oneLine.x - oneLine.width).toBeCloseTo(8, 0);
  expect(await field.locator('button[aria-label="Save note"]').count()).toBe(0);
  await input.fill("First line\nSecond line\nThird line\nFourth line");
  const multiline = (await field.boundingBox())!;
  expect(multiline.width).toBe(oneLine.width);
  expect(multiline.height).toBeGreaterThan(oneLine.height + 40);
  const textarea = (await input.boundingBox())!;
  expect(
    multiline.x + multiline.width - textarea.x - textarea.width,
  ).toBeLessThan(20);
  const multilineSend = (await send.boundingBox())!;
  expect(multilineSend.x).toBe(sendBounds.x);
  expect(
    multiline.y + multiline.height - multilineSend.y - multilineSend.height,
  ).toBeCloseTo(5, 0);
  await page.screenshot({
    path: testInfo.outputPath("desktop-multiline-composer.png"),
  });
  await input.fill("");
  await expect(send).toHaveCSS("opacity", "0");
  expect((await field.boundingBox())!.width).toBe(emptyBounds.width);
  await tools.getByRole("button", { name: "Contents", exact: true }).click();
  await tools.getByRole("button", { name: "Notes", exact: true }).click();
  expect(await panel.evaluate((node) => node.getAnimations().length)).toBe(0);
});

test("desktop notes edit in place with stable rows and keep compose and edit drafts separate", async ({
  page,
  localBook,
}, testInfo) => {
  await openLocalBook(page, localBook.id);
  await page.mouse.move(200, 10);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("complementary", {
    name: "Reader tools",
    exact: true,
  });
  await tools.getByRole("button", { name: "Notes", exact: true }).click();
  const compose = tools.getByRole("textbox", {
    name: "Write a note",
    exact: true,
  });
  const original =
    "A thought about the first passage.\nA second line to keep nearby.\nA third line for context.";
  await compose.fill(original);
  await tools.getByRole("button", { name: "Save note", exact: true }).click();
  await compose.fill("Another thought.");
  await tools.getByRole("button", { name: "Save note", exact: true }).click();
  const rows = tools.locator("[data-note-id]");
  await expect(rows).toHaveCount(2);
  await compose.fill("An unsent thought.");
  const before = await rows.evaluateAll((nodes) =>
    nodes.map((node) => ({
      y: node.getBoundingClientRect().y,
      height: node.getBoundingClientRect().height,
    })),
  );
  const first = rows.nth(0);
  const second = rows.nth(1);
  const id = await first.getAttribute("data-note-id");
  const readSaved = () =>
    page.evaluate(async (id) => {
      const modulePath = "/src/lib/sync-v2/db.ts";
      const { syncV2Db } = await import(modulePath);
      return syncV2Db.notes.get(id);
    }, id);
  const savedBefore = await readSaved();
  await first.locator("p").dblclick();
  const editor = first.getByRole("textbox", { name: "Edit note", exact: true });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(original);
  await expect(tools.locator("[data-note-input-surface] textarea")).toHaveValue(
    "An unsent thought.",
  );
  expect(
    await rows.evaluateAll((nodes) =>
      nodes.map((node) => ({
        y: node.getBoundingClientRect().y,
        height: node.getBoundingClientRect().height,
      })),
    ),
  ).toEqual(before);
  await expect(second.locator('[data-slot="context-menu-trigger"]')).toHaveCSS(
    "opacity",
    "0.45",
  );
  const revised =
    "Revised first line.\nRevised second line.\nRevised third line.\nExtra line scrolling inside the note.";
  await editor.fill(revised);
  expect(
    await rows.evaluateAll((nodes) =>
      nodes.map((node) => ({
        y: node.getBoundingClientRect().y,
        height: node.getBoundingClientRect().height,
      })),
    ),
  ).toEqual(before);
  await page.screenshot({
    path: testInfo.outputPath("desktop-inline-edit.png"),
  });
  const modifier = await page.evaluate(() =>
    /Mac/i.test(navigator.platform) ? "Meta" : "Control",
  );
  await editor.press(`${modifier}+Enter`);
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await readSaved()).content).toBe(revised);
  expect((await readSaved()).anchor).toEqual(savedBefore.anchor);
  expect((await readSaved()).createdAt).toEqual(savedBefore.createdAt);
  await expect(compose).toHaveValue("An unsent thought.");

  await first.locator("article").click({ button: "right" });
  const menu = page.getByRole("menu");
  const editItem = menu.getByRole("menuitem", {
    name: "Edit note",
    exact: true,
  });
  await editItem.hover();
  await expect(editItem).toHaveAttribute("data-highlighted", "");
  expect(
    await editItem.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");
  const menuRadius = await menu.evaluate((node) =>
    parseFloat(getComputedStyle(node).borderTopLeftRadius),
  );
  const itemRadius = await editItem.evaluate((node) =>
    parseFloat(getComputedStyle(node).borderTopLeftRadius),
  );
  expect(menuRadius - itemRadius).toBeCloseTo(5, 0);
  await page.screenshot({ path: testInfo.outputPath("desktop-note-menu.png") });
  await editItem.click();
  await expect(editor).toBeFocused();
  await editor.fill("Keep this unfinished edit.");
  await tools.getByRole("button", { name: "Contents", exact: true }).click();
  await tools.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(compose).toHaveValue("An unsent thought.");
  await expect(editor).toHaveCount(0);
  await first.locator("p").dblclick();
  await expect(editor).toHaveValue("Keep this unfinished edit.");
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  expect((await readSaved()).content).toBe(revised);
  await expect(compose).toHaveValue("An unsent thought.");
  await first.locator("article").click({ button: "right" });
  const deleteItem = page.getByRole("menuitem", {
    name: "Delete note",
    exact: true,
  });
  await deleteItem.hover();
  await expect(deleteItem).toHaveAttribute("data-highlighted", "");
  expect(
    await deleteItem.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");
  await deleteItem.click();
  await expect(rows).toHaveCount(1);
  expect((await readSaved()).isDeleted).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(rows).toHaveCount(2);
  expect((await readSaved()).isDeleted).toBe(false);
});

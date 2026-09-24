import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const episode = JSON.parse(
  await readFile(new URL("../.local/episode.json", import.meta.url), "utf8"),
);
test("real episode: seek, follow, bounded transcript, skip and Undo", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#title")).toHaveText(episode.title);
  await expect
    .poll(() => page.locator(".transcript-row").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.locator(".transcript-row").count())
    .toBeLessThan(25);
  await page.locator(".chapter").nth(2).click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeCloseTo(episode.chapters[2].start, 0);
  await page.locator("#transcript").hover();
  await page.mouse.wheel(0, 2200);
  await expect(page.locator("#follow")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect
    .poll(() => page.locator(".transcript-row").count())
    .toBeLessThan(25);
  await page.getByRole("button", { name: "Follow along", exact: true }).click();
  await expect(page.locator("#follow")).toHaveAttribute("aria-pressed", "true");
  const skip = episode.skips[0];
  await page.locator("audio").evaluate((el: HTMLAudioElement) => {
    el.muted = true;
  });
  await page.locator("#seek").evaluate((el: HTMLInputElement, time: number) => {
    el.value = String(time);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, skip.start - 0.15);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#toast")).toBeVisible();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThanOrEqual(skip.end);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#toast")).toBeHidden();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeLessThan(skip.start + 4);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const time = await page
    .locator("audio")
    .evaluate((el: HTMLAudioElement) => el.currentTime);
  await page.reload();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeCloseTo(time, 0);
  await page.screenshot({ path: ".local/player-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: ".local/player-dark.png",
    animations: "disabled",
  });
});
test("phone and reduced motion retain readable rows and keyboard controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#title")).toHaveText(episode.title);
  await page
    .locator("audio")
    .evaluate((el: HTMLAudioElement) => (el.muted = true));
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Promotions", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Skip promotions" }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "Skip promotions" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator("#mobile-skips")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.screenshot({ path: ".local/player-phone.png" });
});

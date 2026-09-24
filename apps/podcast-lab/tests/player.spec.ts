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

test("speaker paragraphs highlight and seek by section without overlapping rows", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const row = episode.rows.find(
    (row: { start: number; parts: unknown[] }) =>
      row.start > 500 && row.parts.length >= 3,
  );
  const section = row.parts[1];
  await page.locator("#seek").evaluate(
    (el: HTMLInputElement, time: number) => {
      el.value = String(time);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    (section.start + section.end) / 2,
  );
  await expect(page.locator(".sentence.current")).toHaveText(section.text);
  await expect(page.locator(".transcript-row.active")).toContainText(
    row.parts[0].text,
  );
  await page.locator("audio").evaluate((el: HTMLAudioElement) => {
    el.muted = true;
  });
  await page.locator(".transcript-row.active .sentence").nth(2).click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThanOrEqual(row.parts[2].start);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".sentence.current")).toHaveText(row.parts[2].text);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        page.locator(".transcript-row").evaluateAll((nodes) => {
          const rects = nodes.map((node) => node.getBoundingClientRect());
          return rects.every(
            (rect, i) => i === 0 || rect.top >= rects[i - 1].bottom - 1,
          );
        }),
      )
      .toBe(true);
    await page.screenshot({ path: `.local/paragraphs-${width}.png` });
  }
  await page.locator("#transcript").hover();
  await page.mouse.wheel(0, 3000);
  await expect(page.locator("#follow")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.mouse.wheel(0, -2000);
  await expect
    .poll(() =>
      page
        .locator(".transcript-row")
        .evaluateAll((nodes) =>
          nodes.every(
            (node, i) =>
              i === 0 ||
              Number((node as HTMLElement).dataset.index) >
                Number((nodes[i - 1] as HTMLElement).dataset.index),
          ),
        ),
    )
    .toBe(true);
  await expect
    .poll(() => page.locator(".transcript-row").count())
    .toBeLessThan(25);
});

test("1.25x skips when scrubbing into a promotion and when replaying it later", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#title")).toHaveText(episode.title);
  await page.locator("audio").evaluate((el: HTMLAudioElement) => {
    el.muted = true;
  });
  await page.locator("#speed").click();
  await expect(page.locator("#speed")).toHaveText("1.25×");
  const skip = episode.skips[0];
  await page.locator("#seek").evaluate((el: HTMLInputElement, time: number) => {
    el.value = String(time);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, skip.start + 2);
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
  await page.locator("#seek").evaluate((el: HTMLInputElement, time: number) => {
    el.value = String(time);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, skip.start - 0.5);
  await expect(page.locator("#toast")).toBeVisible();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThanOrEqual(skip.end);
});

test("restored 1.25x playback still skips; explicit preview lasts only one pass", async ({
  page,
}) => {
  const skip = episode.skips[1];
  await page.addInitScript(
    ({ hash, time }) => {
      localStorage.setItem(
        `undertone:${hash}`,
        JSON.stringify({ time, rate: 1.25, skip: true }),
      );
    },
    { hash: episode.audioHash, time: skip.start + 1 },
  );
  await page.goto("/");
  await expect(page.locator("#speed")).toHaveText("1.25×");
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeCloseTo(skip.start + 1, 0);
  await page.locator("audio").evaluate((el: HTMLAudioElement) => {
    el.muted = true;
  });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#toast")).toBeVisible();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThanOrEqual(skip.end);

  await page.locator(".detection").nth(1).click();
  await expect(page.locator("#toast")).toBeHidden();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeLessThan(skip.start + 4);
  // Advance this explicit preview to its end without another player command.
  // The following replay must no longer inherit the old preview exception.
  await page.locator("audio").evaluate((el: HTMLAudioElement, time) => {
    el.currentTime = time;
  }, skip.end - 0.1);
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThanOrEqual(skip.end + 0.1);
  await page.locator("audio").evaluate((el: HTMLAudioElement, time) => {
    el.currentTime = time;
  }, skip.start + 1);
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThanOrEqual(skip.end);

  await page.getByRole("switch", { name: "Skip promotions" }).uncheck();
  await page.locator("#seek").evaluate((el: HTMLInputElement, time: number) => {
    el.value = String(time);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, skip.start + 1);
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeLessThan(skip.start + 4);
  await page.getByRole("switch", { name: "Skip promotions" }).check();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThanOrEqual(skip.end);
});

import { test, expect } from "@playwright/test";

test("artwork handoff cleans up on rapid navigation without replacing audio", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#home");
  await expect(page.locator("#title")).toContainText("China");
  await page.locator("audio").evaluate(async (audio: HTMLAudioElement) => {
    audio.dataset.retained = "yes";
    audio.muted = true;
    audio.currentTime = 300;
    await audio.play();
  });
  await page.locator(".show-card-link").first().click();
  const ghost = page.locator(".travelling-cover");
  await expect(ghost).toHaveCount(1);
  await ghost.evaluate((image) => {
    for (const animation of image.getAnimations()) {
      animation.pause();
      animation.currentTime = 120;
    }
  });
  await page.screenshot({ path: ".local/motion-cover-midpoint.png" });
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(ghost).toHaveCount(0);
  await expect(page.locator("audio")).toHaveCount(1);
  await expect(page.locator("audio")).toHaveAttribute("data-retained", "yes");
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate(
          (audio: HTMLAudioElement) => !audio.paused && audio.currentTime > 300,
        ),
    )
    .toBe(true);
  await page.getByRole("link", { name: "All shows", exact: true }).click();
  await page.locator(".show-card-link").nth(2).click();
  await expect(page.locator(".show-hero")).toBeVisible();
  await expect(ghost).toHaveCount(0);
  await expect(page.locator(".show-hero img")).toHaveCSS("opacity", "1");
  expect(errors).toEqual([]);
});

test("keyboard and reduced motion never create travelling artwork", async ({
  page,
}) => {
  await page.goto("/#home");
  const first = page.locator(".show-card-link").first();
  await first.focus();
  await first.press("Enter");
  await expect(page.locator(".show-hero")).toBeVisible();
  await expect(page.locator(".travelling-cover")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.locator(".show-card-link").first().click();
  await expect(page.locator(".show-hero")).toBeVisible();
  await expect(page.locator(".travelling-cover")).toHaveCount(0);
  await expect(page.locator("#library-content")).toHaveCSS("transform", "none");
});

test("stream surface uses buffered audio and a recoverable error, without fake waveform", async ({
  page,
}) => {
  const response = await page.request.get("/library.json");
  const catalog = await response.json();
  const episode = catalog.episodes.find(
    (entry: { preparedId: string | null }) => !entry.preparedId,
  );
  let failing = true;
  // Real HTMLMediaElement decoding through a controlled local MP3 transport.
  // Only the publisher network boundary is replaced; no audio properties are faked.
  await page.route(episode.audioURL, async (route) => {
    if (failing) return route.abort();
    // A small real MP3 prefix is enough to verify decoding and retry. Do not
    // buffer the whole hour-long recording through Playwright's route process.
    const local = await route.fetch({
      url: "http://127.0.0.1:4379/audio",
      headers: { Range: "bytes=0-65535" },
    });
    await route.fulfill({
      status: 200,
      contentType: "audio/mpeg",
      body: await local.body(),
    });
  });
  await page.goto(`/#listen/${episode.id}`);
  await expect(page.locator(".listening-cover")).toBeVisible();
  await expect(page.locator("#error")).toBeVisible();
  await expect(page.locator("#waveform i")).toHaveCount(0);
  await expect(page.locator("#stream-track")).toBeVisible();
  failing = false;
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.muted = true;
  });
  await page.locator("#play").click();
  await expect(page.locator("#error")).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.5);
  await expect(page.locator("#buffered-ranges i").first()).toBeAttached();
  await expect(page.locator("#play")).toHaveAttribute("data-playing", "true");
  await expect(page.locator("#play")).toHaveAttribute("aria-busy", "false");
  await page.locator("#play").click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/stream-phone-dark.png" });
});

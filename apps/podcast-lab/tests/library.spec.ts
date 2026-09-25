import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const library = JSON.parse(
  await readFile(new URL("../.local/library.json", import.meta.url), "utf8"),
);
const localEpisodes = library.episodes.filter(
  (e: { preparedId: string }) => e.preparedId,
);

test("home, creator search, show following and downloaded episodes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good listening." }),
  ).toBeVisible();
  await expect(page.locator(".show-card")).toHaveCount(4);
  await expect(page.locator(".episode-row")).toHaveCount(20);
  await page
    .getByRole("button", { name: "Follow Darknet Diaries", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Library", exact: true })
    .getByRole("link", { name: "Following", exact: true })
    .click();
  await expect(page.locator(".episode-row")).toHaveCount(20);
  await expect(
    page.locator(".episode-row .episode-meta").first(),
  ).toContainText("Darknet Diaries");
  await page.reload();
  await expect(
    page.locator(".episode-row .episode-meta").first(),
  ).toContainText("Darknet Diaries");
  await page
    .getByRole("navigation", { name: "Library", exact: true })
    .getByRole("link", { name: "Darknet Diaries" })
    .click();
  await expect(page.locator(".show-hero")).toBeVisible();
  await expect(page.getByRole("link", { name: "RSS feed" })).toHaveAttribute(
    "href",
    /darknetdiaries/,
  );
  await page
    .getByRole("button", { name: "Unfollow Darknet Diaries", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Library", exact: true })
    .getByRole("link", { name: "Following", exact: true })
    .click();
  await expect(page.locator(".library-empty")).toBeVisible();
  await page.getByRole("link", { name: "Downloads", exact: true }).click();
  await expect(page.locator(".episode-row")).toHaveCount(4);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("searchbox").fill("Ubiquiti");
  await expect(page.locator(".episode-row")).toHaveCount(1);
  await expect(page.locator(".episode-title")).toContainText("Ubiquiti");
  await page.getByRole("searchbox").fill("zzzz-unmatched");
  await expect(page.locator(".library-empty")).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: "Next →", exact: true }).click();
  await expect(page.locator(".feed-pagination")).toContainText("2 / 20");
  await expect(page.locator(".episode-row")).toHaveCount(20);
});

test("browsing keeps audio alive; switching restores each episode position", async ({
  page,
}) => {
  await page.goto("/#player");
  await expect(page.locator("#title")).toContainText("China");
  await page.locator("audio").evaluate(async (audio: HTMLAudioElement) => {
    audio.muted = true;
    audio.currentTime = 300;
    await audio.play();
  });
  await page.getByRole("link", { name: "Undertone home" }).click();
  await expect(page.locator("#library-shell")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate(
          (audio: HTMLAudioElement) =>
            !audio.paused && audio.currentTime >= 300,
        ),
    )
    .toBe(true);
  await page.getByRole("link", { name: "Downloads", exact: true }).click();
  const decoder = localEpisodes.find(
    (e: { preparedId: string }) => e.preparedId === "decoder",
  );
  await page.getByRole("link", { name: decoder.title, exact: true }).click();
  await expect(page.locator("#title")).toHaveText(decoder.title);
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 200;
  });
  await page.getByRole("link", { name: "Undertone home" }).click();
  await page.getByRole("link", { name: "Downloads", exact: true }).click();
  const ezra = localEpisodes.find(
    (e: { preparedId: string }) => e.preparedId === "ezra",
  );
  await page.getByRole("link", { name: ezra.title, exact: true }).click();
  await expect(page.locator("#title")).toHaveText(ezra.title);
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThanOrEqual(300);
  await expect
    .poll(() => page.locator(".transcript-row").count())
    .toBeLessThan(25);
});

test("latest selection wins while an older episode request is delayed", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/episodes/decoder/episode.json", async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto("/#player");
  await expect(page.locator("#title")).toContainText("China");
  const decoder = localEpisodes.find(
    (e: { preparedId: string }) => e.preparedId === "decoder",
  );
  const darknet = localEpisodes.find(
    (e: { preparedId: string }) => e.preparedId === "darknet",
  );
  await page.evaluate((id) => {
    location.hash = `listen/${id}`;
  }, decoder.id);
  await page.evaluate((id) => {
    location.hash = `listen/${id}`;
  }, darknet.id);
  await expect(page.locator("#title")).toHaveText(darknet.title);
  release();
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    "/episodes/darknet/audio",
  );
  await page.getByRole("link", { name: "Undertone home" }).click();
  await expect(page.locator(".continue-copy h2")).toHaveText(darknet.title);
});

test("unprepared RSS episodes stream without borrowed transcript or skips", async ({
  page,
}) => {
  const online = library.episodes.find(
    (e: { preparedId: string | null }) => !e.preparedId,
  );
  // Control the external audio boundary; never hit a publisher during tests.
  await page.route(online.audioURL, (route) => route.abort());
  await page.goto(`/#listen/${online.id}`);
  await expect(page.locator("#title")).toHaveText(online.title);
  await expect(page.locator(".transcript-empty")).toBeVisible();
  await expect(page.locator(".transcript-row")).toHaveCount(0);
  await expect(page.locator(".detection")).toHaveCount(0);
  await expect(page.locator("audio")).toHaveAttribute("src", online.audioURL);
});

for (const width of [1440, 390])
  test(`library layout at ${width}px in both themes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.locator(".show-card")).toHaveCount(4);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect
        .poll(() =>
          page
            .locator(".show-cover")
            .evaluateAll((images) =>
              images.every((image) => (image as HTMLImageElement).complete),
            ),
        )
        .toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.local/library-${width}-${colorScheme}.png`,
      });
    }
  });

test("feed Play starts the selected local episode and keeps its identity on reload", async ({
  page,
}) => {
  await page.goto("/#downloads");
  await expect(page.locator("#title")).toContainText("China");
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.muted = true;
  });
  const decoder = localEpisodes.find(
    (e: { preparedId: string }) => e.preparedId === "decoder",
  );
  await page
    .getByRole("button", { name: `Play ${decoder.title}`, exact: true })
    .click();
  await expect(page.locator("#title")).toHaveText(decoder.title);
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused),
    )
    .toBe(false);
  await page.getByRole("link", { name: "Undertone home" }).click();
  await page.reload();
  await expect(page.locator(".continue-copy h2")).toHaveText(decoder.title);
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    "/episodes/decoder/audio",
  );
});

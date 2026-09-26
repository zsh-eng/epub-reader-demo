import { test, expect, type Page } from "@playwright/test";

async function preparationFixture(page: Page) {
  const library = await (await page.request.get("/library.json")).json();
  const episode = library.episodes.find(
    (e: { preparedId: string | null }) => !e.preparedId,
  );
  const payload = await (await page.request.get("/episode.json")).json();
  payload.title = episode.title;
  payload.audioHash = "preparation-test-exact-audio";
  let phase = "transcribing",
    downloadedBytes = 5_000_000,
    totalBytes: number | null = 10_000_000,
    starts = 0;
  await page.route("**/api/preparations", (route) =>
    route.fulfill({ json: phase === "ready" ? [episode.id] : [] }),
  );
  await page.route(`**/api/preparations/${episode.id}`, (route) => {
    if (route.request().method() === "POST") starts++;
    return route.fulfill({
      json: {
        id: episode.id,
        phase,
        downloadedBytes,
        totalBytes,
        detail:
          phase === "failed"
            ? "Preparation was interrupted. Retry to continue."
            : "Transcribing on your Mac",
      },
    });
  });
  // Only the publisher and worker boundaries are replaced. Playback, version
  // handoff, checkpoint persistence and the transcript use production code.
  await page.route(episode.audioURL, (route) =>
    route.fulfill({
      status: 302,
      headers: { Location: "http://127.0.0.1:4379/audio" },
    }),
  );
  await page.route(`**/episodes/${episode.id}/audio`, (route) =>
    route.fulfill({
      status: 302,
      headers: { Location: "http://127.0.0.1:4379/audio" },
    }),
  );
  await page.route(`**/episodes/${episode.id}/episode.json`, (route) =>
    route.fulfill({ json: payload }),
  );
  return {
    episode,
    setPhase: (next: string) => {
      phase = next;
    },
    setTransfer: (bytes: number, total: number | null) => {
      downloadedBytes = bytes;
      totalBytes = total;
    },
    starts: () => starts,
  };
}

test("stream plays during preparation; ready transcript switches to analyzed bytes and retains playback", async ({
  page,
}) => {
  const fixture = await preparationFixture(page);
  await page.goto(`/#listen/${fixture.episode.id}`);
  await expect(page.locator("#preparation-status")).toContainText(
    "Transcribing on your Mac",
  );
  await expect(page.locator("#now-chapter")).toHaveText(fixture.episode.title);
  await page.screenshot({ path: ".local/preparation-progress.png" });
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.muted = true;
    audio.dataset.retained = "yes";
  });
  await page.locator("#play").click();
  await page.locator("#speed").click();
  await page.locator("#seek").evaluate((input: HTMLInputElement) => {
    input.value = "300";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThan(300);
  await page.getByRole("link", { name: "Undertone home" }).click();
  fixture.setPhase("ready");
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    `/episodes/${fixture.episode.id}/audio`,
  );
  await expect(page.locator("audio")).toHaveAttribute("data-retained", "yes");
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate(
          (a: HTMLAudioElement) =>
            !a.paused && a.currentTime > 300 && a.playbackRate === 1.25,
        ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Open current episode" }).click();
  await expect(page.locator(".transcript-row").first()).toBeVisible();
  await expect(page.locator("#skip-toggle")).toBeEnabled();
  expect(fixture.starts()).toBe(1);
  await page.locator("#play").click();
  await page.reload();
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    `/episodes/${fixture.episode.id}/audio`,
  );
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((a: HTMLAudioElement) => a.paused && a.currentTime > 300),
    )
    .toBe(true);
  expect(fixture.starts()).toBe(1);
});

test("failed preparation can retry without replacing the current stream; another selection wins", async ({
  page,
}) => {
  const fixture = await preparationFixture(page);
  fixture.setPhase("failed");
  await page.goto(`/#listen/${fixture.episode.id}`);
  await expect(
    page.getByRole("button", { name: "Retry preparation" }),
  ).toBeVisible();
  fixture.setPhase("transcribing");
  await page.getByRole("button", { name: "Retry preparation" }).click();
  await expect(page.locator("#preparation-status")).toContainText(
    "Transcribing on your Mac",
  );
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    fixture.episode.audioURL,
  );
  expect(fixture.starts()).toBe(2);
  await page.getByRole("link", { name: "Undertone home" }).click();
  await page.getByRole("link", { name: "Downloads", exact: true }).click();
  await page.locator(".episode-title").first().click();
  fixture.setPhase("ready");
  await expect(page.locator("#title")).toContainText("China");
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    "/episodes/ezra/audio",
  );
  await expect(page.locator(".transcript-row").first()).toBeVisible();
});

test("transcript preparation shows real download bytes and handles unknown totals", async ({
  page,
}) => {
  const fixture = await preparationFixture(page);
  fixture.setPhase("downloading");
  await page.goto(`/#listen/${fixture.episode.id}`);
  const progress = page.getByRole("progressbar", { name: "Audio download" });
  await expect(progress).toHaveAttribute("value", "0.5");
  await expect(page.locator("#preparation-status")).toContainText(
    "50% · 5.0 MB / 10.0 MB",
  );
  await page.screenshot({ path: ".local/download-progress.png" });
  fixture.setTransfer(7_000_000, null);
  await expect(page.locator("#preparation-status")).toContainText(
    "Downloading · 7.0 MB",
  );
  await expect(progress).not.toHaveAttribute("value");
  fixture.setPhase("transcribing");
  await expect(progress).toBeHidden();
  await expect(page.locator("#preparation-status")).toContainText(
    "Transcribing on your Mac",
  );
});

import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { FeedEpisode } from "../web/library";

// Explicit opt-in only: routine suites must not fetch publisher audio.
const library = JSON.parse(
  await readFile(new URL("../.local/library.json", import.meta.url), "utf8"),
);
for (const showId of ["plain-english", "dwarkesh"]) {
  test(`live streaming: ${showId} plays, seeks and restores while browsing`, async ({
    page,
  }, info) => {
    test.skip(
      process.env.PODCAST_LIVE_STREAM !== "1",
      "Publisher requests require an explicit live run",
    );
    test.setTimeout(60000);
    const episode: FeedEpisode = library.episodes.find(
      (e: FeedEpisode) => e.showId === showId && !e.preparedId,
    );
    const media: { host: string; status: number; range: string | null }[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "media")
        media.push({
          host: new URL(response.url()).hostname,
          status: response.status(),
          range: response.headers()["content-range"] ?? null,
        });
    });
    await page.goto(`/#show/${showId}`);
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
      audio.muted = true;
    });
    await page
      .getByRole("button", { name: `Play ${episode.title}`, exact: true })
      .click();
    await expect(page.locator("#title")).toHaveText(episode.title);
    const position = () =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime);
    await expect.poll(position, { timeout: 25000 }).toBeGreaterThan(1);
    await page.locator("#speed").click();
    await page.locator("#seek").evaluate((input: HTMLInputElement) => {
      input.value = "600";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(position, { timeout: 20000 }).toBeGreaterThan(601);
    await page.getByRole("link", { name: "Undertone home" }).click();
    const before = await position();
    await expect.poll(position).toBeGreaterThan(before + 1);
    await page.getByRole("link", { name: "Downloads", exact: true }).click();
    await page.locator(".episode-title").first().click();
    await expect(page.locator("#title")).toContainText("China");
    await page.getByRole("link", { name: "Undertone home" }).click();
    await page.getByRole("searchbox").fill(episode.title);
    await page.getByRole("link", { name: episode.title, exact: true }).click();
    await expect.poll(position, { timeout: 15000 }).toBeGreaterThan(600);
    await page.locator("#play").click();
    const resumed = await position();
    await expect.poll(position).toBeGreaterThan(resumed + 1);
    await page.locator("#play").click();
    expect(
      media.some(
        (entry) => entry.status === 206 && !entry.host.startsWith("127."),
      ),
    ).toBe(true);
    await info.attach("stream-evidence", {
      body: JSON.stringify({ episode: episode.title, media, resumed }, null, 2),
      contentType: "application/json",
    });
    console.log(
      JSON.stringify({ showId, episode: episode.title, media, resumed }),
    );
  });
}

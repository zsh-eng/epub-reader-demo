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
    completedChunks: number | undefined,
    totalChunks: number | undefined,
    draft: { revision: number; paragraphs: string[] } | undefined,
    analysis: typeof payload | undefined,
    starts = 0;
  await page.route("**/api/preparations", (route) =>
    route.fulfill({ json: phase === "ready" ? [episode.id] : [] }),
  );
  await page.route(`**/api/preparations/${episode.id}`, (route) => {
    if (route.request().method() === "POST") {
      starts++;
      if (phase === "idle") phase = "transcribing";
    }
    return route.fulfill({
      json: {
        id: episode.id,
        phase,
        downloadedBytes,
        totalBytes,
        completedChunks,
        totalChunks,
        draftRevision: draft?.revision,
        analysisRevision: analysis?.analysisRevision,
        coverageEnd: analysis?.coverageEnd,
        detail:
          phase === "failed"
            ? "Preparation was interrupted. Retry to continue."
            : "Transcribing on your Mac",
      },
    });
  });
  await page.route(`**/api/preparations/${episode.id}/draft`, (route) =>
    draft ? route.fulfill({ json: draft }) : route.fulfill({ status: 404 }),
  );
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
  await page.route(`**/episodes/${episode.id}/analysis.json?*`, (route) =>
    route.fulfill({ json: analysis }),
  );
  return {
    episode,
    setAnalysis: (revision: number, complete = false) => {
      analysis = structuredClone(payload);
      analysis.analysisRevision = revision;
      analysis.coverageEnd = complete
        ? payload.duration
        : revision === 1
          ? 300
          : 1800;
      analysis.analysisComplete = complete;
      analysis.speakers = [
        {
          id: `voice-${revision}`,
          name: `Host pass ${revision}`,
          role: "Host",
          confidence: "likely",
        },
      ];
      analysis.rows.forEach((row: { speaker: string }) => {
        row.speaker = `voice-${revision}`;
      });
      analysis.skips =
        revision > 1
          ? [
              {
                id: "new-ad",
                start: 290,
                end: 330,
                category: "sponsor",
                score: 1,
              },
            ]
          : [];
      if (complete) phase = "ready";
    },
    setPhase: (next: string) => {
      phase = next;
    },
    setTransfer: (bytes: number, total: number | null) => {
      downloadedBytes = bytes;
      totalBytes = total;
    },
    starts: () => starts,
    setTranscription: (completed: number, total: number) => {
      completedChunks = completed;
      totalChunks = total;
    },
    setDraft: (revision: number, paragraphs: string[]) => {
      draft = { revision, paragraphs };
    },
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
  expect(fixture.starts()).toBe(0);
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
  expect(fixture.starts()).toBe(0);
});

test("cumulative analysis replaces speaker maps without reloading audio or disturbing selection", async ({
  page,
}) => {
  const fixture = await preparationFixture(page);
  await page.goto(`/#listen/${fixture.episode.id}`);
  await expect(page.locator("#preparation-status")).toContainText(
    "Transcribing on your Mac",
  );
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.muted = true;
  });
  await page.locator("#play").click();
  await page.locator("#speed").click();
  await page.locator("#seek").evaluate((input: HTMLInputElement) => {
    input.value = "300";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  fixture.setAnalysis(1);
  await expect(page.locator(".transcript-row").first()).toContainText(
    "Host pass 1",
  );
  await expect(page.locator(".analysis-coverage")).toHaveText(
    "Analysed through 5:00",
  );
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 300),
    )
    .toBe(true);
  await page.locator("audio").evaluate((a: HTMLAudioElement) => {
    a.dataset.loads = "0";
    a.addEventListener("loadstart", () => {
      a.dataset.loads = String(Number(a.dataset.loads) + 1);
    });
  });
  await page.locator("#follow").click();
  const anchor = await page
    .locator(".transcript-row")
    .first()
    .evaluate((node) => ({
      id: (node as HTMLElement).dataset.index,
      y: node.getBoundingClientRect().top,
    }));
  fixture.setAnalysis(2);
  await expect(page.locator(".transcript-row").first()).toContainText(
    "Host pass 2",
  );
  await expect(page.locator("#follow")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator(".analysis-coverage")).toHaveText(
    "Analysed through 30:00",
  );
  await expect(page.locator("audio")).toHaveAttribute("data-loads", "0");
  const state = await page.locator("audio").evaluate((a: HTMLAudioElement) => ({
    paused: a.paused,
    rate: a.playbackRate,
    time: a.currentTime,
  }));
  expect(state.paused).toBe(false);
  expect(state.rate).toBe(1.25);
  expect(state.time).toBeLessThan(330);
  const moved = await page
    .locator(".transcript-row")
    .first()
    .evaluate((node) => ({
      id: (node as HTMLElement).dataset.index,
      y: node.getBoundingClientRect().top,
    }));
  expect(moved.id).toBe(anchor.id);
  expect(Math.abs(moved.y - anchor.y)).toBeLessThan(3);
  await page
    .locator(".transcript-row")
    .first()
    .evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  fixture.setAnalysis(3, true);
  // Observe the next status poll, then confirm it did not replace selected text.
  await page.waitForResponse((response) =>
    response.url().endsWith(`/api/preparations/${fixture.episode.id}`),
  );
  await expect(page.locator(".transcript-row").first()).toContainText(
    "Host pass 2",
  );
  expect(
    await page.evaluate(() => window.getSelection()?.toString()),
  ).toContain("Host pass 2");
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(page.locator(".transcript-row").first()).toContainText(
    "Host pass 3",
  );
  await expect(page.locator("#preparation-status")).toHaveCount(0);
  await expect(page.locator("audio")).toHaveAttribute("data-loads", "0");
  // The deferred range is eligible again after an explicit seek.
  await page.locator("#seek").evaluate((input: HTMLInputElement) => {
    input.value = "305";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThan(330);
  expect(fixture.starts()).toBe(0);
});

test("draft paragraphs arrive during transcription without seeking or enabling skips", async ({
  page,
}) => {
  const fixture = await preparationFixture(page);
  fixture.setDraft(1, ["The first complete passage."]);
  await page.goto(`/#listen/${fixture.episode.id}`);
  const draft = page.getByRole("region", {
    name: "Draft transcript",
    exact: true,
  });
  await expect(draft).toContainText("The first complete passage.");
  await draft
    .locator("p")
    .first()
    .evaluate((node) => {
      node.dataset.retained = "yes";
    });
  fixture.setDraft(2, [
    "The first complete passage.",
    "The next passage is now available.",
  ]);
  await expect(draft).toContainText("The next passage is now available.");
  await expect(draft.locator("p").first()).toHaveAttribute(
    "data-retained",
    "yes",
  );
  await expect(draft.getByRole("button")).toHaveCount(0);
  await expect(page.locator("#skip-toggle")).toBeDisabled();
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    fixture.episode.audioURL,
  );
  await page.screenshot({ path: ".local/draft-transcript.png" });
  fixture.setPhase("ready");
  await expect(page.locator(".transcript-row").first()).toBeVisible();
  await expect(draft).toHaveCount(0);
});

test("transcription progress counts completed chunks and clears for speaker analysis", async ({
  page,
}) => {
  const fixture = await preparationFixture(page);
  await page.goto(`/#listen/${fixture.episode.id}`);
  const progress = page.getByRole("progressbar", {
    name: "Transcription progress",
  });
  await expect(progress).toBeHidden();
  fixture.setTranscription(0, 3);
  await expect(progress).toHaveAttribute("value", "0");
  await expect(page.locator("#preparation-status")).toContainText(
    "chunk 1 of 3 · 0%",
  );
  fixture.setTranscription(2, 3);
  await expect(page.locator("#preparation-status")).toContainText(
    "chunk 3 of 3 · 66%",
  );
  fixture.setTranscription(3, 3);
  await expect(progress).toHaveAttribute("value", "1");
  await expect(page.locator("#preparation-status")).toContainText(
    "Transcription complete · 100%",
  );
  fixture.setPhase("speakers");
  await expect(progress).toBeHidden();
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
  expect(fixture.starts()).toBe(1);
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

test("browsing and restoring an episode never starts work; explicit preparation starts once", async ({
  page,
}) => {
  const fixture = await preparationFixture(page);
  fixture.setPhase("idle");
  await page.goto(`/#listen/${fixture.episode.id}`);
  await expect(
    page.getByRole("button", { name: "Prepare transcript", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Undertone home" }).click();
  await page.getByRole("button", { name: "Open current episode" }).click();
  expect(fixture.starts()).toBe(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Prepare transcript", exact: true }),
  ).toBeVisible();
  expect(fixture.starts()).toBe(0);
  await page
    .getByRole("button", { name: "Prepare transcript", exact: true })
    .click();
  await expect(page.locator("#preparation-status")).toContainText(
    "Transcribing on your Mac",
  );
  await page.getByRole("link", { name: "Undertone home" }).click();
  await page.getByRole("button", { name: "Open current episode" }).click();
  expect(fixture.starts()).toBe(1);
});

test("playing an idle episode starts preparation once, including repeated play events", async ({
  page,
}) => {
  const fixture = await preparationFixture(page);
  fixture.setPhase("idle");
  await page.goto(`/#listen/${fixture.episode.id}`);
  await expect(
    page.getByRole("button", { name: "Prepare transcript", exact: true }),
  ).toBeVisible();
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.muted = true;
  });
  await page.locator("#play").click();
  await expect(page.locator("#preparation-status")).toContainText(
    "Transcribing on your Mac",
  );
  await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) =>
      audio.dispatchEvent(new Event("play")),
    );
  expect(fixture.starts()).toBe(1);
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

import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
const host = spawn(
  process.execPath,
  ["dist/cli.js", resolve(process.argv[2] ?? ".benchmarks/bun"), "--port", "0", "--no-open"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let hostErrors = "";
host.stderr.on("data", (chunk) => {
  hostErrors += chunk;
});
const url = await new Promise((resolveUrl, reject) => {
  let output = "";
  const timeout = setTimeout(() => {
    host.kill();
    reject(new Error(`Host startup timed out: ${hostErrors}`));
  }, 30000);
  host.stdout.on("data", (chunk) => {
    output += chunk;
    const match = output.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
    if (match) {
      clearTimeout(timeout);
      resolveUrl(match[0]);
    }
  });
  host.once("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error(`Host exited: ${code}`));
  });
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  const blameReads = [];
  page.on("requestfinished", (request) => {
    if (!request.url().endsWith("/api/browse/blame")) return;
    const timing = request.timing();
    const body = request.postDataJSON();
    blameReads.push({
      startLine: body.startLine,
      endLine: body.endLine,
      ms: timing.responseEnd - timing.requestStart,
    });
  });
  await page.goto(url);
  await page.locator('[data-review-status="ready"]').waitFor();
  const commits = page.getByRole("listbox", { name: "Commits" }).getByRole("option");
  await commits.first().waitFor();
  const rangeStart = performance.now();
  await commits.nth(0).click();
  await page.locator('[data-review-status="ready"]').waitFor();
  await commits.nth(2).click({ modifiers: ["Shift"] });
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[role="listbox"][aria-label="Commits"] [aria-selected="true"]')
        .length === 3,
  );
  await page.locator('[data-review-status="ready"]').waitFor();
  const rangeMs = performance.now() - rangeStart;
  await page.screenshot({ path: "docs/validation/commit-range.png" });
  const repeatedRanges = [];
  for (const index of [3, 1, 0, 2, 3, 2, 1, 0]) {
    const started = performance.now();
    await commits.nth(index).click({ modifiers: ["Shift"] });
    await page.locator('[data-review-status="ready"]').waitFor();
    const count = await page
      .locator('[role="listbox"][aria-label="Commits"] [aria-selected="true"]')
      .count();
    if (count !== index + 1)
      throw new Error(`Wrong range selection: ${count}, expected ${index + 1}`);
    repeatedRanges.push(performance.now() - started);
  }
  // Do not wait for each review: ensure cancelled responses cannot win the race.
  for (const index of [4, 2, 5, 1, 3]) await commits.nth(index).click({ modifiers: ["Shift"] });
  await page.locator('[data-review-status="ready"]').waitFor();
  if (await page.getByText("The server returned a different comparison.", { exact: false }).count())
    throw new Error("Range response mismatch");
  await page.keyboard.press("Meta+Shift+K");
  await page
    .getByRole("combobox", { name: "Find file", exact: true })
    .fill("src/css/selectors/parser.rs");
  const firstBlame = page.waitForResponse((response) =>
    response.url().endsWith("/api/browse/blame"),
  );
  await page.getByRole("option").filter({ hasText: "parser.rs" }).first().click();
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await pane.waitFor();
  await (await firstBlame).finished();
  await page.keyboard.type("/small_list_into_box");
  await page.waitForFunction(() => {
    const key = [...CSS.highlights.keys()].find((key) => key.endsWith("-search-current"));
    return key && [...CSS.highlights.get(key)][0]?.toString() === "small_list_into_box";
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("1607G^");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-file-pane="main"]')?.getAttribute("data-vim-line") === "1607",
  );
  const definitionResponse = page.waitForResponse((response) =>
    response.url().includes("/api/browse/symbols"),
  );
  const definitionStart = performance.now();
  await page.keyboard.type("gd");
  await definitionResponse;
  await page.waitForFunction(
    () => document.querySelector('[data-file-pane="main"]')?.getAttribute("data-vim-line") === "50",
  );
  const definitionMs = performance.now() - definitionStart;
  await page.keyboard.type("/parse");
  await page.waitForFunction(() => {
    const key = [...CSS.highlights.keys()].find((key) => key.endsWith("-search-current"));
    return key && [...CSS.highlights.get(key)][0]?.toString() === "parse";
  });
  await page.keyboard.press("Enter");
  const samples = await page.evaluate(async () => {
    const pane = document.querySelector('[data-file-pane="main"]');
    const times = [];
    for (let i = 0; i < 40; i++) {
      const start = performance.now();
      pane.dispatchEvent(
        new KeyboardEvent("keydown", { key: i % 2 ? "N" : "n", bubbles: true, cancelable: true }),
      );
      times.push(performance.now() - start);
      await new Promise(requestAnimationFrame);
    }
    return times.sort((a, b) => a - b);
  });
  if (!blameReads.length) throw new Error("Blame was not prefetched while closed");
  const cachedToggleStart = performance.now();
  await page.getByRole("button", { name: "Toggle Git blame" }).click();
  await page.locator("[data-med-blame]").first().waitFor();
  const cachedToggleMs = performance.now() - cachedToggleStart;
  await pane.evaluate((el) => el.focus({ preventScroll: true }));
  await page.keyboard.press("n");

  await page.screenshot({ path: "docs/validation/search-and-gutter-blame.png" });
  const gutter = await page.locator("[data-med-blame]").count();
  const triggers = page.locator("[data-med-blame-trigger]");
  const visibleTriggers = [];
  for (const trigger of await triggers.all()) {
    const box = await trigger.evaluate((el) => el.getBoundingClientRect().toJSON());
    if (box && box.y > 150 && box.y < 800) visibleTriggers.push(trigger);
    if (visibleTriggers.length === 2) break;
  }
  await page.mouse.move(1400, 20);
  const hover = async (trigger) => {
    const box = await trigger.evaluate((el) => el.getBoundingClientRect().toJSON());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  };
  const firstHoverStart = performance.now();
  await hover(visibleTriggers[0]);
  await page.getByRole("tooltip").waitFor();
  const firstTooltipMs = performance.now() - firstHoverStart;
  const nextLabel = await visibleTriggers[1].getAttribute("aria-label");
  const nextLine = nextLabel.match(/^Line (\d+):/)[1];
  const scanStart = performance.now();
  await hover(visibleTriggers[1]);
  await page
    .getByRole("tooltip")
    .filter({ hasText: `Line ${nextLine}` })
    .waitFor();
  const scanTooltipMs = performance.now() - scanStart;
  await page.screenshot({ path: "docs/validation/blame-tooltip.png" });
  if (await triggers.first().getAttribute("title")) throw new Error("Native title remains");
  if (errors.length) throw new Error(errors.join("\n"));
  const result = {
    measuredAt: new Date().toISOString(),
    repository: "Bun",
    file: "src/css/selectors/parser.rs",
    samples: samples.length,
    searchKeyHandlerP50Ms: samples[20],
    searchKeyHandlerP95Ms: samples[38],
    definitionMs,
    rangeMs,
    mountedBlameCells: gutter,
    repeatedRangesMs: repeatedRanges,
    rapidRangeChanges: 5,
    blameReads,
    cachedToggleMs,
    firstTooltipMs,
    scanTooltipMs,
    errors,
    method:
      "Production Chromium; search measures synchronous keydown work, excluding frame presentation. Definition and range include Playwright input and polling.",
  };
  await writeFile("docs/validation/review-features.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  host.kill();
}

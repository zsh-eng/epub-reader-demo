// Reproduction and interpretation: docs/validation/HIGHLIGHTER_INTEGRATION.md
import { spawn, execFileSync } from "node:child_process";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { cpus, platform, arch } from "node:os";
import { chromium } from "playwright";
import { recordTimedOperation } from "../helpers/record-timed-operation.mjs";
import { compareVideos } from "../helpers/compare-videos.mjs";

const directory = resolve(".benchmarks/highlighter-comparison");
const engineArgument = process.argv.indexOf("--engine");
const engines = engineArgument < 0 ? ["shiki", "twinkleplop"] : [process.argv[engineArgument + 1]];
if (engines.some((engine) => !["shiki", "twinkleplop"].includes(engine)))
  throw new Error("Unknown engine");
const cases = [
  {
    id: "bun-http2",
    label: "Bun HTTP/2",
    repo: resolve(".benchmarks/bun"),
    file: "src/js/node/http2.ts",
  },
  { id: "med-app", label: "med App", repo: resolve("."), file: "src/web/App.tsx" },
];
await mkdir(directory, { recursive: true });
if (!process.argv.includes("--skip-build")) {
  for (const engine of engines) {
    execFileSync("npx", ["vite", "build", "--outDir", join(directory, engine, "web")], {
      env: { ...process.env, MED_HIGHLIGHTER: engine },
      stdio: "inherit",
    });
  }
}
for (const engine of engines) await copyFile("dist/cli.js", join(directory, engine, "cli.js"));

async function startHost(engine, example) {
  const host = spawn(
    process.execPath,
    [
      join(directory, engine, "cli.js"),
      example.repo,
      "--port",
      "0",
      "--no-open",
      "--state-dir",
      join(directory, "state", `${engine}-${example.id}`),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MED_ZOEKT_BIN: join(directory, "no-search-binaries"),
        MED_SEARCH_CACHE: join(directory, "search-cache"),
      },
    },
  );
  let stderr = "";
  host.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const url = await new Promise((accept, reject) => {
    let text = "";
    const timer = setTimeout(() => {
      host.kill();
      reject(new Error(`Host startup timed out: ${stderr}`));
    }, 30000);
    host.stdout.on("data", (chunk) => {
      text += chunk;
      const found = text.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (found) {
        clearTimeout(timer);
        accept(found[0]);
      }
    });
    host.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Host exited ${code}: ${stderr}`));
    });
  });
  return { host, url };
}

for (const example of cases) {
  for (const engine of engines) {
    console.log(`Recording ${engine}: ${example.label}`);
    const { host, url } = await startHost(engine, example);
    const browser = await chromium.launch({ headless: true });
    let release;
    try {
      const context = await browser.newContext({
        viewport: { width: 1120, height: 800 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("med:theme:v1", "tokyo-night");
        window.__comparisonFileReplies = 0;
        window.__comparisonPendingHighlights = 0;
        const OriginalWorker = window.Worker;
        window.Worker = class extends OriginalWorker {
          constructor(...args) {
            super(...args);
            this.pendingHighlights = new Set();
            this.addEventListener("message", ({ data }) => {
              if (this.pendingHighlights.delete(data?.id)) window.__comparisonPendingHighlights--;
              if (data?.type === "success" && data.requestType === "file")
                window.__comparisonFileReplies++;
            });
          }
          postMessage(data, ...rest) {
            if (
              (data?.type === "file" || data?.type === "diff") &&
              !this.pendingHighlights.has(data.id)
            ) {
              this.pendingHighlights.add(data.id);
              window.__comparisonPendingHighlights++;
            }
            return super.postMessage(data, ...rest);
          }
        };
      });
      const gate = new Promise((accept) => {
        release = accept;
      });
      let requestSeen;
      const requested = new Promise((accept) => {
        requestSeen = accept;
      });
      let responseSeen;
      const responseReady = new Promise((accept) => {
        responseSeen = accept;
      });
      let targetReads = 0;
      await page.route("**/api/browse/read", async (route) => {
        const body = route.request().postDataJSON();
        if (body?.path !== example.file) return route.continue();
        targetReads++;
        requestSeen();
        const response = await route.fetch();
        responseSeen();
        await gate;
        await route.fulfill({ response });
      });
      await page.goto(url);
      await page.locator('[data-review-status="ready"]').waitFor({ timeout: 30000 });
      await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+Shift+k`);
      await page.getByRole("combobox", { name: "Find file" }).fill(example.file);
      await page
        .getByRole("option")
        .filter({ hasText: example.file.split("/").at(-1) })
        .first()
        .waitFor();
      await requested;
      await responseReady;
      await page.getByRole("combobox", { name: "Find file" }).press("Enter");
      await page.getByRole("combobox", { name: "Find file" }).waitFor({ state: "hidden" });
      await page.waitForFunction(() => window.__comparisonPendingHighlights === 0);
      await page.mouse.move(1110, 790);
      await page.evaluate(() => {
        window.__comparisonFileReplies = 0;
      });
      const recording = await recordTimedOperation(page, {
        output: join(directory, `${example.id}-${engine}.mp4`),
        run: async () => {
          release();
        },
        waitUntilComplete: async () => {
          await page.waitForFunction(
            () => {
              if (window.__comparisonFileReplies < 1) return false;
              const pane = document.querySelector('[data-file-pane="main"]');
              if (!pane) return false;
              function collect(root) {
                let elements = [...root.querySelectorAll("[data-line] span[style]")];
                for (const element of root.querySelectorAll("*")) {
                  if (element.shadowRoot) elements = elements.concat(collect(element.shadowRoot));
                }
                return elements;
              }
              const tokens = collect(pane);
              const colors = new Set(tokens.map((token) => getComputedStyle(token).color));
              return tokens.length >= 20 && colors.size >= 3;
            },
            null,
            { timeout: 30000, polling: "raf" },
          );
          await page.evaluate(
            () =>
              new Promise((accept) => requestAnimationFrame(() => requestAnimationFrame(accept))),
          );
        },
      });
      const source = await readFile(join(example.repo, example.file));
      const report = {
        ...recording,
        engine,
        label: example.label,
        file: example.file,
        repo: example.repo,
        sourceBytes: source.length,
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        browser: await browser.version(),
        viewport: { width: 1120, height: 800 },
        machine: { model: cpus()[0]?.model, platform: platform(), arch: arch() },
        targetReads,
        errors,
        method:
          "Fresh Chromium context and production host. File picker selects target while its already-fetched read response is gated. Timer starts when response is released. Completion requires a new file worker success, main file pane with at least 20 colored token spans and 3 distinct colors, then 2 animation frames. This excludes Git read/network latency and app startup; includes response delivery, parse/highlight/render, language loading, observer and capture overhead. OS caches warm. One representative recording per case and engine, not a statistical benchmark.",
      };
      await writeFile(
        join(directory, `${example.id}-${engine}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      await page.screenshot({ path: join(directory, `${example.id}-${engine}.png`) });
      console.log(
        JSON.stringify({
          engine,
          case: example.id,
          milliseconds: recording.durationSeconds * 1000,
          errors,
        }),
      );
      if (errors.length) throw new Error(`${engine} browser errors: ${errors.join("; ")}`);
    } finally {
      release?.();
      await browser.close();
      host.kill();
    }
  }
}

if (engines.length === 2) {
  const results = [];
  await mkdir("docs/validation/videos", { recursive: true });
  for (const example of cases) {
    const left = JSON.parse(await readFile(join(directory, `${example.id}-shiki.json`), "utf8"));
    const right = JSON.parse(
      await readFile(join(directory, `${example.id}-twinkleplop.json`), "utf8"),
    );
    if (left.sourceSha256 !== right.sourceSha256)
      throw new Error("Source changed between recordings");
    const manifest = {
      output: resolve(`docs/validation/videos/${example.id}-highlighters.mp4`),
      slowMotion: 3,
      holdSeconds: 3,
      panelWidth: 1120,
      fps: 30,
      left: { ...left, label: `Shiki · ${example.label}` },
      right: { ...right, label: `Twinkleplop · ${example.label}` },
    };
    const composition = await compareVideos(manifest);
    results.push({ case: example.id, left, right, composition });
  }
  await writeFile(join(directory, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(
    "docs/validation/videos/highlighter-comparison-results.json",
    `${JSON.stringify(results, null, 2)}\n`,
  );
  await writeFile(
    "docs/validation/videos/highlighter-comparison-results.json",
    `${JSON.stringify(results, null, 2)}\n`,
  );
}

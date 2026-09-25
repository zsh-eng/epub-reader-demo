// Full production UI check; no changes to the user's running med host.
import { spawn, execFileSync } from "node:child_process";
import { mkdir, copyFile, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir, cpus } from "node:os";
import { chromium } from "playwright";
const directory = resolve(".benchmarks/language-ui");
// Compare retained production builds without changing which engine they use.
const builds = process.argv.find((argument) => argument.startsWith("--builds="))?.slice(9);
if (
  builds &&
  (!process.argv.includes("--skip-build") || !/^[a-z0-9-]+(?:,[a-z0-9-]+)*$/.test(builds))
)
  throw new Error("--builds requires --skip-build and comma-separated build directory names");
const engines =
  builds?.split(",") ??
  (process.argv.includes("--native-only") ? ["twinkleplop"] : ["shiki", "twinkleplop"]);
const profile = process.argv.includes("--profile");
const corpus = JSON.parse(await readFile("helpers/highlighting/corpus.json", "utf8"));
await mkdir(directory, { recursive: true });
for (const engine of engines) {
  if (!process.argv.includes("--skip-build"))
    execFileSync("bun", ["run", "vite", "build", "--outDir", join(directory, engine, "web")], {
      env: { ...process.env, MED_HIGHLIGHTER: engine },
      stdio: "inherit",
    });
  await copyFile("dist/cli.js", join(directory, engine, "cli.js"));
}
const workspace = await mkdtemp(join(tmpdir(), "med-language-ui-"));
const repo = join(workspace, "repo");
await mkdir(repo);
const reports = [];
let host, browser;
try {
  execFileSync("git", ["init", "-q", repo]);
  for (const f of corpus)
    await copyFile(`.benchmarks/language-parity/corpus/${f.name}`, join(repo, f.name));
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=med benchmark",
    "-c",
    "user.email=benchmark@localhost",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "Corpus",
  ]);
  browser = await chromium.launch({ headless: true });
  for (let round = 0; round < 3; round++)
    for (const engine of round % 2 ? [...engines].reverse() : engines) {
      host = spawn(
        process.execPath,
        [
          join(directory, engine, "cli.js"),
          repo,
          "--port",
          "0",
          "--no-open",
          "--state-dir",
          join(workspace, `state-${engine}-${round}`),
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            MED_ZOEKT_BIN: join(workspace, "no-search"),
            MED_SEARCH_CACHE: join(workspace, "search-cache"),
          },
        },
      );
      const url = await new Promise((accept, reject) => {
        let text = "";
        const timer = setTimeout(() => reject(new Error("Host startup timeout")), 30000);
        host.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Host exit ${code}`));
        });
        host.stdout.on("data", (chunk) => {
          text += chunk;
          const match = text.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
          if (match) {
            clearTimeout(timer);
            accept(match[0]);
          }
        });
      });
      for (const file of corpus) {
        const context = await browser.newContext({
          viewport: { width: 1120, height: 800 },
          deviceScaleFactor: 1,
        });
        try {
          const page = await context.newPage(),
            errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.addInitScript(() => {
            localStorage.setItem("med:theme:v1", "tokyo-night");
            window.__fileReplies = 0;
            window.__stages = [];
            window.__mark = (name, details = {}) => {
              if (window.__start) {
                const ms = performance.now() - window.__start;
                window.__stages.push({ name, ms, ...details });
                performance.mark(`med-open:${name}`);
              }
            };
            window.__pending = 0;
            const originalFetch = window.fetch;
            window.fetch = async (...args) => {
              const response = await originalFetch(...args);
              if (String(args[0]).includes("/api/browse/read")) {
                window.__mark("response");
                const json = response.json.bind(response);
                response.json = async () => {
                  const result = await json();
                  window.__mark("json");
                  return result;
                };
              }
              return response;
            };
            const WorkerBase = window.Worker;
            window.Worker = class extends WorkerBase {
              constructor(...args) {
                super(...args);
                this.pending = new Set();
                this.addEventListener("message", ({ data }) => {
                  if (this.pending.delete(data?.id)) window.__pending--;
                  if (data?.type === "success" && data.requestType === "file") {
                    window.__fileReplies++;
                    window.__mark("worker-reply", { id: data.id });
                  }
                });
              }
              postMessage(data, ...rest) {
                if (data?.type === "file") window.__mark("worker-send", { id: data.id });
                if (["file", "diff"].includes(data?.type) && !this.pending.has(data.id)) {
                  this.pending.add(data.id);
                  window.__pending++;
                }
                return super.postMessage(data, ...rest);
              }
            };
          });
          let release, seen;
          const gate = new Promise((r) => (release = r)),
            requested = new Promise((r) => (seen = r));
          await page.route("**/api/browse/read", async (route) => {
            if (route.request().postDataJSON()?.path !== file.name) return route.continue();
            const response = await route.fetch();
            seen();
            await gate;
            await route.fulfill({ response });
          });
          await page.goto(url);
          await page.locator('[data-review-status="ready"]').waitFor();
          await page.keyboard.press(
            `${process.platform === "darwin" ? "Meta" : "Control"}+Shift+k`,
          );
          await page.getByRole("combobox", { name: "Find file" }).fill(file.name);
          await page.getByRole("option").filter({ hasText: file.name }).first().waitFor();
          await Promise.race([
            requested,
            new Promise((_, reject) => {
              const t = setTimeout(() => reject(new Error("File request timeout")), 30000);
              t.unref();
            }),
          ]);
          await page.getByRole("combobox", { name: "Find file" }).press("Enter");
          await page.getByRole("combobox", { name: "Find file" }).waitFor({ state: "hidden" });
          await page.waitForFunction(() => window.__pending === 0);
          const cdp = profile ? await context.newCDPSession(page) : null;
          if (cdp)
            await cdp.send("Tracing.start", {
              categories: "devtools.timeline,blink.user_timing,disabled-by-default-v8.cpu_profiler",
              transferMode: "ReturnAsStream",
            });
          await page.evaluate(() => {
            window.__fileReplies = 0;
            window.__start = performance.now();
          });
          release();
          await page.waitForFunction(
            () => {
              if (window.__fileReplies < 1) return false;
              const pane = document.querySelector('[data-file-pane="main"]');
              if (!pane) return false;
              function collect(root) {
                let nodes = [...root.querySelectorAll("[data-line] span[style]")];
                for (const element of root.querySelectorAll("*"))
                  if (element.shadowRoot) nodes = nodes.concat(collect(element.shadowRoot));
                return nodes;
              }
              const tokens = collect(pane);
              const ready =
                tokens.length >= 20 &&
                new Set(tokens.map((t) => getComputedStyle(t).color)).size >= 3;
              if (ready) window.__mark("visible");
              return ready;
            },
            null,
            { timeout: 30000, polling: "raf" },
          );
          const ms = await page.evaluate(
            () =>
              new Promise((accept) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => accept(performance.now() - window.__start)),
                ),
              ),
          );
          if (errors.length) throw new Error(errors.join("\n"));
          const stages = await page.evaluate(() => window.__stages);
          if (cdp) {
            const complete = new Promise((accept) => cdp.once("Tracing.tracingComplete", accept));
            await cdp.send("Tracing.end");
            const { stream } = await complete;
            let trace = "";
            while (true) {
              const chunk = await cdp.send("IO.read", { handle: stream });
              trace += chunk.data;
              if (chunk.eof) break;
            }
            await cdp.send("IO.close", { handle: stream });
            await writeFile(join(directory, `${file.name}-${engine}-${round}.trace.json`), trace);
            await cdp.detach();
          }
          const result = { round, engine, file: file.name, ms, stages, errors };
          reports.push(result);
          console.log(JSON.stringify(result));
          if (round === 0)
            await page.screenshot({ path: join(directory, `${file.name}-${engine}.png`) });
          await writeFile(
            join(directory, profile ? "profile-results.json" : "results.json"),
            JSON.stringify(
              {
                capturedAt: new Date().toISOString(),
                profiling: profile,
                engines,
                machine: cpus()[0].model,
                browser: browser.version(),
                corpus,
                method:
                  "Fresh browser context; production host and worker. Timer starts at release of an already fetched file response. Ends after a file worker reply, visible highlighted main pane, and two animation frames. Excludes app startup and Git read; includes worker language loading, message transfer, virtualized UI, and observer overhead. Three rounds per engine; engine order alternates when comparing engines. OS caches warm. Phase timestamps use the same start; worker-reply is observed before pool decoding, and visible is detected before the two final animation frames.",
                runs: reports,
              },
              null,
              2,
            ) + "\n",
          );
        } finally {
          await context.close();
        }
      }
      const stopped = new Promise((accept) => host.once("exit", accept));
      host.kill();
      await stopped;
      host = undefined;
    }
} finally {
  host?.kill();
  await browser?.close();
  await rm(workspace, { recursive: true, force: true });
}

import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type Subprocess } from "bun";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PAGINATION_WORKER_FONTS_READY_MARK } from "../src/lib/pagination-v2/protocol";

const TRACE_STORAGE_KEY = "reader-performance-traces-v1";
const TRACE_RECORDING_KEY = "reader-performance-tracing-enabled-v1";
const SETTINGS_STORAGE_KEY = "epub-reader-settings";
const DEFAULT_URL = "http://127.0.0.1:4174";
const DEFAULT_OUTPUT_DIR = "diagnostics/reader-startup";

interface CliOptions {
  epub: string;
  url: string;
  outputDirectory: string;
  headed: boolean;
  startServer: boolean;
  firstPaintTimeoutMs: number;
  completionTimeoutMs: number;
  publisherBookStylingEnabled: boolean;
  waitForWorkerWarm: boolean;
  cpuThrottleRates: number[];
  repetitions: number;
  libraryWaitMs: number;
  hoverPrefetch: boolean;
}

interface StoredTraceSpan {
  name: string;
  startMs: number;
  endMs: number | null;
  status: string;
  details: Record<string, string | number | boolean | null>;
}

interface StoredTrace {
  id: string;
  bookTitle: string | null;
  status: string;
  startedAt: number;
  durationMs: number | null;
  metadata: Record<string, string | number | boolean | null>;
  spans: StoredTraceSpan[];
}

interface BenchmarkRun {
  repetition: number;
  mainThreadCpuThrottleRate: number;
  firstSpreadFrameMs: number;
  firstPaintMs: number;
  fullPaginationMs: number | null;
  traceStatus: string;
  trace: StoredTrace;
  screenshot: string;
}

function printHelp(): never {
  console.log(`Usage:
  bun run benchmark:reader-startup -- --epub <path> [options]

Options:
  --epub <path>              EPUB file to import. Required.
  --url <url>                App URL. Defaults to ${DEFAULT_URL}.
  --out <directory>          Output directory. Defaults to ${DEFAULT_OUTPUT_DIR}.
  --headed                   Show Chromium while the benchmark runs.
  --no-start-server          Use an already running app server.
  --first-paint-timeout <ms> First-paint timeout. Defaults to 120000.
  --completion-timeout <ms>  Full-pagination timeout. Defaults to 300000.
  --publisher-styles <mode>  Use "on" or "off". Defaults to "on".
  --wait-for-worker-warm     Wait for the post-Library-paint worker warm-up.
  --cpu-rate <number>        Run only this CPU throttle rate. Defaults to 1x and 4x.
  --repetitions <count>      Runs per CPU rate. Defaults to 1.
  --library-wait <ms>        Wait after Library readiness before opening. Defaults to 0.
  --hover-prefetch           Hover the book before the Library wait.
  --help                     Show this help.
`);
  process.exit(0);
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    epub: "",
    url: DEFAULT_URL,
    outputDirectory: DEFAULT_OUTPUT_DIR,
    headed: false,
    startServer: true,
    firstPaintTimeoutMs: 120_000,
    completionTimeoutMs: 300_000,
    publisherBookStylingEnabled: true,
    waitForWorkerWarm: false,
    cpuThrottleRates: [1, 4],
    repetitions: 1,
    libraryWaitMs: 0,
    hoverPrefetch: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    switch (argument) {
      case "--epub":
        options.epub = readOptionValue(args, index, argument);
        index += 1;
        break;
      case "--url":
        options.url = readOptionValue(args, index, argument).replace(/\/$/, "");
        index += 1;
        break;
      case "--out":
        options.outputDirectory = readOptionValue(args, index, argument);
        index += 1;
        break;
      case "--first-paint-timeout":
        options.firstPaintTimeoutMs = parsePositiveInteger(
          readOptionValue(args, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--completion-timeout":
        options.completionTimeoutMs = parsePositiveInteger(
          readOptionValue(args, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--publisher-styles": {
        const value = readOptionValue(args, index, argument);
        if (value !== "on" && value !== "off") {
          throw new Error(`${argument} must be "on" or "off".`);
        }
        options.publisherBookStylingEnabled = value === "on";
        index += 1;
        break;
      }
      case "--headed":
        options.headed = true;
        break;
      case "--wait-for-worker-warm":
        options.waitForWorkerWarm = true;
        break;
      case "--cpu-rate":
        options.cpuThrottleRates = [
          parsePositiveInteger(
            readOptionValue(args, index, argument),
            argument,
          ),
        ];
        index += 1;
        break;
      case "--repetitions":
        options.repetitions = parsePositiveInteger(
          readOptionValue(args, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--library-wait":
        options.libraryWaitMs = parseNonNegativeInteger(
          readOptionValue(args, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--hover-prefetch":
        options.hoverPrefetch = true;
        break;
      case "--no-start-server":
        options.startServer = false;
        break;
      case "--help":
        printHelp();
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (!options.epub) throw new Error("--epub is required.");
  return options;
}

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server can refuse connections while Vite starts.
    }
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function startPreviewServer(options: CliOptions): Subprocess | null {
  if (!options.startServer) return null;
  const parsedUrl = new URL(options.url);
  return spawn(
    [
      "bun",
      "x",
      "vite",
      "preview",
      "--host",
      parsedUrl.hostname,
      "--port",
      parsedUrl.port || "5173",
      "--strictPort",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
}

async function importBook(page: Page, epubPath: string): Promise<string> {
  await page.goto(page.url() || DEFAULT_URL, { waitUntil: "domcontentloaded" });
  const importButton = page.getByRole("button", { name: "Import EPUB" });
  await importButton.waitFor({ state: "visible" });
  const fileChooserPromise = page.waitForEvent("filechooser");
  await importButton.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(epubPath);

  const title = await page
    .locator("h3[title]")
    .first()
    .getAttribute("title", { timeout: 120_000 });
  if (!title) throw new Error("The imported book card did not expose a title.");
  return title;
}

async function waitForTraceMilestone(
  page: Page,
  milestone:
    | "first-spread-frame-painted"
    | "reader-settled-frame-painted"
    | "completed",
  timeoutMs: number,
): Promise<StoredTrace> {
  await page.waitForFunction(
    ({ storageKey, expectedMilestone }) => {
      const serialized = localStorage.getItem(storageKey);
      if (!serialized) return false;
      const trace = (JSON.parse(serialized) as StoredTrace[])[0];
      if (!trace) return false;
      if (expectedMilestone === "completed") {
        return trace.status === "completed";
      }
      return trace.spans.some((span) => span.name === expectedMilestone);
    },
    { storageKey: TRACE_STORAGE_KEY, expectedMilestone: milestone },
    { timeout: timeoutMs },
  );

  const trace = await page.evaluate((storageKey) => {
    const serialized = localStorage.getItem(storageKey);
    if (!serialized) return null;
    const traces = JSON.parse(serialized) as StoredTrace[];
    return traces[0] ?? null;
  }, TRACE_STORAGE_KEY);
  if (!trace) throw new Error(`Trace disappeared after ${milestone}.`);
  return trace;
}

async function runBenchmark(
  browser: Browser,
  options: CliOptions,
  mainThreadCpuThrottleRate: number,
  repetition: number,
): Promise<BenchmarkRun> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(
    ({ recordingKey, settingsKey, rate, publisherBookStylingEnabled }) => {
      localStorage.setItem("reader-debug-enabled-v1", "true");
      localStorage.setItem(recordingKey, "true");
      localStorage.setItem(
        settingsKey,
        JSON.stringify({
          fontSize: 18,
          lineHeight: 1.5,
          fontFamily: "lora",
          theme: "light",
          textAlign: "left",
          contentWidth: "narrow",
          publisherBookStylingEnabled,
          matchPublisherBodyTextSize: false,
        }),
      );
      window.__READER_TRACE_CONTEXT__ = {
        mainThreadCpuThrottleRate: rate,
        cpuThrottleScope: "main-thread",
        runLabel:
          rate === 1 ? "normal-cpu" : `${rate}x-main-thread-cpu-slowdown`,
        workerCpuThrottleRate: 1,
      };
    },
    {
      recordingKey: TRACE_RECORDING_KEY,
      settingsKey: SETTINGS_STORAGE_KEY,
      rate: mainThreadCpuThrottleRate,
      publisherBookStylingEnabled: options.publisherBookStylingEnabled,
    },
  );

  const page = await context.newPage();
  try {
    await page.goto(options.url, { waitUntil: "domcontentloaded" });
    const title = await importBook(page, path.resolve(options.epub));

    await page.evaluate(
      (storageKey) => localStorage.removeItem(storageKey),
      TRACE_STORAGE_KEY,
    );
    const devtools = await context.newCDPSession(page);
    await devtools.send("Emulation.setCPUThrottlingRate", {
      rate: mainThreadCpuThrottleRate,
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    const bookTitle = page.locator(`h3[title=${JSON.stringify(title)}]`);
    await bookTitle.waitFor({ state: "visible", timeout: 120_000 });
    if (options.hoverPrefetch) {
      await bookTitle.hover();
    }
    if (options.libraryWaitMs > 0) {
      await page.waitForTimeout(options.libraryWaitMs);
    }
    if (options.waitForWorkerWarm) {
      await page.waitForFunction(
        (markName) => performance.getEntriesByName(markName).length > 0,
        PAGINATION_WORKER_FONTS_READY_MARK,
        { timeout: options.firstPaintTimeoutMs },
      );
    }
    await bookTitle.dispatchEvent("click");

    const firstSpreadFrameTrace = await waitForTraceMilestone(
      page,
      "first-spread-frame-painted",
      options.firstPaintTimeoutMs,
    );
    const firstSpreadFrameMs = firstSpreadFrameTrace.spans.find(
      (span) => span.name === "first-spread-frame-painted",
    )!.startMs;
    const firstPaintTrace = await waitForTraceMilestone(
      page,
      "reader-settled-frame-painted",
      options.firstPaintTimeoutMs,
    );
    const firstPaintMs = firstPaintTrace.spans.find(
      (span) => span.name === "reader-settled-frame-painted",
    )!.startMs;

    let completedTrace = firstPaintTrace;
    try {
      completedTrace = await waitForTraceMilestone(
        page,
        "completed",
        options.completionTimeoutMs,
      );
    } catch (error) {
      console.warn(
        `Full pagination did not complete at ${mainThreadCpuThrottleRate}x main-thread CPU: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      completedTrace =
        (await page.evaluate((storageKey) => {
          const serialized = localStorage.getItem(storageKey);
          if (!serialized) return null;
          return (JSON.parse(serialized) as StoredTrace[])[0] ?? null;
        }, TRACE_STORAGE_KEY)) ?? firstPaintTrace;
    }

    await page.goto(`${options.url}/reader-traces`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "Loading traces" }).waitFor();
    const screenshot = path.resolve(
      options.outputDirectory,
      `reader-trace-${mainThreadCpuThrottleRate}x-main-run-${repetition}.png`,
    );
    await page.screenshot({ path: screenshot, fullPage: true });

    return {
      repetition,
      mainThreadCpuThrottleRate,
      firstSpreadFrameMs,
      firstPaintMs,
      fullPaginationMs: completedTrace.durationMs,
      traceStatus: completedTrace.status,
      trace: completedTrace,
      screenshot,
    };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  await mkdir(options.outputDirectory, { recursive: true });
  const server = startPreviewServer(options);

  try {
    await waitForHttpOk(options.url, 30_000);
    const browser = await chromium.launch({ headless: !options.headed });
    try {
      const runs: BenchmarkRun[] = [];
      for (const rate of options.cpuThrottleRates) {
        for (
          let repetition = 1;
          repetition <= options.repetitions;
          repetition += 1
        ) {
          console.error(
            `Running reader startup benchmark at ${rate}x main-thread CPU (${repetition}/${options.repetitions})…`,
          );
          runs.push(await runBenchmark(browser, options, rate, repetition));
        }
      }

      const report = {
        epub: path.resolve(options.epub),
        measuredAt: new Date().toISOString(),
        scenario: options.waitForWorkerWarm
          ? "first-reader-open-after-import-with-warm-worker"
          : "first-reader-open-after-import",
        waitedForWorkerWarm: options.waitForWorkerWarm,
        libraryWaitMs: options.libraryWaitMs,
        hoverPrefetch: options.hoverPrefetch,
        publisherBookStylingEnabled: options.publisherBookStylingEnabled,
        runs,
      };
      const reportPath = path.resolve(
        options.outputDirectory,
        "reader-startup-benchmark.json",
      );
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify(report, null, 2));
    } finally {
      await browser.close();
    }
  } finally {
    if (server) {
      server.kill();
      await server.exited.catch(() => undefined);
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

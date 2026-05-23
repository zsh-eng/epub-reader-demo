import { chromium, type Page } from "@playwright/test";
import { spawn, type Subprocess } from "bun";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface CliOptions {
  epub: string;
  from?: number;
  to?: number;
  chapter?: number;
  pagesFromReport?: string;
  out?: string;
  dumpOut?: string;
  dumpsDir?: string;
  stopOnFirstFailure: boolean;
  includeDumps: boolean;
  headed: boolean;
  keepServer: boolean;
  startServer: boolean;
  url: string;
  timeoutMs: number;
}

interface DiagnosticScanIssue {
  code: string;
  severity: string;
  message: string;
  page: number | null;
  slotIndex?: number;
  sliceIndex?: number;
  blockId?: string;
  details?: Record<string, unknown>;
}

interface DiagnosticScanFailure {
  page: number;
  validation: {
    ok: boolean;
    issues: DiagnosticScanIssue[];
    summary: Record<string, unknown>;
    suspectSlice?: unknown;
  };
  dump?: unknown;
}

interface DiagnosticScanResult {
  ok: boolean;
  pagesScanned: number;
  totalPages: number;
  failures: DiagnosticScanFailure[];
}

const DEFAULT_URL = "http://127.0.0.1:5173/diagnostics/reader";

function printHelp(): never {
  console.log(`Usage:
  bun run diagnostics:reader -- --epub <path> [options]

Options:
  --epub <path>              EPUB file to scan. Required.
  --from <page>              First global page to scan. Defaults to 1.
  --to <page>                Last global page to scan. Defaults to all pages.
  --chapter <index>          Scan a zero-based chapter index instead of a page range.
  --pages-from-report <path> Scan the failed pages listed in a previous report.
  --out <path>               Write compact JSON report to this path.
  --dump-out <path>          Write the first failing full Reader Page Debug Dump.
  --dumps-dir <path>         Write one full Reader Page Debug Dump per failing page.
  --stop-on-first-failure    Stop scanning after the first failing page.
  --include-dumps            Include full dumps for all failures in the JSON report.
  --url <url>                Existing diagnostic route URL. Defaults to ${DEFAULT_URL}.
  --no-start-server          Do not start bun run dev automatically.
  --keep-server              Leave the auto-started dev server running.
  --headed                   Run Chromium headed.
  --timeout-ms <ms>          Readiness/navigation timeout. Defaults to 30000.
  --help                     Show this help.
`);
  process.exit(0);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    epub: "",
    stopOnFirstFailure: false,
    includeDumps: false,
    headed: false,
    keepServer: false,
    startServer: true,
    url: DEFAULT_URL,
    timeoutMs: 30_000,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
      case "--epub":
        options.epub = readOptionValue(args, index, arg);
        index += 1;
        break;
      case "--from":
        options.from = parsePositiveInteger(
          readOptionValue(args, index, arg),
          arg,
        );
        index += 1;
        break;
      case "--to":
        options.to = parsePositiveInteger(readOptionValue(args, index, arg), arg);
        index += 1;
        break;
      case "--chapter":
        options.chapter = parsePositiveInteger(
          readOptionValue(args, index, arg),
          arg,
        );
        index += 1;
        break;
      case "--pages-from-report":
        options.pagesFromReport = readOptionValue(args, index, arg);
        index += 1;
        break;
      case "--out":
        options.out = readOptionValue(args, index, arg);
        index += 1;
        break;
      case "--dump-out":
        options.dumpOut = readOptionValue(args, index, arg);
        index += 1;
        break;
      case "--dumps-dir":
        options.dumpsDir = readOptionValue(args, index, arg);
        index += 1;
        break;
      case "--url":
        options.url = readOptionValue(args, index, arg);
        index += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = parsePositiveInteger(
          readOptionValue(args, index, arg),
          arg,
        );
        index += 1;
        break;
      case "--stop-on-first-failure":
        options.stopOnFirstFailure = true;
        break;
      case "--include-dumps":
        options.includeDumps = true;
        break;
      case "--headed":
        options.headed = true;
        break;
      case "--keep-server":
        options.keepServer = true;
        break;
      case "--no-start-server":
        options.startServer = false;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.epub) {
    throw new Error("--epub is required.");
  }

  return options;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
}

async function readFailedPagesFromReport(reportPath: string): Promise<number[]> {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    scan?: {
      failures?: Array<{ page?: unknown }>;
    };
  };
  const pages = new Set<number>();

  for (const failure of report.scan?.failures ?? []) {
    if (typeof failure.page === "number" && Number.isInteger(failure.page)) {
      pages.add(failure.page);
    }
  }

  return [...pages].sort((a, b) => a - b);
}

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await Bun.sleep(250);
  }

  throw new Error(
    `Timed out waiting for ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function startDevServerIfNeeded(options: CliOptions): Subprocess | null {
  if (!options.startServer) return null;

  return spawn(["bun", "run", "dev", "--", "--host", "127.0.0.1"], {
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function drainServerOutput(process: Subprocess): Promise<void> {
  const consume = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    for await (const _chunk of stream) {
      // Keep the pipe drained without echoing noisy Vite output.
    }
  };

  void consume(process.stdout);
  void consume(process.stderr);
}

function compactFailure(failure: DiagnosticScanFailure) {
  return {
    page: failure.page,
    issueCodes: failure.validation.issues.map((issue) => issue.code),
    issues: failure.validation.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      blockId: issue.blockId,
      sliceIndex: issue.sliceIndex,
      details: issue.details,
    })),
    summary: failure.validation.summary,
  };
}

function compactScanResult(scan: DiagnosticScanResult) {
  return {
    ok: scan.ok,
    pagesScanned: scan.pagesScanned,
    totalPages: scan.totalPages,
    failureCount: scan.failures.length,
    failures: scan.failures.map(compactFailure),
  };
}

async function scanSpecificPages(options: {
  page: Page;
  pages: number[];
  stopOnFirstFailure: boolean;
  includeDumps: boolean;
  timeoutMs: number;
}): Promise<DiagnosticScanResult> {
  const { page, ...scanOptions } = options;

  return page.evaluate(async (scanOptions) => {
    const harness = window.__EPUB_READER_DIAGNOSTICS__;
    const state = harness.getState();
    const failures = [];
    let pagesScanned = 0;

    for (const pageNumber of scanOptions.pages) {
      const dump = await harness.goToPage(pageNumber, {
        timeoutMs: scanOptions.timeoutMs,
      });
      const validation = harness.validateCurrentPage();
      pagesScanned += 1;

      if (validation.ok) continue;

      failures.push({
        page: pageNumber,
        validation,
        ...(scanOptions.includeDumps || failures.length === 0 ? { dump } : {}),
      });

      if (scanOptions.stopOnFirstFailure) break;
    }

    return {
      ok: failures.length === 0,
      pagesScanned,
      totalPages: state.totalPages,
      failures,
    };
  }, scanOptions);
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  const server = startDevServerIfNeeded(options);
  if (server) await drainServerOutput(server);

  try {
    if (server) {
      await waitForHttpOk(options.url, options.timeoutMs);
    }

    const browser = await chromium.launch({ headless: !options.headed });
    const page = await browser.newPage();

    try {
      const epubBytes = await readFile(options.epub);
      await page.goto(options.url, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => Boolean(window.__EPUB_READER_DIAGNOSTICS__),
        { timeout: options.timeoutMs },
      );

      const loadResult = await page.evaluate(
        async (payload) => {
          return window.__EPUB_READER_DIAGNOSTICS__.loadEpub({
            name: payload.name,
            bytes: new Uint8Array(payload.bytes),
          });
        },
        {
          name: path.basename(options.epub),
          bytes: Array.from(epubBytes),
        },
      );

      await page.evaluate(
        async (timeoutMs) => {
          await window.__EPUB_READER_DIAGNOSTICS__.waitForReady({ timeoutMs });
        },
        options.timeoutMs,
      );

      const state = await page.evaluate(() =>
        window.__EPUB_READER_DIAGNOSTICS__.getState(),
      );
      const pagesFromReport = options.pagesFromReport
        ? await readFailedPagesFromReport(options.pagesFromReport)
        : null;
      const scan = pagesFromReport
        ? await scanSpecificPages({
            page,
            pages: pagesFromReport,
            stopOnFirstFailure: options.stopOnFirstFailure,
            includeDumps: options.includeDumps || Boolean(options.dumpsDir),
            timeoutMs: options.timeoutMs,
          })
        : await page.evaluate(async (scanOptions) => {
            const harness = window.__EPUB_READER_DIAGNOSTICS__;
            if (scanOptions.chapter !== undefined) {
              return harness.scanChapter({
                chapterIndex: scanOptions.chapter,
                stopOnFirstFailure: scanOptions.stopOnFirstFailure,
                includeDumps:
                  scanOptions.includeDumps || Boolean(scanOptions.dumpsDir),
                timeoutMs: scanOptions.timeoutMs,
              });
            }

            return harness.scanPages({
              from: scanOptions.from,
              to: scanOptions.to,
              stopOnFirstFailure: scanOptions.stopOnFirstFailure,
              includeDumps:
                scanOptions.includeDumps || Boolean(scanOptions.dumpsDir),
              timeoutMs: scanOptions.timeoutMs,
            });
          }, options);

      const report = {
        epub: path.resolve(options.epub),
        scannedAt: new Date().toISOString(),
        loadResult,
        state,
        scan: options.includeDumps ? scan : compactScanResult(scan),
      };

      if (options.out) {
        await ensureParentDirectory(options.out);
        await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`);
      }

      if (options.dumpOut) {
        const firstDump = scan.failures[0]?.dump;
        if (firstDump) {
          await ensureParentDirectory(options.dumpOut);
          await writeFile(
            options.dumpOut,
            `${JSON.stringify(firstDump, null, 2)}\n`,
          );
        }
      }

      if (options.dumpsDir) {
        await mkdir(options.dumpsDir, { recursive: true });
        for (const failure of scan.failures) {
          if (!failure.dump) continue;
          const dumpPath = path.join(
            options.dumpsDir,
            `page-${String(failure.page).padStart(4, "0")}.json`,
          );
          await writeFile(dumpPath, `${JSON.stringify(failure.dump, null, 2)}\n`);
        }
      }

      console.log(JSON.stringify(report, null, 2));
      process.exitCode = scan.ok ? 0 : 1;
    } finally {
      await browser.close();
    }
  } finally {
    if (server && !options.keepServer) {
      server.kill();
      await server.exited.catch(() => {});
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

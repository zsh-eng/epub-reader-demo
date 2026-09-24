// Setup and interpretation: docs/validation/HIGHLIGHTERS.md
import { build } from "vite";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { cpus, platform, arch } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const isolated = resolve(".benchmarks/highlighters");
const output = resolve(process.argv[2] ?? ".benchmarks/highlighters/results");
const qualityOnly = process.argv.includes("--quality-only");
const engines = ["shiki", "twinkleplop"];
await mkdir(output, { recursive: true });
const corpus = [
  ["med blame", "src/web/components/BlameTooltips.tsx", "tsx"],
  ["med App", "src/web/App.tsx", "tsx"],
  ["med controller", "src/web/data/controller.ts", "typescript"],
  ["Bun HTTP/2", ".benchmarks/bun/src/js/node/http2.ts", "typescript"],
  ["med CSS", "src/web/reset.css", "css"],
  ["med package", "package.json", "json"],
  ["med guide", "docs/AGENT_INTEGRATION.md", "markdown"],
];
const files = await Promise.all(
  corpus.map(async ([name, path, lang]) => {
    const source = await readFile(path, "utf8");
    return {
      name,
      path,
      lang,
      source,
      bytes: Buffer.byteLength(source),
      lines: source.split("\n").length,
      sha256: createHash("sha256").update(source).digest("hex"),
    };
  }),
);
const probe = [
  "// Unicode, templates, regex, generics, and TSX",
  "type Props<T> = { value: T; title: string };",
  'const greeting = "Hello 😀 café 中文";',
  "const pattern = /[a-z]+/giu;",
  "/* comment across",
  "   an empty line below */",
  "",
  "export function Widget<T>({ value, title }: Props<T>) {",
  "  const label = `value: ${String(value)}`;",
  "  return <section title={title}>",
  "    <strong>{greeting}</strong>",
  "    {pattern.test(label) && <span>{label}</span>}",
  "  </section>;",
  "}",
  "",
].join("\n");
const probes = [
  { name: "TSX constructs", lang: "tsx", source: probe },
  { name: "CRLF and empty lines", lang: "tsx", source: probe.replaceAll("\n", "\r\n") },
  {
    name: "Incomplete edit",
    lang: "typescript",
    source: "const text = `unfinished ${value\n\n// still editing\n",
  },
  {
    name: "Long line then empty line",
    lang: "typescript",
    source: `const text = "${"abc😀".repeat(5000)}";\n\nconst next = 1;\n`,
  },
  {
    name: "Markdown embedded code",
    lang: "markdown",
    source: "# Example\n\n```ts\nconst answer: number = 42;\n```\n\n**bold** and `inline`\n",
  },
];
const bundles = {};
for (const engine of engines) {
  const aliases = { "benchmark-engine": resolve(`scripts/highlighters/${engine}.mjs`) };
  for (const name of ["typescript", "tsx", "css", "json", "markdown", "core"]) {
    const directory = join(isolated, `node_modules/@twinkleplop/${name}`);
    const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    aliases[`@twinkleplop/${name}`] = join(directory, metadata.exports["."].import);
  }
  // Match only exact package names, preserving core subpath exports.
  await build({
    configFile: false,
    logLevel: "error",
    resolve: {
      alias: Object.entries(aliases).map(([name, replacement]) => ({
        find: new RegExp(`^${name}$`),
        replacement,
      })),
    },
    build: {
      target: "esnext",
      minify: true,
      outDir: output,
      emptyOutDir: false,
      lib: {
        entry: resolve("scripts/highlighters/worker.mjs"),
        formats: ["es"],
        fileName: () => `${engine}.js`,
      },
    },
  });
  const bundle = await readFile(join(output, `${engine}.js`));
  bundles[engine] = { bytes: bundle.length, gzipBytes: gzipSync(bundle).length };
}
const server = createServer(async (req, res) => {
  const name = req.url?.slice(1);
  if (!engines.some((engine) => name === `${engine}.js`)) {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><meta charset="utf-8"><title>Highlighter benchmark</title>');
    return;
  }
  res.setHeader("Content-Type", "text/javascript");
  res.setHeader("Cache-Control", "no-store");
  res.end(await readFile(join(output, name)));
});
await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
const browser = await chromium.launch({ headless: true });
const result = {
  mode: qualityOnly ? "quality-only" : "full",
  date: new Date().toISOString(),
  machine: {
    cpu: cpus()[0].model,
    platform: platform(),
    arch: arch(),
    node: process.version,
    chromium: browser.version(),
  },
  revisions: Object.fromEntries(
    [
      ["med", root],
      ["bun", resolve(".benchmarks/bun")],
    ].map(([name, path]) => [
      name,
      execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    ]),
  ),
  versions: {},
  bundles,
  corpus: files.map(({ source: _source, ...metadata }) => metadata),
  startup: {},
  runs: {},
  quality: {},
};
for (const [name, path] of [
  ["shiki", dirname(fileURLToPath(import.meta.resolve("shiki/package.json")))],
  ["core", `${isolated}/node_modules/@twinkleplop/core`],
  ["languages", `${isolated}/node_modules/@twinkleplop/typescript`],
])
  result.versions[name] = JSON.parse(await readFile(`${path}/package.json`, "utf8")).version;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 700 } });
  page.on("console", (message) => console.log(message.text()));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const run = (engine, data) =>
    page.evaluate(
      async ({ engine, data }) => {
        const begin = performance.now();
        const worker = new Worker(`/${engine}.js`, { type: "module" });
        return new Promise((accept, reject) => {
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error(`${engine} timed out`));
          }, 180000);
          let readyMs;
          const finish = (value, error) => {
            clearTimeout(timer);
            worker.terminate();
            if (error) reject(error);
            else accept(value);
          };
          worker.onerror = (event) => finish(null, new Error(event.message));
          worker.onmessage = ({ data: response }) => {
            if (response.ready) {
              readyMs = performance.now() - begin;
              worker.postMessage(data);
            } else if (response.progress) console.log(`${engine}: ${response.progress}`);
            else if (response.error) finish(null, new Error(response.error));
            else finish({ readyMs, totalMs: performance.now() - begin, ...response });
          };
        });
      },
      { engine, data },
    );
  // Alternate engines, use fresh workers. Browser/disk caches are not OS-cold.
  for (const engine of engines) result.startup[engine] = [];
  for (let i = 0; i < (qualityOnly ? 0 : 7); i++) {
    for (const engine of i % 2 ? [...engines].reverse() : engines)
      result.startup[engine].push(await run(engine, { action: "first", ...files[0] }));
  }
  // Two rounds reverse engine order to expose thermal/order effects.
  for (let round = 0; round < (qualityOnly ? 0 : 2); round++) {
    for (const engine of round ? [...engines].reverse() : engines) {
      result.runs[engine] ??= [];
      result.runs[engine].push(await run(engine, { action: "benchmark", files }));
    }
  }
  const visual = {};
  for (const engine of engines) {
    result.quality[engine] = [];
    for (const sample of probes) {
      const inspected = await run(engine, { action: "inspect", ...sample });
      const dom = await page.evaluate(
        ({ html, source }) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          const text = doc.querySelector("code")?.textContent;
          const expected = source.replaceAll("\r\n", "\n");
          let firstMismatch = 0;
          while (
            firstMismatch < expected.length &&
            expected[firstMismatch] === text?.[firstMismatch]
          )
            firstMismatch++;
          return {
            preservesText: text === expected,
            expectedLines: expected.split("\n").length,
            actualLines: text?.split("\n").length,
            mismatch:
              text === expected
                ? null
                : {
                    offset: firstMismatch,
                    expected: expected.slice(firstMismatch, firstMismatch + 50),
                    actual: text?.slice(firstMismatch, firstMismatch + 50),
                  },
            spanCount: doc.querySelectorAll("span").length,
          };
        },
        { html: inspected.html, source: sample.source },
      );
      const invalid = inspected.spans.filter(
        (span, i, all) =>
          span.start < 0 ||
          span.end < span.start ||
          span.end > sample.source.length ||
          (i > 0 && span.start < all[i - 1].end),
      );
      const markers =
        sample.name === "TSX constructs"
          ? [
              "// Unicode",
              "Props",
              '"Hello 😀 café 中文"',
              "/[a-z]+/giu",
              "export",
              "Widget",
              "section",
              "strong",
            ]
          : sample.name === "Markdown embedded code"
            ? ["const", "number", "42"]
            : [];
      result.quality[engine].push({
        name: sample.name,
        ...dom,
        invalidRanges: invalid.length,
        markers: markers.map((marker) => ({
          marker,
          types: inspected.spans
            .filter(
              (span) =>
                span.start < sample.source.indexOf(marker) + marker.length &&
                span.end > sample.source.indexOf(marker),
            )
            .map((span) => span.type),
        })),
      });
      if (sample.name === "TSX constructs") visual[engine] = inspected.html;
    }
  }
  const css = await readFile(
    join(isolated, "node_modules/@twinkleplop/theme-github/dist/dark.css"),
    "utf8",
  );
  const visualHtml = `<!doctype html><meta charset="utf-8"><title>Syntax comparison</title><style>${css}\nbody{margin:0;padding:28px;background:#0d1117;color:#e6edf3;font:15px system-ui}h1{font-size:24px}p{color:#8b949e}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}section{min-width:0}pre{border:1px solid #30363d;border-radius:8px;padding:18px;overflow:auto;min-height:410px;font:13px/1.7 ui-monospace,monospace}h2{font-size:18px}</style><h1>Shiki / Twinkleplop</h1><p>GitHub Dark · identical source · default Shiki styling / full-detail Twinkleplop styling</p><div class="grid"><section><h2>Shiki 4.4.3</h2>${visual.shiki}</section><section><h2>Twinkleplop 0.1.4 (core 0.2.1)</h2>${visual.twinkleplop}</section></div>`;
  await writeFile(join(output, "comparison.html"), visualHtml);
  await page.setContent(visualHtml);
  await page.screenshot({ path: join(output, "comparison.png"), fullPage: true });
  await writeFile(join(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
  for (const engine of engines) {
    if (qualityOnly) continue;
    console.log(
      engine,
      "startup ms",
      result.startup[engine].map((row) => row.totalMs),
    );
    console.log(
      engine,
      "warm",
      result.runs[engine].map((run) =>
        run.rows.map((row) => [row.name, row.tokens.medianMs, row.html.medianMs]),
      ),
    );
  }
  console.log(`Saved benchmark to ${output}`);
} finally {
  await browser.close();
  await new Promise((accept) => server.close(accept));
}

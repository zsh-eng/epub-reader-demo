import { build } from "rolldown";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
// No checkout, build, or execution of the repository's code. All writes use an isolated cache.
const repo = resolve(process.argv[2] ?? ".benchmarks/bun");
const binDir = resolve(process.argv[3] ?? ".benchmarks/symbols-tools");
const output = resolve(process.argv[4] ?? "docs/validation/symbol-benchmark.json");
const dir = await mkdtemp(resolve(".benchmarks/symbol-benchmark-"));
await build({
  input: "src/host/search/service.ts",
  platform: "node",
  external: ["zod"],
  output: { file: join(dir, "service.mjs"), format: "esm" },
});
await build({
  input: "src/host/search/symbols.ts",
  platform: "node",
  external: ["zod"],
  output: { file: join(dir, "symbols.mjs"), format: "esm" },
});
const { ZoektSearchService } = await import(join(dir, "service.mjs"));
const { discoverCtags, FileSymbolService } = await import(join(dir, "symbols.mjs"));
const git = (...args) =>
  execFileSync("git", ["--no-optional-locks", "-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
const hash = (text) => createHash("sha256").update(text).digest("hex");
const fingerprint = () => ({
  head: git("rev-parse", "HEAD").trim(),
  refs: hash(git("show-ref")),
  status: hash(git("status", "--porcelain=v1", "-z")),
});
const before = fingerprint();
const tool = await discoverCtags();
if (!tool) throw new Error("Install Universal Ctags before this benchmark.");
const service = new ZoektSearchService(repo, {
  binDir,
  cacheRoot: join(dir, "cache"),
  debounceMs: 0,
  pollMs: 60000,
});
const start = performance.now();
const report = {
  capturedAt: new Date().toISOString(),
  platform: `${os.platform()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model,
  repo,
  commit: before.head,
  ctags: tool.version,
  buildMs: 0,
  indexBytes: 0,
  baselineBuildMs: 0,
  baselineIndexBytes: 0,
  fileExtraction: [],
  queries: [],
};
const summary = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
};
const bytes = async (path) => {
  let total = 0;
  for (const name of await readdir(path)) {
    const p = join(path, name);
    const s = await stat(p);
    total += s.isDirectory() ? await bytes(p) : s.size;
  }
  return total;
};
try {
  await service.start();
  for (;;) {
    const status = service.status();
    if (status.state === "ready") break;
    if (status.state === "error") throw new Error(JSON.stringify(status));
    if (performance.now() - start > 300000) throw new Error("Index timeout");
    await delay(100);
  }
  report.buildMs = performance.now() - start;
  const repositoryRoot = join(
    dir,
    "cache",
    "repositories",
    (await readdir(join(dir, "cache", "repositories")))[0],
  );
  report.indexBytes = await bytes(join(repositoryRoot, "index"));
  const source = { kind: "commit", repo, oid: before.head };
  const files = git("ls-tree", "-r", "--name-only", "HEAD").trim().split("\n");
  const sizes = git("ls-tree", "-rl", "HEAD")
    .split("\n")
    .flatMap((row) => {
      const match = /^\d+ blob [a-f0-9]+\s+(\d+)\t(.+)$/.exec(row);
      return match ? [{ size: Number(match[1]), path: match[2] }] : [];
    });
  for (const extension of [".ts", ".cpp", ".rs"]) {
    const candidates = files.filter((p) => p.startsWith("src/") && p.endsWith(extension));
    const small = candidates.sort((a, b) => a.length - b.length)[0];
    const large = sizes
      .filter(
        (row) => row.path.startsWith("src/") && row.path.endsWith(extension) && row.size <= 8388608,
      )
      .sort((a, b) => b.size - a.size)[0]?.path;
    for (const path of new Set([small, large])) {
      if (!path) continue;
      const fs = new FileSymbolService(tool);
      const samples = [];
      let count = 0;
      for (let i = 0; i < 11; i++) {
        const t = performance.now();
        const result = await fs.search({ source, path, query: "" });
        samples.push(performance.now() - t);
        count = result.matches.length;
        if (result.unavailable) throw new Error(result.unavailable);
      }
      report.fileExtraction.push({
        path,
        bytes: Buffer.byteLength(git("show", `HEAD:${path}`)),
        symbolCount: count,
        coldMs: samples[0],
        warm: summary(samples.slice(1)),
      });
    }
  }
  for (const query of ["setTimeout", "parse", "Bun", "MED_NO_SYMBOL_4e871"]) {
    const samples = [];
    let result;
    for (let i = 0; i < 21; i++) {
      const t = performance.now();
      result = await service.symbols(source, query);
      samples.push(performance.now() - t);
      if (result.unavailable) throw new Error(result.unavailable);
    }
    report.queries.push({
      query,
      count: result.matches.length,
      truncated: result.truncated,
      ...summary(samples.slice(1)),
    });
  }
  await service.close();
  const index = join(dir, "baseline-index");
  await mkdir(index);
  const args = [
    "-index",
    index,
    "-branches",
    service
      .status()
      .branches.map((b) => `med/${hash(b.name).slice(0, 24)}`)
      .join(","),
    "-submodules=false",
    "-disable_ctags",
    "-parallelism",
    "2",
    "-file_limit",
    "8388608",
    "-max_trigram_count",
    "1000000",
    "-incremental=false",
    join(repositoryRoot, "repository.git"),
  ];
  const t = performance.now();
  await new Promise((ok, fail) => {
    const child = spawn(join(binDir, "zoekt-git-index"), args, {
      env: { ...process.env, GOMAXPROCS: "2" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let error = "";
    child.stderr.on("data", (d) => (error += d));
    child.once("error", fail);
    child.once("close", (c) => (c === 0 ? ok() : fail(new Error(error))));
  });
  report.baselineBuildMs = performance.now() - t;
  report.baselineIndexBytes = await bytes(index);
  const symbolIndex = join(dir, "symbols-index-only");
  await mkdir(symbolIndex);
  const symbolArgs = args.map((arg) =>
    arg === index ? symbolIndex : arg === "-disable_ctags" ? "-require_ctags" : arg,
  );
  const symbolStart = performance.now();
  await new Promise((ok, fail) => {
    const child = spawn(join(binDir, "zoekt-git-index"), symbolArgs, {
      env: { ...process.env, GOMAXPROCS: "2", CTAGS_COMMAND: tool.path, SCIP_CTAGS_COMMAND: "" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let error = "";
    child.stderr.on("data", (d) => (error += d));
    child.once("error", fail);
    child.once("close", (c) => (c === 0 ? ok() : fail(new Error(error))));
  });
  report.symbolIndexOnlyBuildMs = performance.now() - symbolStart;
  report.buildComparisonNote =
    "One sample each; baseline and symbol-only indexes use the same already materialized private bare repository. Initial service buildMs includes clone, indexing, and helper startup. Filesystem caches are warm; order is baseline then symbols.";
  report.sourceUnchanged = JSON.stringify(before) === JSON.stringify(fingerprint());
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await service.close();
}

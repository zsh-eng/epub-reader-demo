import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

// Benchmark only: never checks out, builds, or executes the repository being searched.
// node scripts/benchmark-zoekt.mjs [repo] [binary-directory] [output]
const repo = resolve(process.argv[2] ?? ".benchmarks/bun");
const bin = resolve(process.argv[3] ?? ".benchmarks/zoekt-tools/bin");
const output = resolve(process.argv[4] ?? "docs/validation/zoekt-benchmark.json");
const run = resolve(`.benchmarks/zoekt-${Date.now()}`);
await mkdir(run, { recursive: true });
const bare = join(run, "bun.git");
const index = join(run, "index");
const queries = ["rewriteForProxiedHttp", "setTimeout", "export", "MED_NO_MATCH_7cd25ead8973"];
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GOMAXPROCS: "4" };
const git = (dir, ...args) =>
  execFileSync("git", ["--no-optional-locks", "-C", dir, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
const hash = (text) => createHash("sha256").update(text).digest("hex");
const searchStats = (result) =>
  Object.fromEntries(
    Object.entries(result).filter(([key]) => !["Files", "RepoURLs", "LineFragments"].includes(key)),
  );
const excludedLargeFiles = git(repo, "ls-tree", "-rl", "HEAD")
  .trim()
  .split("\n")
  .filter((line) => Number(line.split(/\s+/)[3]) > 8 * 1024 * 1024)
  .map((line) => line.slice(line.indexOf("\t") + 1));
const round = (n) => Math.round(n * 100) / 100;
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.map(round),
    medianMs: round(
      (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    ),
    minMs: round(sorted[0]),
    maxMs: round(sorted.at(-1)),
  };
};
async function fingerprint() {
  const indexPath = git(repo, "rev-parse", "--path-format=absolute", "--git-path", "index").trim();
  return {
    head: git(repo, "rev-parse", "HEAD").trim(),
    refs: hash(git(repo, "show-ref", "--head")),
    status: hash(git(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all")),
    worktrees: hash(git(repo, "worktree", "list", "--porcelain", "-z")),
    index: hash(await readFile(indexPath)),
  };
}
function command(executable, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const started = performance.now();
    const child = spawn(executable, args, {
      env,
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      lines = 0,
      firstLineMs = null,
      capped = false;
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (text.includes("\n") && firstLineMs === null) firstLineMs = performance.now() - started;
      lines += text.split("\n").length - 1;
      if (options.limit && lines >= options.limit && !capped) {
        capped = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !(options.allowNoMatch && code === 1) && !capped)
        return reject(new Error(`${executable} exited ${code}: ${stderr}`));
      resolvePromise({ ms: performance.now() - started, firstLineMs, stdout, stderr, capped });
    });
  });
}
async function bytesAt(path) {
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    bytes += entry.isDirectory() ? await bytesAt(child) : (await stat(child)).size;
  }
  return bytes;
}
const before = await fingerprint();
if (git(repo, "status", "--porcelain=v1", "--untracked-files=all").trim())
  throw new Error("Ripgrep comparison requires a clean checkout");
const report = {
  recordedAt: new Date().toISOString(),
  repo,
  run,
  hardware: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    ramBytes: os.totalmem(),
  },
  versions: {
    git: execFileSync("git", ["--version"], { encoding: "utf8" }).trim(),
    rg: execFileSync("rg", ["--version"], { encoding: "utf8" }).split("\n")[0],
    zoektBuild: execFileSync("go", ["version", "-m", join(bin, "zoekt-git-index")], {
      encoding: "utf8",
    }),
  },
  settings: {
    ctags: false,
    parallelism: 4,
    fileLimit: 8 * 1024 * 1024,
    maxTrigrams: 1_000_000,
    resultLimit: 200,
    trials: 10,
    queryCase: "insensitive",
    queryKind: "literal",
    caches: "OS cache not purged; warm repetitions; first request recorded separately",
  },
  before,
  excludedLargeFiles,
  builds: [],
  phases: [],
};
const save = () => writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
await mkdir(resolve(output, ".."), { recursive: true });
await command("git", ["clone", "--bare", "--shared", repo, bare]);
git(bare, "update-ref", "refs/heads/benchmark/b0", `${before.head}~1`);
git(bare, "symbolic-ref", "HEAD", "refs/heads/benchmark/b0");
const branches = ["benchmark/b0"];
for (let i = 1; i < 10; i++) {
  const name = `benchmark/b${i}`;
  branches.push(name);
  git(bare, "update-ref", `refs/heads/${name}`, `${before.head}~${i * 5}`);
}
report.branchCommits = branches.map((name) => ({
  name,
  commit: git(bare, "rev-parse", name).trim(),
}));
report.tree = git(repo, "ls-tree", "-rl", "HEAD")
  .trim()
  .split("\n")
  .reduce(
    (acc, line) => {
      const size = Number(line.split(/\s+/)[3]);
      acc.entries++;
      if (Number.isFinite(size)) acc.bytes += size;
      return acc;
    },
    { entries: 0, bytes: 0 },
  );
async function build(label, selected, extra = []) {
  console.log(`Index: ${label}`);
  await mkdir(index, { recursive: true });
  const timeLog = join(run, `${label}.time.txt`);
  const args = [
    "-index",
    index,
    "-branches",
    selected.join(","),
    "-submodules=false",
    "-disable_ctags",
    "-parallelism",
    "4",
    "-file_limit",
    "8388608",
    "-max_trigram_count",
    "1000000",
    ...extra,
    bare,
  ];
  const measured = await command("/usr/bin/time", [
    "-l",
    "-o",
    timeLog,
    join(bin, "zoekt-git-index"),
    ...args,
  ]);
  await writeFile(join(run, `${label}.log`), measured.stderr);
  const time = await readFile(timeLog, "utf8");
  const item = {
    label,
    args,
    wallMs: round(measured.ms),
    peakRssBytes: Number(/(\d+)\s+maximum resident set size/.exec(time)?.[1] ?? 0),
    indexBytes: await bytesAt(index),
    log: measured.stderr,
    resourceUsage: time,
  };
  report.builds.push(item);
  await save();
  console.log(
    JSON.stringify({
      label,
      wallMs: item.wallMs,
      peakRssBytes: item.peakRssBytes,
      indexBytes: item.indexBytes,
    }),
  );
}
await build("one-branch-initial", [branches[0]]);
await build("one-branch-unchanged", [branches[0]]);
git(bare, "update-ref", "refs/heads/benchmark/b0", before.head);
report.updatedBranchCommit = before.head;
report.updateFiles = git(repo, "diff", "--stat", "HEAD~1", "HEAD");
await build("one-commit-delta", [branches[0]], ["-delta"]);
let server;
const port = 6197;
async function api(route, body) {
  const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  return route === "list" ? payload.List : payload.Result;
}
async function start() {
  const started = performance.now();
  server = spawn(
    join(bin, "zoekt-webserver"),
    ["-index", index, "-listen", `127.0.0.1:${port}`, "-rpc"],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  server.stderr.on("data", (data) => {
    log += data;
  });
  server.stdout.on("data", (data) => {
    log += data;
  });
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null) throw new Error(log);
    try {
      const listing = await api("list", { Q: "" });
      if (listing.Repos?.length) return { startupMs: round(performance.now() - started), listing };
    } catch {
      /* Wait for the loopback service and initial index load. */
    }
    await delay(50);
  }
  throw new Error(`Server readiness timeout: ${log}`);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("close", done));
  server.kill("SIGTERM");
  await exited;
  server = null;
}
async function zoekt(query, allBranches = false, exhaustive = false) {
  const started = performance.now();
  const result = await api("search", {
    Q: `${allBranches ? "" : "branch:benchmark/b0 "}case:no content:${JSON.stringify(query)}`,
    Opts: {
      ShardMaxMatchCount: exhaustive ? 10_000_000 : 200,
      TotalMaxMatchCount: exhaustive ? 10_000_000 : 200,
      MaxMatchDisplayCount: exhaustive ? 0 : 200,
      MaxWallTime: 20_000_000_000,
    },
  });
  return { ms: performance.now() - started, result };
}
function direct(engine, query, exhaustive = false) {
  const options = { allowNoMatch: true, limit: exhaustive ? undefined : 200 };
  return engine === "git"
    ? command(
        "git",
        [
          "-C",
          bare,
          "-c",
          "grep.threads=4",
          "-c",
          "core.quotePath=false",
          "grep",
          "--no-textconv",
          "--no-recurse-submodules",
          "-I",
          "-F",
          "-i",
          "-n",
          "-e",
          query,
          before.head,
          "--",
          ".",
          ...excludedLargeFiles.map((path) => `:(exclude,literal)${path}`),
        ],
        options,
      )
    : command(
        "rg",
        [
          "--threads",
          "4",
          "--hidden",
          "--no-ignore",
          "--glob",
          "!.git",
          "--max-filesize",
          "8M",
          "--no-heading",
          "--with-filename",
          "--color",
          "never",
          "-F",
          "-i",
          "-n",
          "--",
          query,
          ".",
        ],
        { ...options, cwd: repo },
      );
}
async function phase(label, withDirect) {
  console.log(`Search: ${label}`);
  const phase = { label, ...(await start()), queries: [] };
  report.phases.push(phase);
  try {
    for (const query of queries) {
      const initial = await zoekt(query);
      if (!Array.isArray(initial.result.Files) && initial.result.Files !== null)
        throw new Error(`Unexpected API shape: ${JSON.stringify(initial.result).slice(0, 1000)}`);
      const engines = withDirect ? ["zoekt", "git", "rg"] : ["zoekt", "zoekt-all-branches"];
      const samples = Object.fromEntries(engines.map((engine) => [engine, []]));
      const firstLines = Object.fromEntries(engines.map((engine) => [engine, []]));
      for (let trial = 0; trial < 10; trial++) {
        const order = [
          ...engines.slice(trial % engines.length),
          ...engines.slice(0, trial % engines.length),
        ];
        for (const engine of order) {
          const result = engine.startsWith("zoekt")
            ? await zoekt(query, engine.endsWith("all-branches"))
            : await direct(engine, query);
          samples[engine].push(result.ms);
          if (result.firstLineMs !== null && result.firstLineMs !== undefined)
            firstLines[engine].push(result.firstLineMs);
        }
      }
      const row = {
        query,
        firstZoektRequestMs: round(initial.ms),
        initialStats: searchStats(initial.result),
        returnedLines:
          initial.result.Files?.reduce((n, file) => n + file.LineMatches.length, 0) ?? 0,
        timings: Object.fromEntries(engines.map((engine) => [engine, summarize(samples[engine])])),
        firstOutput: Object.fromEntries(
          engines
            .filter((engine) => firstLines[engine].length)
            .map((engine) => [engine, summarize(firstLines[engine])]),
        ),
      };
      if (withDirect) {
        const z = await zoekt(query, false, true);
        const g = await direct("git", query, true);
        const r = await direct("rg", query, true);
        const zLines = new Set(
          (z.result.Files ?? []).flatMap((file) =>
            file.LineMatches.map((line) => `${file.FileName}:${line.LineNumber}`),
          ),
        );
        const parse = (text, prefix) =>
          new Set(
            text
              .split("\n")
              .filter(Boolean)
              .map((line) =>
                line
                  .slice(prefix.length)
                  .match(/^(.*?):(\d+):/)
                  ?.slice(1)
                  .join(":"),
              )
              .filter(Boolean),
          );
        const gLines = parse(g.stdout, `${before.head}:`);
        const rLines = parse(r.stdout, "./");
        row.exhaustive = {
          zoektLines: zLines.size,
          gitLines: gLines.size,
          rgLines: rLines.size,
          fullResultMs: { zoekt: round(z.ms), git: round(g.ms), rg: round(r.ms) },
          zoektStats: searchStats(z.result),
          zoektMissingVsGit: [...gLines].filter((line) => !zLines.has(line)),
          zoektExtraVsGit: [...zLines].filter((line) => !gLines.has(line)),
          rgMissingVsGit: [...gLines].filter((line) => !rLines.has(line)),
          rgExtraVsGit: [...rLines].filter((line) => !gLines.has(line)),
        };
      }
      phase.queries.push(row);
      await save();
      console.log(
        JSON.stringify({
          phase: label,
          query,
          timings: row.timings,
          counts: row.exhaustive && [
            row.exhaustive.zoektLines,
            row.exhaustive.gitLines,
            row.exhaustive.rgLines,
          ],
        }),
      );
    }
    phase.serverRssKiB = Number(
      execFileSync("ps", ["-o", "rss=", "-p", String(server.pid)], { encoding: "utf8" }).trim(),
    );
  } finally {
    await stop();
  }
  await save();
}
try {
  await phase("one-branch", true);
  await build("ten-branches-delta-request", branches, ["-delta"]);
  await phase("ten-branches", false);
  await build("ten-branches-unchanged", branches);
  report.after = await fingerprint();
  report.sourceUnchanged = JSON.stringify(before) === JSON.stringify(report.after);
  if (!report.sourceUnchanged)
    throw new Error("Source repository state changed during the benchmark");
  await save();
  console.log(`Complete: ${output}`);
} finally {
  await stop();
}

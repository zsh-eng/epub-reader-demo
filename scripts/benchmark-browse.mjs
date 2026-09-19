import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";

// node scripts/benchmark-browse.mjs [repo] [output] [readPath] [fixtureRepo] [...fixturePaths]
const repo = resolve(process.argv[2] ?? ".benchmarks/bun");
const output = resolve(process.argv[3] ?? "docs/validation/browse-benchmark.json");
const readPath = process.argv[4] ?? "README.md";
const fixtureRepo = resolve(process.argv[5] ?? ".test-artifacts/ui-worktrees/med-demo");
const fixturePaths = process.argv.slice(6);
const git = (directory, ...args) =>
  execFileSync("git", ["--no-optional-locks", "-C", directory, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const rounded = (value) => Math.round(value * 100) / 100;
function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    minMs: sorted[0],
    medianMs: sorted[Math.floor(sorted.length / 2)],
    maxMs: sorted.at(-1),
  };
}
async function integrity(directory) {
  const worktrees = git(directory, "worktree", "list", "--porcelain", "-z")
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice(9));
  return {
    refsHash: hash(git(directory, "show-ref", "--head")),
    worktrees: await Promise.all(
      worktrees.map(async (path) => {
        const indexPath = git(
          path,
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "index",
        ).trim();
        return {
          path,
          head: git(path, "rev-parse", "HEAD").trim(),
          statusHash: hash(git(path, "status", "--porcelain=v1", "-z", "--untracked-files=all")),
          indexHash: existsSync(indexPath) ? hash(await readFile(indexPath)) : null,
        };
      }),
    ),
  };
}
async function withHost(directory, work) {
  const child = spawn(process.execPath, ["dist/cli.js", directory, "--port", "0", "--no-open"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const launched = performance.now();
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr = (stderr + String(data)).slice(-64 * 1024);
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 180_000);
  try {
    const url = await new Promise((resolveUrl, reject) => {
      let text = "";
      const timer = setTimeout(
        () => reject(new Error(`Host startup timed out: ${stderr}`)),
        30_000,
      );
      child.stdout.on("data", (data) => {
        text = (text + String(data)).slice(-64 * 1024);
        const match = text.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
        if (match) {
          clearTimeout(timer);
          resolveUrl(new URL(match[0]));
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Host exited ${code}: ${stderr}`));
      });
    });
    const readyMs = rounded(performance.now() - launched);
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    url.hash = "";
    async function request(path, body) {
      const start = performance.now();
      const response = await fetch(new URL(path, url), {
        method: body ? "POST" : "GET",
        signal: AbortSignal.timeout(35_000),
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const headersAt = performance.now();
      const bytes = await response.arrayBuffer();
      const bodyAt = performance.now();
      const value = JSON.parse(new TextDecoder().decode(bytes));
      const end = performance.now();
      if (!response.ok) throw new Error(JSON.stringify(value));
      return {
        value,
        timing: {
          requestMs: rounded(end - start),
          headersMs: rounded(headersAt - start),
          bodyMs: rounded(bodyAt - headersAt),
          decodeMs: rounded(end - bodyAt),
          responseBytes: bytes.byteLength,
        },
      };
    }
    return await work(request, readyMs);
  } finally {
    clearTimeout(deadline);
    child.kill("SIGTERM");
    await new Promise((done) => {
      if (child.exitCode !== null || child.signalCode !== null) return done();
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        done();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
    });
  }
}
async function measure(directory) {
  const before = await integrity(directory);
  const data = await withHost(directory, async (request, readyMs) => {
    const head =
      before.worktrees.find((tree) => resolve(tree.path) === directory)?.head ??
      git(directory, "rev-parse", "HEAD").trim();
    const scopes = [];
    for (const source of [
      { kind: "worktree", repo: directory },
      { kind: "commit", repo: directory, oid: head },
    ]) {
      const manifest = [];
      for (let sample = 0; sample < 3; sample++) {
        const { value, timing } = await request("/api/browse/list", { source });
        manifest.push({
          phase: sample === 0 ? "first-source-request" : "repeat",
          sample,
          ...timing,
          entries: value.entries.length,
          files: value.entries.filter((entry) => entry.kind === "file").length,
          truncated: value.truncated,
        });
      }
      const reads = [];
      for (let sample = 0; sample < 5; sample++) {
        const { value, timing } = await request("/api/browse/read", { source, path: readPath });
        if (value.kind !== "text")
          throw new Error(`Benchmark read ${readPath} returned ${value.kind}`);
        reads.push({
          phase: sample === 0 ? "first-file-request" : "repeat",
          sample,
          path: value.path,
          sizeBytes: value.size,
          kind: value.kind,
          plain: value.plain,
          identity: value.identity,
          ...timing,
        });
      }
      scopes.push({
        source,
        manifest,
        firstManifestMs: manifest[0].requestMs,
        repeatManifest: summary(manifest.slice(1).map((sample) => sample.requestMs)),
        reads,
        readSummary: summary(reads.map((sample) => sample.requestMs)),
      });
    }
    return { readyMs, scopes };
  });
  const after = await integrity(directory);
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!unchanged)
    throw new Error("Repository refs, status, or index changed during the benchmark.");
  return { ...data, integrity: { unchanged, before, after } };
}
const result = {
  measuredAt: new Date().toISOString(),
  scope:
    "Production host HTTP only: Git/filesystem, JSON transfer and decode. Excludes browser source parsing, highlighting, layout and paint. First worktree manifest is the first request to a new host; OS disk caches are not flushed. Repeat samples still repeat Git/filesystem work; this API has no manifest cache. Commit source runs after worktree source in the same host. Timing phases are client observations, not server CPU time.",
  runtime: process.version,
  hardware: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model,
    memoryBytes: os.totalmem(),
  },
  repository: {
    path: repo,
    trackedFiles: git(repo, "ls-files", "-z").split("\0").filter(Boolean).length,
  },
  ...(await measure(repo)),
};
if (existsSync(resolve(fixtureRepo, ".git"))) {
  const before = await integrity(fixtureRepo);
  const reads = fixturePaths.length
    ? await withHost(fixtureRepo, async (request) => {
        await request("/api/session");
        return await Promise.all(
          fixturePaths.map(async (path) => {
            const { value, timing } = await request("/api/browse/read", {
              source: { kind: "worktree", repo: fixtureRepo },
              path,
            });
            if (value.kind !== "text" && value.text !== undefined)
              throw new Error(`Expected metadata-only response for ${path}`);
            if (value.kind === "missing") throw new Error(`Fixture ${path} is missing`);
            return {
              path,
              kind: value.kind,
              sizeBytes: value.size,
              hasText: value.text !== undefined,
              plain: value.plain,
              ...timing,
            };
          }),
        );
      })
    : [];
  const after = await integrity(fixtureRepo);
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!unchanged) throw new Error("UI fixture changed during file reads.");
  result.fixture = {
    reads,
    integrity: { unchanged, before, after },
    note: reads.length
      ? "Fixture file reads. Binary and too-large responses verified to omit text."
      : "Read-only snapshot of fixture refs, working status and index. Pass fixture paths to measure binary/large responses.",
  };
}
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output,
      readyMs: result.readyMs,
      scopes: result.scopes.map(
        ({ source, manifest, firstManifestMs, repeatManifest, readSummary }) => ({
          kind: source.kind,
          entries: manifest[0].entries,
          files: manifest[0].files,
          firstManifestMs,
          repeatManifest,
          readSummary,
        }),
      ),
      unchanged: result.integrity.unchanged,
      fixtureUnchanged: result.fixture?.integrity.unchanged,
    },
    null,
    2,
  ),
);

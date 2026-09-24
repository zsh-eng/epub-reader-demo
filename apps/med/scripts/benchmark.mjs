import { spawn, execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";

const repo = resolve(process.argv[2] ?? ".benchmarks/bun");
const output = resolve(process.argv[3] ?? "docs/validation/benchmark.json");
const git = (...args) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }).trim();
const before = git("rev-parse", "HEAD");
const launched = performance.now();
const child = spawn(process.execPath, ["dist/cli.js", repo, "--port", "0", "--no-open"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (data) => {
  stderr += data;
});
const url = await new Promise((resolveUrl, reject) => {
  let text = "";
  const timer = setTimeout(() => reject(new Error(`Host startup timed out: ${stderr}`)), 30000);
  child.stdout.on("data", (data) => {
    text += data;
    const match = text.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
    if (match) {
      clearTimeout(timer);
      resolveUrl(new URL(match[0]));
    }
  });
  child.once("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`Host exited ${code}: ${stderr}`));
  });
});
const readyMs = performance.now() - launched;
const token = new URLSearchParams(url.hash.slice(1)).get("token") ?? url.hash.slice(1);
url.hash = "";
async function request(path, body) {
  const start = performance.now();
  const response = await fetch(new URL(path, url), {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return { value, ms: performance.now() - start };
}
function rss() {
  try {
    return (
      Number(
        execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8" }).trim(),
      ) * 1024
    );
  } catch {
    return null;
  }
}
function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95Ms: sorted[Math.ceil((sorted.length - 1) * 0.95)],
    maxMs: sorted.at(-1),
  };
}
try {
  const baselineRss = rss();
  const session = await request("/api/session");
  const history = await request(`/api/history?repo=${encodeURIComponent(repo)}&limit=60`);
  const commits = history.value.commits.slice(0, 24);
  const cold = [];
  const warm = [];
  const failures = [];
  for (const commit of commits) {
    try {
      const result = await request("/api/review", {
        repo,
        comparison: { kind: "commit", commit: commit.id },
      });
      cold.push({
        commit: commit.id,
        subject: commit.subject,
        requestMs: result.ms,
        files: result.value.files.length,
        ...result.value.metrics,
        rssBytes: rss(),
      });
    } catch (error) {
      failures.push({ commit: commit.id, error: String(error) });
    }
  }
  for (const sample of cold) {
    const result = await request("/api/review", {
      repo,
      comparison: { kind: "commit", commit: sample.commit },
    });
    warm.push({
      commit: sample.commit,
      requestMs: result.ms,
      ...result.value.metrics,
      rssBytes: rss(),
    });
  }
  const result = {
    measuredAt: new Date().toISOString(),
    scope:
      "Packaged production host HTTP requests, including JSON transfer/decode; excludes browser parse, syntax and paint. Cold means first request in this host, not cold OS disk cache.",
    runtime: process.version,
    hardware: {
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
      memoryBytes: os.totalmem(),
    },
    repository: {
      name: session.value.repository.name,
      head: before,
      after: git("rev-parse", "HEAD"),
      unchanged: before === git("rev-parse", "HEAD"),
      shallow: git("rev-parse", "--is-shallow-repository") === "true",
      commits: Number(git("rev-list", "--count", "HEAD")),
      trackedFiles: git("ls-files", "-z").split("\0").filter(Boolean).length,
    },
    startup: {
      readyMs,
      sessionMs: session.ms,
      historyMs: history.ms,
      historyCount: history.value.commits.length,
      baselineRssBytes: baselineRss,
    },
    cold: summary(cold.map((s) => s.requestMs)),
    warm: summary(warm.map((s) => s.requestMs)),
    coldSamples: cold,
    warmSamples: warm,
    failures,
    finalRssBytes: rss(),
  };
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output,
        startup: result.startup,
        cold: result.cold,
        warm: result.warm,
        failures,
        unchanged: result.repository.unchanged,
      },
      null,
      2,
    ),
  );
} finally {
  child.kill("SIGTERM");
  await new Promise((resolveExit) => {
    if (child.exitCode !== null) return resolveExit();
    child.once("exit", resolveExit);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolveExit();
    }, 5000).unref();
  });
}

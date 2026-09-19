import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, open, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as watchRuntime from "../../src/host/runtime/watch";
import { browseReadRequestSchema } from "../../src/shared/browse";
import {
  listBrowse,
  MAX_FILE_BYTES,
  MAX_FILE_LINES,
  MAX_FILE_LINE_LENGTH,
  readBrowse,
} from "../../src/host/repository/browse";
import { startHost, type RunningHost } from "../../src/host/server";

const temporary: string[] = [];
const hosts: RunningHost[] = [];
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "med-browse-")));
  temporary.push(root);
  const repo = join(root, "main");
  await mkdir(repo);
  git(repo, "init", "-q", "-b", "main");
  await mkdir(join(repo, "src"));
  await writeFile(join(repo, "src/file.txt"), "committed\n");
  await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "initial");
  return { root, repo, oid: git(repo, "rev-parse", "HEAD") };
}
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("lists existing tracked and untracked paths, with explicit ignored visibility", async () => {
  const { repo } = await fixture();
  await rm(join(repo, "src/file.txt"));
  await writeFile(join(repo, "untracked.txt"), "current");
  await writeFile(join(repo, "ignored.txt"), "ignored");
  const source = { kind: "worktree" as const, repo };
  expect((await listBrowse(source)).entries.map((entry) => entry.path)).toEqual([
    ".gitignore",
    "untracked.txt",
  ]);
  expect((await listBrowse(source, true)).entries.map((entry) => entry.path)).toContain(
    "ignored.txt",
  );
});

test("reads the selected worktree and immutable commit without changing either checkout", async () => {
  const { root, repo, oid } = await fixture();
  const linked = join(root, "linked");
  git(repo, "worktree", "add", "-q", "-b", "topic", linked);
  await writeFile(join(repo, "src/file.txt"), "main current");
  await writeFile(join(linked, "src/file.txt"), "linked current");
  expect(await readBrowse({ kind: "worktree", repo: linked }, "src/file.txt")).toMatchObject({
    kind: "text",
    text: "linked current",
    plain: false,
  });
  expect(await readBrowse({ kind: "commit", repo: linked, oid }, "src/file.txt")).toMatchObject({
    kind: "text",
    text: "committed\n",
  });
  expect((await listBrowse({ kind: "commit", repo, oid })).entries).toContainEqual({
    path: "src",
    kind: "directory",
  });
  expect(git(repo, "symbolic-ref", "--short", "HEAD")).toBe("main");
  expect(git(linked, "symbolic-ref", "--short", "HEAD")).toBe("topic");
});

test("returns explicit missing metadata and refuses traversal and Git internals", async () => {
  const { repo, oid } = await fixture();
  for (const source of [
    { kind: "worktree" as const, repo },
    { kind: "commit" as const, repo, oid },
  ]) {
    expect(await readBrowse(source, "missing.txt")).toMatchObject({ kind: "missing", size: 0 });
    for (const path of [
      "../outside",
      ".git/config",
      "src/../../outside",
      "/etc/passwd",
      "src\\file.txt",
    ])
      await expect(readBrowse(source, path)).rejects.toMatchObject({ code: "invalid-path" });
  }
  expect(
    browseReadRequestSchema.safeParse({
      source: { kind: "commit", repo, oid: "HEAD" },
      path: "src/file.txt",
    }).success,
  ).toBe(false);
});

test("never follows links, including tracked directories replaced with outside links", async () => {
  const { root, repo, oid } = await fixture();
  await writeFile(join(root, "secret"), "private");
  await symlink(join(root, "secret"), join(repo, "link"));
  git(repo, "add", "link");
  git(repo, "commit", "-q", "-m", "link");
  expect(await readBrowse({ kind: "worktree", repo }, "link")).toMatchObject({
    kind: "unsupported",
  });
  expect(
    await readBrowse({ kind: "commit", repo, oid: git(repo, "rev-parse", "HEAD") }, "link"),
  ).toMatchObject({ kind: "unsupported" });
  await rm(join(repo, "src"), { recursive: true });
  await symlink(root, join(repo, "src"));
  expect((await listBrowse({ kind: "worktree", repo })).entries).not.toContainEqual(
    expect.objectContaining({ path: "src/file.txt" }),
  );
  expect(await readBrowse({ kind: "worktree", repo }, "src/secret")).toMatchObject({
    kind: "unsupported",
  });
  expect(await readBrowse({ kind: "commit", repo, oid }, "src/file.txt")).toMatchObject({
    text: "committed\n",
  });
});

test("binary and invalid encoding responses never contain text; large and long-line text is plain", async () => {
  const { repo } = await fixture();
  const source = { kind: "worktree" as const, repo };
  for (const [name, data, kind] of [
    ["nul", Buffer.from("a\0b"), "binary"],
    ["pdf", Buffer.from("%PDF-1.7"), "binary"],
    ["invalid", Buffer.from([0xff, 0xfe]), "unsupported"],
    ["control", Buffer.from([1, 2, 3]), "binary"],
  ] as const) {
    await writeFile(join(repo, name), data);
    const result = await readBrowse(source, name);
    expect(result.kind).toBe(kind);
    expect(result.text).toBeUndefined();
  }
  await writeFile(join(repo, "long"), "x".repeat(20_001));
  expect(await readBrowse(source, "long")).toMatchObject({ kind: "text", plain: true });
  await writeFile(join(repo, "large"), ("a".repeat(40) + "\n").repeat(26_215));
  expect(await readBrowse(source, "large")).toMatchObject({ kind: "text", plain: true });
  const handle = await open(join(repo, "huge"), "w");
  await handle.truncate(MAX_FILE_BYTES + 1);
  await handle.close();
  expect(await readBrowse(source, "huge")).toMatchObject({
    kind: "too-large",
    size: MAX_FILE_BYTES + 1,
  });
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "types");
  const commit = { kind: "commit" as const, repo, oid: git(repo, "rev-parse", "HEAD") };
  expect(await readBrowse(commit, "huge")).toMatchObject({ kind: "too-large" });
  expect(await readBrowse(commit, "pdf")).toMatchObject({ kind: "binary" });
});

test("preserves literal unusual Git paths and rejects cancelled work before processing", async () => {
  const { repo } = await fixture();
  const path = "src/[literal]\tname\n.txt";
  await writeFile(join(repo, path), "literal");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "literal");
  const source = { kind: "commit" as const, repo, oid: git(repo, "rev-parse", "HEAD") };
  expect(await readBrowse(source, path)).toMatchObject({ text: "literal" });
  const controller = new AbortController();
  controller.abort();
  await expect(listBrowse(source, false, controller.signal)).rejects.toThrow("aborted");
  await expect(readBrowse(source, path, controller.signal)).rejects.toThrow("aborted");
});

test("HTTP browse routes authorize discovered worktrees and reject arbitrary repositories", async () => {
  const { root, repo } = await fixture();
  const linked = join(root, "linked");
  git(repo, "worktree", "add", "-q", "-b", "topic", linked);
  const host = await startHost({ repo });
  hosts.push(host);
  const headers = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };
  const origin = `http://127.0.0.1:${host.port}`;
  const call = (route: string, body: unknown) =>
    fetch(`${origin}/api/browse/${route}`, { method: "POST", headers, body: JSON.stringify(body) });
  expect((await call("list", { source: { kind: "worktree", repo: linked } })).status).toBe(403);
  await fetch(`${origin}/api/session`, { headers });
  const allowed = await call("list", { source: { kind: "worktree", repo: linked } });
  expect(allowed.status).toBe(200);
  expect((await allowed.json()).entries).toContainEqual({ path: "src/file.txt", kind: "file" });
  expect(
    (await call("read", { source: { kind: "worktree", repo: root }, path: "secret" })).status,
  ).toBe(403);
  expect(
    (await call("read", { source: { kind: "commit", repo, oid: "main" }, path: "src/file.txt" }))
      .status,
  ).toBe(400);
});

test("lists submodules as boundaries and cannot read through them", async () => {
  const { repo, oid } = await fixture();
  const nested = join(repo, "module");
  await mkdir(nested);
  git(nested, "init", "-q");
  await writeFile(join(nested, "secret.txt"), "nested source");
  git(repo, "update-index", "--add", "--cacheinfo", `160000,${oid},module`);
  git(repo, "commit", "-q", "-m", "submodule");
  const source = { kind: "worktree" as const, repo };
  expect((await listBrowse(source)).entries).toContainEqual({ path: "module", kind: "submodule" });
  expect((await listBrowse(source)).entries.some((entry) => entry.path.startsWith("module/"))).toBe(
    false,
  );
  expect(await readBrowse(source, "module/secret.txt")).toMatchObject({ kind: "unsupported" });
  expect(
    await readBrowse({ kind: "commit", repo, oid: git(repo, "rev-parse", "HEAD") }, "module"),
  ).toMatchObject({ kind: "unsupported" });
});

test("bounds a large commit manifest and reports truncation", async () => {
  const { repo } = await fixture();
  const blob = git(repo, "rev-parse", "HEAD:src/file.txt");
  const tree = execFileSync("git", ["mktree"], {
    cwd: repo,
    input: Array.from(
      { length: 50_001 },
      (_, i) => `100644 blob ${blob}\tf${String(i).padStart(5, "0")}\n`,
    ).join(""),
    encoding: "utf8",
  }).trim();
  const oid = git(repo, "commit-tree", tree, "-p", "HEAD", "-m", "manifest");
  const response = await listBrowse({ kind: "commit", repo, oid });
  expect(response.truncated).toBe(true);
  expect(response.entries).toHaveLength(50_000);
});

test("working-file browsing keeps live invalidation when a historical diff opens", async () => {
  const { repo, oid } = await fixture();
  const watch = vi.spyOn(watchRuntime, "watchRepository").mockResolvedValue(async () => {});
  try {
    const host = await startHost({ repo });
    hosts.push(host);
    const origin = `http://127.0.0.1:${host.port}`;
    const headers = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };
    expect((await fetch(`${origin}/api/session`, { headers })).status).toBe(200);
    expect(
      (
        await fetch(`${origin}/api/browse/list`, {
          method: "POST",
          headers,
          body: JSON.stringify({ source: { kind: "worktree", repo } }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${origin}/api/review`, {
          method: "POST",
          headers,
          body: JSON.stringify({ repo, comparison: { kind: "commit", commit: oid } }),
        })
      ).status,
    ).toBe(200);
    expect(watch.mock.calls.map((call) => call[2])).toEqual([false, true]);
    await host.close();
  } finally {
    watch.mockRestore();
  }
});

test("bounds text line count and line length independently of file bytes", async () => {
  const { repo } = await fixture();
  const source = { kind: "worktree" as const, repo };
  const cases = [
    { path: "line-limit.txt", text: "x".repeat(MAX_FILE_LINE_LENGTH), kind: "text" },
    { path: "line-over.txt", text: "x".repeat(MAX_FILE_LINE_LENGTH + 1), kind: "too-large" },
    { path: "count-limit.txt", text: "x\n".repeat(MAX_FILE_LINES - 1) + "x", kind: "text" },
    { path: "count-over.txt", text: "x\n".repeat(MAX_FILE_LINES) + "x", kind: "too-large" },
  ];
  for (const entry of cases) {
    expect(Buffer.byteLength(entry.text)).toBeLessThan(MAX_FILE_BYTES);
    await writeFile(join(repo, entry.path), entry.text);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "text shape limits");
  const commit = { kind: "commit" as const, repo, oid: git(repo, "rev-parse", "HEAD") };
  for (const entry of cases) {
    for (const selected of [source, commit]) {
      const result = await readBrowse(selected, entry.path);
      expect(result.kind).toBe(entry.kind);
      expect(result.text).toBe(entry.kind === "text" ? entry.text : undefined);
      expect(result.reason?.includes("preview limit") ?? false).toBe(entry.kind === "too-large");
    }
  }
});

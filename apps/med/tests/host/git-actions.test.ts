import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startHost, type RunningHost } from "../../src/host/server";
import type { Comparison, ReviewResponse } from "../../src/shared/protocol";
import type { PushRequest } from "../../src/shared/git-actions";
import { runReviewCommand } from "../../src/cli/review";

const roots: string[] = [];
const hosts: RunningHost[] = [];
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "med-git-actions-")));
  roots.push(root);
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  await mkdir(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  await mkdir(remote);
  git(remote, "init", "--bare");
  git(repo, "remote", "add", "origin", remote);
  const launch = async () => {
    const stateDir = join(root, "state");
    const host = await startHost({ repo, stateDir, port: 0 });
    hosts.push(host);
    const origin = `http://127.0.0.1:${host.port}`;
    const api = (path: string, body?: unknown) =>
      fetch(`${origin}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const push = (input: Omit<PushRequest, "repo">) => api("/api/git/push", { repo, ...input });
    const review = async (comparison: Comparison): Promise<ReviewResponse> => {
      const response = await api("/api/review", { repo, comparison });
      expect(response.status).toBe(200);
      return response.json();
    };
    return { host, stateDir, origin, api, push, review };
  };
  return { repo, remote, launch };
}
async function commit(repo: string, path: string, text: string) {
  await writeFile(join(repo, path), text);
  git(repo, "add", path);
  git(repo, "commit", "-m", path);
  return git(repo, "rev-parse", "HEAD");
}
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("HTTP comparison and CLI saved links exclude merged base changes and support stacked bases", async () => {
  const { repo, launch } = await fixture();
  await commit(repo, "start", "start");
  git(repo, "checkout", "-b", "feature");
  await commit(repo, "feature", "feature");
  git(repo, "checkout", "main");
  await commit(repo, "main1", "main1");
  git(repo, "checkout", "feature");
  git(repo, "merge", "main", "--no-edit");
  const shared = git(repo, "rev-parse", "main");
  git(repo, "checkout", "main");
  await commit(repo, "main2", "main2");
  git(repo, "checkout", "feature");
  const { review, api, host, stateDir } = await launch();
  const result = await review({ kind: "range", base: "main", head: "feature", mergeBase: true });
  expect(result.base).toBe(shared);
  expect(result.files.map((file) => file.path)).toEqual(["feature"]);
  const output: string[] = [];
  await runReviewCommand(
    [
      "create",
      "--title",
      "Feature",
      "--repo",
      repo,
      "--base",
      "main",
      "--head",
      "feature",
      "--merge-base",
      "--state-dir",
      stateDir,
      "--port",
      String(host.port),
    ],
    { print: (text) => output.push(text) },
  );
  const id = output[0]!.match(/\/review\/(r_[a-z0-9]+)/)![1];
  const bundle = await (await api(`/api/reviews/${id}`)).json();
  const savedResponse = await api(`/api/reviews/${id}/targets/${bundle.targets[0].id}/review`);
  expect(savedResponse.status).toBe(200);
  const saved = await savedResponse.json();
  expect(saved.base).toBe(shared);
  expect(saved.files.map((file: { path: string }) => file.path)).toEqual(["feature"]);
  git(repo, "checkout", "-b", "stacked");
  await commit(repo, "stacked", "stacked");
  const stack = await review({ kind: "range", base: "feature", head: "stacked", mergeBase: true });
  expect(stack.files.map((file) => file.path)).toEqual(["stacked"]);
  const direct = await review({ kind: "range", base: "main", head: "feature" });
  expect(direct.files.map((file) => file.path)).toContain("main2");
});

test("push creates and advances only the named branch and rejects non-fast-forward", async () => {
  const { repo, remote, launch } = await fixture();
  const first = await commit(repo, "file", "one");
  const { push, api } = await launch();
  expect((await push({ head: first, remote: "origin", branch: "review/new" })).status).toBe(200);
  expect(git(remote, "rev-parse", "refs/heads/review/new")).toBe(first);
  const second = await commit(repo, "file", "two");
  expect((await push({ head: second, remote: "origin", branch: "review/new" })).status).toBe(200);
  expect(git(remote, "rev-parse", "refs/heads/review/new")).toBe(second);
  const rejected = await push({ head: first, remote: "origin", branch: "review/new" });
  expect(rejected.status).toBe(422);
  expect(await rejected.json()).toMatchObject({ error: { code: "push-rejected" } });
  expect(git(remote, "rev-parse", "refs/heads/review/new")).toBe(second);
  expect(git(repo, "branch", "--show-current")).toBe("main");
  const targets = await (await api(`/api/git/targets?repo=${encodeURIComponent(repo)}`)).json();
  expect(targets.remotes).toEqual([{ name: "origin", branches: ["review/new"] }]);
});

test("push rejects injection-like refs and unconfigured or multi-destination remotes", async () => {
  const { repo, remote, launch } = await fixture();
  const head = await commit(repo, "file", "one");
  const { push } = await launch();
  for (const branch of ["--all", ":delete", "../main", "refs/heads/main", "a\nb"]) {
    const response = await push({ head, remote: "origin", branch });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid-branch" } });
  }
  for (const name of ["--all", "missing", remote]) {
    const response = await push({ head, remote: name, branch: "main" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid-remote" } });
  }
  git(repo, "config", "--add", "remote.origin.pushurl", remote);
  git(repo, "config", "--add", "remote.origin.pushurl", remote);
  const response = await push({ head, remote: "origin", branch: "main" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "multiple-push-destinations" } });
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("");
});

test("push ignores mirror and followTags config without removing unrelated remote branches", async () => {
  const { repo, remote, launch } = await fixture();
  const head = await commit(repo, "file", "one");
  const { push } = await launch();
  await push({ head, remote: "origin", branch: "keep" });
  git(repo, "tag", "-a", "release", "-m", "release");
  git(repo, "config", "remote.origin.mirror", "true");
  git(repo, "config", "push.followTags", "true");
  await push({ head, remote: "origin", branch: "new" });
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe(
    "refs/heads/keep\nrefs/heads/new",
  );
});

test("push preserves pre-push hooks and reports failures without a false success", async () => {
  const { repo, remote, launch } = await fixture();
  const head = await commit(repo, "file", "one");
  const { push } = await launch();
  const hook = join(repo, ".git", "hooks", "pre-push");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  const response = await push({ head, remote: "origin", branch: "main" });
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: { code: "push-failed" } });
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("");
});

test("push requires authentication, a trusted origin, and a registered repository", async () => {
  const { repo, remote, launch } = await fixture();
  const head = await commit(repo, "file", "one");
  const { host, origin, api } = await launch();
  const body = JSON.stringify({ repo, head, remote: "origin", branch: "main" });
  expect(
    (
      await fetch(`${origin}/api/git/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(`${origin}/api/git/push`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${host.token}`,
          origin: "https://untrusted.example",
          "content-type": "application/json",
        },
        body,
      })
    ).status,
  ).toBe(403);
  const outside = await fixture();
  const outsideHead = await commit(outside.repo, "file", "outside");
  const response = await api("/api/git/push", {
    repo: outside.repo,
    head: outsideHead,
    remote: "origin",
    branch: "main",
  });
  expect(response.status).toBe(403);
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("");
  expect(git(outside.remote, "for-each-ref", "--format=%(refname)")).toBe("");
});

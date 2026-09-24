import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { gitTargets, pushBranch } from "../../src/host/repository/git-actions";
import { ReviewService } from "../../src/host/repository/review";
import { parseReviewCommand } from "../../src/cli/review";

const roots: string[] = [];
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
  const root = await mkdtemp(join(tmpdir(), "med-git-actions-"));
  roots.push(root);
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  await mkdir(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  await mkdir(remote);
  git(remote, "init", "--bare");
  git(repo, "remote", "add", "origin", remote);
  return { repo, remote };
}
async function commit(repo: string, path: string, text: string) {
  await writeFile(join(repo, path), text);
  git(repo, "add", path);
  git(repo, "commit", "-m", path);
  return git(repo, "rev-parse", "HEAD");
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("merge-base excludes base-only changes after merging main and supports stacked bases", async () => {
  const { repo } = await fixture();
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
  const reviews = new ReviewService();
  const review = await reviews.load({
    repo,
    comparison: { kind: "range", base: "main", head: "feature", mergeBase: true },
  });
  expect(review.base).toBe(shared);
  expect(review.files.map((file) => file.path)).toEqual(["feature"]);
  git(repo, "checkout", "-b", "stacked");
  await commit(repo, "stacked", "stacked");
  const stack = await reviews.load({
    repo,
    comparison: { kind: "range", base: "feature", head: "stacked", mergeBase: true },
  });
  expect(stack.files.map((file) => file.path)).toEqual(["stacked"]);
  const direct = await reviews.load({
    repo,
    comparison: { kind: "range", base: "main", head: "feature" },
  });
  expect(direct.files.map((file) => file.path)).toContain("main2");
});

test("push creates and advances only the named branch and rejects non-fast-forward", async () => {
  const { repo, remote } = await fixture();
  const first = await commit(repo, "file", "one");
  await pushBranch({ repo, head: first, remote: "origin", branch: "review/new" });
  expect(git(remote, "rev-parse", "refs/heads/review/new")).toBe(first);
  const second = await commit(repo, "file", "two");
  await pushBranch({ repo, head: second, remote: "origin", branch: "review/new" });
  expect(git(remote, "rev-parse", "refs/heads/review/new")).toBe(second);
  await expect(
    pushBranch({ repo, head: first, remote: "origin", branch: "review/new" }),
  ).rejects.toMatchObject({ code: "push-rejected" });
  expect(git(remote, "rev-parse", "refs/heads/review/new")).toBe(second);
  expect(git(repo, "branch", "--show-current")).toBe("main");
  const targets = await gitTargets(repo);
  expect(targets.remotes).toEqual([{ name: "origin", branches: ["review/new"] }]);
});

test("push rejects injection-like refs and unconfigured or multi-destination remotes", async () => {
  const { repo, remote } = await fixture();
  const head = await commit(repo, "file", "one");
  for (const branch of ["--all", ":delete", "../main", "refs/heads/main", "a\nb"]) {
    await expect(pushBranch({ repo, head, remote: "origin", branch })).rejects.toMatchObject({
      code: "invalid-branch",
    });
  }
  for (const name of ["--all", "missing", remote])
    await expect(pushBranch({ repo, head, remote: name, branch: "main" })).rejects.toMatchObject({
      code: "invalid-remote",
    });
  git(repo, "config", "--add", "remote.origin.pushurl", remote);
  git(repo, "config", "--add", "remote.origin.pushurl", remote);
  await expect(pushBranch({ repo, head, remote: "origin", branch: "main" })).rejects.toMatchObject({
    code: "multiple-push-destinations",
  });
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("");
});

test("push ignores mirror and followTags config without removing unrelated remote branches", async () => {
  const { repo, remote } = await fixture();
  const head = await commit(repo, "file", "one");
  await pushBranch({ repo, head, remote: "origin", branch: "keep" });
  git(repo, "tag", "-a", "release", "-m", "release");
  git(repo, "config", "remote.origin.mirror", "true");
  git(repo, "config", "push.followTags", "true");
  await pushBranch({ repo, head, remote: "origin", branch: "new" });
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe(
    "refs/heads/keep\nrefs/heads/new",
  );
});

test("CLI accepts merge-base only with a range", async () => {
  const result = await parseReviewCommand([
    "create",
    "--title",
    "Feature",
    "--repo",
    "/tmp",
    "--base",
    "main",
    "--head",
    "HEAD",
    "--merge-base",
  ]);
  expect(result.manifest?.targets[0]?.comparison).toEqual({
    kind: "range",
    base: "main",
    head: "HEAD",
    mergeBase: true,
  });
  await expect(
    parseReviewCommand([
      "create",
      "--title",
      "Feature",
      "--repo",
      "/tmp",
      "--working",
      "--merge-base",
    ]),
  ).rejects.toThrow("Use --working without");
});

test("push preserves pre-push hooks and reports failures without a false success", async () => {
  const { repo, remote } = await fixture();
  const head = await commit(repo, "file", "one");
  const hook = join(repo, ".git", "hooks", "pre-push");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  await expect(pushBranch({ repo, head, remote: "origin", branch: "main" })).rejects.toMatchObject({
    code: "push-failed",
  });
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("");
});

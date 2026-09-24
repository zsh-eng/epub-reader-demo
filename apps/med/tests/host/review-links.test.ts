import { afterEach, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost, type RunningHost } from "../../src/host/server";

const directories: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  }).trim();
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med saved links ")));
  directories.push(directory);
  const repos: string[] = [];
  for (const name of ["one", "two"]) {
    const repo = join(directory, name);
    await mkdir(repo);
    git(repo, "init", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    await writeFile(join(repo, "same.ts"), `export const name = "${name} before";\n`);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "baseline");
    await writeFile(join(repo, "same.ts"), `export const name = "${name} after";\n`);
    repos.push(repo);
  }
  const stateDir = join(directory, "state");
  const launch = async () => {
    const host = await startHost({ repo: repos[0]!, repos, stateDir, port: 0 });
    hosts.push(host);
    const origin = `http://127.0.0.1:${host.port}`;
    const api = (path: string, body?: unknown) =>
      fetch(`${origin}${path}`, {
        headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    return { host, origin, api };
  };
  return { repos, launch };
}

test("saved review links serve the app and authorize a new browser tab through a cookie", async () => {
  const { launch } = await fixture();
  const { host, api, origin } = await launch();
  expect((await fetch(`${origin}/api/repositories`)).status).toBe(401);
  const auth = await api("/api/auth", {});
  const cookie = auth.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  const headers = { cookie: cookie.split(";")[0]! };
  expect((await fetch(`${origin}/api/repositories`, { headers })).status).toBe(200);
  expect(
    (
      await fetch(`${origin}/api/repositories`, {
        method: "POST",
        headers: {
          ...headers,
          origin: "https://untrusted.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ path: "/" }),
      })
    ).status,
  ).toBe(403);
  expect((await fetch(`${origin}/api/auth`, { method: "POST", headers })).status).toBe(401);
  const deep = await fetch(`${origin}/review/r_example`);
  expect(deep.status).toBe(200);
  expect(deep.headers.get("cache-control") ?? "").not.toContain("immutable");
  expect((await deep.text()).includes(host.token)).toBe(false);
});

test("captures multi-repo changes, exports comments, persists after restart and clears only this review", async () => {
  const { repos, launch } = await fixture();
  let connection = await launch();
  const input = {
    title: "Agent changes",
    targets: repos.map((repo) => ({ repo, comparison: { kind: "working" } })),
  };
  const response = await connection.api("/api/reviews", input);
  expect(response.status).toBe(200);
  const bundle = await response.json();
  expect(bundle.targets).toHaveLength(2);
  const other = await (await connection.api("/api/reviews", input)).json();
  for (const [index, target] of bundle.targets.entries()) {
    const notes = await connection.api(`/api/reviews/${bundle.id}/targets/${target.id}/notes`, {
      expectedRevision: 0,
      mutation: {
        type: "add",
        note: { path: "same.ts", side: "new", line: 1, text: `Feedback ${index}` },
      },
    });
    expect(notes.status).toBe(200);
  }
  await connection.api(`/api/reviews/${other.id}/targets/${other.targets[0].id}/notes`, {
    expectedRevision: 0,
    mutation: {
      type: "add",
      note: { path: "same.ts", side: "new", line: 1, text: "Keep other review" },
    },
  });
  const token = connection.host.token;
  await connection.host.close();
  hosts.splice(hosts.indexOf(connection.host), 1);
  await writeFile(join(repos[0]!, "same.ts"), "changed after capture\n");
  connection = await launch();
  expect(connection.host.token).toBe(token);
  const source = await (
    await connection.api(
      `/api/reviews/${bundle.id}/targets/${bundle.targets[0].id}/source?path=same.ts`,
    )
  ).json();
  expect(source.new).toContain("one after");
  const feedback = await (await connection.api(`/api/reviews/${bundle.id}/feedback`)).json();
  expect(feedback.count).toBe(2);
  expect(feedback.repositoryCount).toBe(2);
  expect(feedback.text).toContain("Feedback 0");
  expect(feedback.text).toContain("one after");
  expect(feedback.text).toContain(repos[0]);
  expect(feedback.text).toContain(repos[1]);
  expect(feedback.text).not.toContain("changed after capture");
  const cleared = await connection.api(`/api/reviews/${bundle.id}/clear`, {
    expectedRevision: feedback.revision,
  });
  expect(cleared.status).toBe(200);
  expect((await (await connection.api(`/api/reviews/${bundle.id}/feedback`)).json()).count).toBe(0);
  expect((await (await connection.api(`/api/reviews/${other.id}/feedback`)).json()).count).toBe(1);
});

test("a link does not register unrelated repository paths", async () => {
  const { launch } = await fixture();
  const { api } = await launch();
  const response = await api("/api/reviews", {
    title: "Unknown",
    targets: [{ repo: "/not-registered", comparison: { kind: "working" } }],
  });
  expect(response.status).toBe(403);
});

test("saved metadata allows recovery while source access waits for repository registration", async () => {
  const { repos, launch } = await fixture();
  const { api, host, origin } = await launch();
  const saved = await (
    await api("/api/reviews", {
      title: "Recover review",
      targets: [{ repo: repos[0], comparison: { kind: "working" } }],
    })
  ).json();
  const target = saved.targets[0];
  const removed = await fetch(`${origin}/api/repositories?id=${target.repositoryId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${host.token}` },
  });
  expect(removed.status).toBe(200);
  expect((await api(`/api/reviews/${saved.id}`)).status).toBe(200);
  expect((await api(`/api/reviews/${saved.id}/targets/${target.id}/review`)).status).toBe(409);
  expect((await api(`/api/reviews/${saved.id}/clear`, { expectedRevision: 0 })).status).toBe(409);
  expect((await api("/api/repositories", { path: repos[0] })).status).toBe(200);
  expect((await api(`/api/reviews/${saved.id}/targets/${target.id}/review`)).status).toBe(200);
});

test("comments on browsed commits across repositories join the saved review and survive restart", async () => {
  const { repos, launch } = await fixture();
  let connection = await launch();
  const saved = await (
    await connection.api("/api/reviews", {
      title: "Cross-tab comments",
      targets: [{ repo: repos[0], comparison: { kind: "working" } }],
    })
  ).json();
  const original = saved.targets[0];
  await connection.api(`/api/reviews/${saved.id}/targets/${original.id}/notes`, {
    expectedRevision: 0,
    mutation: {
      type: "add",
      note: { path: "same.ts", side: "new", line: 1, text: "Original target" },
    },
  });
  const paths: string[] = [];
  for (const [index, repo] of repos.entries()) {
    const review = await (
      await connection.api("/api/review", {
        repo,
        comparison: { kind: "commit", commit: git(repo, "rev-parse", "HEAD") },
      })
    ).json();
    const path = `/api/reviews/${saved.id}/browsing/${review.id}/notes`;
    paths.push(path);
    expect(await (await connection.api(path)).json()).toMatchObject({
      reviewId: review.id,
      revision: 0,
      notes: [],
    });
    const response = await connection.api(path, {
      reviewId: review.id,
      expectedRevision: 0,
      mutation: {
        type: "add",
        note: { path: "same.ts", side: "new", line: 1, text: `Commit tab ${index}` },
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reviewId: review.id, revision: 1 });
  }
  const updated = await (await connection.api(`/api/reviews/${saved.id}`)).json();
  expect(updated.commentCount).toBe(3);
  expect(updated.targets).toHaveLength(3);
  expect(updated.targets[0]).toEqual(original);
  const exported = await (await connection.api(`/api/reviews/${saved.id}/feedback`)).json();
  expect(exported.count).toBe(3);
  expect(exported.repositoryCount).toBe(2);
  expect(exported.text).toContain("Original target");
  expect(exported.text).toContain("Commit tab 0");
  expect(exported.text).toContain("Commit tab 1");
  expect(exported.text).toContain("one before");
  await connection.host.close();
  hosts.splice(hosts.indexOf(connection.host), 1);
  await writeFile(join(repos[0]!, "same.ts"), "later content\n");
  connection = await launch();
  expect(await (await connection.api(`/api/reviews/${saved.id}/feedback`)).json()).toEqual(
    exported,
  );
  const persisted = await (await connection.api(paths[1]!)).json();
  expect(persisted.notes[0].text).toBe("Commit tab 1");
  const deleted = await connection.api(paths[1]!, {
    reviewId: persisted.reviewId,
    expectedRevision: persisted.revision,
    mutation: { type: "remove", id: persisted.notes[0].id },
  });
  expect(deleted.status).toBe(200);
  expect((await (await connection.api(`/api/reviews/${saved.id}/feedback`)).json()).count).toBe(2);
  expect(
    (await connection.api(`/api/reviews/${saved.id}/clear`, { expectedRevision: updated.revision }))
      .status,
  ).toBe(409);
  const latest = await (await connection.api(`/api/reviews/${saved.id}`)).json();
  expect(
    (await connection.api(`/api/reviews/${saved.id}/clear`, { expectedRevision: latest.revision }))
      .status,
  ).toBe(200);
  expect((await (await connection.api(paths[0]!)).json()).notes).toEqual([]);
});

test("browsed comments skip gitlinks, reject invalid first notes atomically, and survive removed worktrees", async () => {
  const { repos, launch } = await fixture();
  const repo = repos[0]!;
  const link = `${repo}-linked`;
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "worktree", "add", "-b", "linked-topic", link, base);
  await writeFile(join(link, "same.ts"), "export const linked = true;\n");
  git(link, "add", "same.ts");
  git(link, "update-index", "--add", "--cacheinfo", `160000,${base},submodule`);
  git(link, "commit", "-m", "text and gitlink");
  const connection = await launch();
  const saved = await (
    await connection.api("/api/reviews", {
      title: "Edge cases",
      targets: [{ repo, comparison: { kind: "working" } }],
    })
  ).json();
  const review = await (
    await connection.api("/api/review", {
      repo: link,
      comparison: { kind: "commit", commit: git(link, "rev-parse", "HEAD") },
    })
  ).json();
  const path = `/api/reviews/${saved.id}/browsing/${review.id}/notes`;
  const request = (line: number) => ({
    reviewId: review.id,
    expectedRevision: 0,
    mutation: { type: "add", note: { path: "same.ts", side: "new", line, text: "Linked comment" } },
  });
  expect((await connection.api(path, request(9999))).status).toBe(400);
  expect(await (await connection.api(`/api/reviews/${saved.id}`)).json()).toEqual(saved);
  const response = await connection.api(path, request(1));
  expect(response.status).toBe(200);
  git(repo, "worktree", "remove", "--force", link);
  await connection.api("/api/repositories");
  const notes = await connection.api(path);
  expect(notes.status).toBe(200);
  expect((await notes.json()).notes[0].text).toBe("Linked comment");
  expect((await (await connection.api(`/api/reviews/${saved.id}/feedback`)).json()).text).toContain(
    "export const linked = true;",
  );
});

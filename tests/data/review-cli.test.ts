import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseReviewCommand, runReviewCommand } from "../../src/cli/review";
import {
  getPersistentToken,
  publishConnection,
  readConnection,
} from "../../src/host/runtime/connection";

const temporary: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections();
        }),
    ),
  );
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function state() {
  const path = await mkdtemp(join(tmpdir(), "med-review-cli-"));
  temporary.push(path);
  return path;
}

async function fixture() {
  const stateDir = await state();
  const token = await getPersistentToken(stateDir);
  const requests: { url: string; body: unknown }[] = [];
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString();
    requests.push({ url: request.url!, body: text ? JSON.parse(text) : null });
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url === "/api/repositories"
          ? { repositories: [{ id: "repo-one", path: "/repo/one", worktrees: [] }] }
          : { id: "r_saved123" },
      ),
    );
  });
  servers.push(server);
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  const port = address.port;
  await publishConnection(stateDir, {
    origin: `http://127.0.0.1:${port}`,
    pid: process.pid,
    token,
    version: 1,
  });
  return { stateDir, token, port, requests };
}

describe("agent review CLI", () => {
  it("normalizes repository paths and requires an explicit comparison", async () => {
    const command = await parseReviewCommand([
      "create",
      "--title",
      "Fix",
      "--repo",
      ".",
      "--base",
      "HEAD~1",
      "--head",
      "HEAD",
    ]);
    expect(command.port).toBe(4173);
    expect(command.manifest).toEqual({
      title: "Fix",
      targets: [
        { repo: resolve("."), comparison: { kind: "range", base: "HEAD~1", head: "HEAD" } },
      ],
    });
    await expect(parseReviewCommand(["create", "--title", "Fix", "--repo", "."])).rejects.toThrow(
      "both --base and --head",
    );
    await expect(
      parseReviewCommand([
        "create",
        "--title",
        "Fix",
        "--repo",
        ".",
        "--working",
        "--base",
        "HEAD",
      ]),
    ).rejects.toThrow("without --base");
    expect(
      (await parseReviewCommand(["create", "--title", "Fix", "--repo", ".", "--working"])).manifest
        ?.targets[0]?.comparison,
    ).toEqual({ kind: "working" });
  });

  it("validates a multi-repository manifest and rejects file comparisons", async () => {
    const path = join(await state(), "review.json");
    await writeFile(
      path,
      JSON.stringify({
        title: "Several repos",
        targets: [
          { repo: ".", comparison: { kind: "range", base: "a", head: "b" } },
          { repo: "../another", comparison: { kind: "working" } },
        ],
      }),
    );
    const command = await parseReviewCommand(["create", "--manifest", path]);
    expect(command.manifest?.targets.map((target) => target.repo)).toEqual([
      resolve("."),
      resolve("../another"),
    ]);
    await expect(parseReviewCommand(["create", "--manifest", path, "--repo", "."])).rejects.toThrow(
      "Use --manifest without",
    );
    await writeFile(
      path,
      JSON.stringify({
        title: "Bad",
        targets: [{ repo: ".", comparison: { kind: "patch", path: "a.patch" } }],
      }),
    );
    await expect(parseReviewCommand(["create", "--manifest", path])).rejects.toThrow(
      "Invalid review manifest",
    );
  });

  it("connects to the selected host and prints a token-free Markdown link", async () => {
    const host = await fixture();
    const output: string[] = [];
    await runReviewCommand(
      [
        "create",
        "--title",
        "Fix",
        "--repo",
        ".",
        "--base",
        "a",
        "--head",
        "b",
        "--state-dir",
        host.stateDir,
        "--port",
        String(host.port),
      ],
      { print: (text) => output.push(text) },
    );
    expect(host.requests.map((request) => request.url)).toEqual([
      "/api/repositories",
      "/api/reviews",
    ]);
    expect(host.requests[1]?.body).toEqual({
      title: "Fix",
      targets: [{ repo: resolve("."), comparison: { kind: "range", base: "a", head: "b" } }],
    });
    expect(output).toEqual([
      `[Review changes here](http://127.0.0.1:${host.port}/review/r_saved123)`,
    ]);
    expect(output.join("\n")).not.toContain(host.token);
    const repositories: string[] = [];
    await runReviewCommand(["repos", "--state-dir", host.stateDir, "--port", String(host.port)], {
      print: (text) => repositories.push(text),
    });
    expect(JSON.parse(repositories[0]!).repositories[0].path).toBe("/repo/one");
    expect(repositories[0]).not.toContain(host.token);
  });

  it("gives an actionable connection error and never follows redirects", async () => {
    await expect(runReviewCommand(["repos", "--state-dir", await state()])).rejects.toThrow(
      "Start med-diff",
    );
    const host = await fixture();
    await expect(
      runReviewCommand(["repos", "--state-dir", host.stateDir, "--port", String(host.port)], {
        fetcher: async (_url, options) => {
          expect(options?.redirect).toBe("error");
          throw new Error(`Internal failure with ${host.token}`);
        },
      }),
    ).rejects.toThrow(`Could not connect to med at http://127.0.0.1:${host.port}`);
    await expect(
      runReviewCommand(["repos", "--state-dir", host.stateDir, "--port", String(host.port)], {
        fetcher: async () =>
          new Response(JSON.stringify({ error: { message: `Expired ${host.token}` } }), {
            status: 401,
          }),
      }),
    ).rejects.toThrow("Expired [credential]");
  });
});

describe("local connection state", () => {
  it("preserves the credential and restricts saved state permissions", async () => {
    const directory = await state();
    const tokens = await Promise.all(
      Array.from({ length: 8 }, () => getPersistentToken(directory)),
    );
    expect(new Set(tokens).size).toBe(1);
    const first = tokens[0]!;
    expect(await getPersistentToken(directory)).toBe(first);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, "credential"))).mode & 0o777).toBe(0o600);
    await publishConnection(directory, {
      version: 1,
      origin: "http://127.0.0.1:4173",
      token: first,
      pid: process.pid,
    });
    expect((await stat(join(directory, "connections", "4173.json"))).mode & 0o777).toBe(0o600);
  });

  it("keeps ports separate and does not remove a replacement descriptor", async () => {
    const directory = await state();
    const token = await getPersistentToken(directory);
    const one = { version: 1 as const, origin: "http://127.0.0.1:4173", token, pid: process.pid };
    const cleanup = await publishConnection(directory, one);
    await publishConnection(directory, { ...one, origin: "http://127.0.0.1:4174" });
    await publishConnection(directory, one);
    await cleanup();
    expect((await readConnection(directory, 4173)).pid).toBe(process.pid);
    expect((await readConnection(directory, 4174)).origin).toBe("http://127.0.0.1:4174");
  });

  it("rejects a descriptor that could send the credential to another origin", async () => {
    const directory = await state();
    const token = await getPersistentToken(directory);
    await publishConnection(directory, {
      version: 1,
      origin: "http://127.0.0.1:4173",
      token,
      pid: process.pid,
    });
    const path = join(directory, "connections", "4173.json");
    const data = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...data, origin: "https://example.com" }));
    await expect(readConnection(directory)).rejects.toThrow("No valid med connection");
  });
});

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

// Use the built CLI and browser against isolated local repositories and state.
const directory = await realpath(await mkdtemp(join(tmpdir(), "med-review-links-")));
const stateDir = join(directory, "state");
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Med validation",
      GIT_AUTHOR_EMAIL: "validation@example.invalid",
      GIT_COMMITTER_NAME: "Med validation",
      GIT_COMMITTER_EMAIL: "validation@example.invalid",
    },
  }).trim();
let host;
let browser;
const repositories = [];
async function stopHost() {
  if (host && host.exitCode === null) {
    const exited = once(host, "exit");
    host.kill("SIGTERM");
    await exited;
  }
}
async function launch(port = 0) {
  host = spawn(
    process.execPath,
    ["dist/cli.js", ...repositories, "--no-open", "--port", String(port), "--state-dir", stateDir],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MED_SEARCH_CACHE: join(directory, "search-cache"),
        MED_ZOEKT_BIN: join(directory, "no-search-binaries"),
      },
    },
  );
  let errors = "";
  host.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Host startup timed out: ${errors}`)), 30000);
    host.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    host.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    host.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Host exited ${code}: ${errors}`));
    });
  });
  const parsed = new URL(url);
  return {
    url,
    origin: parsed.origin,
    port: Number(parsed.port),
    token: new URLSearchParams(parsed.hash.slice(1)).get("token"),
  };
}
let connection;
async function api(path, body) {
  const response = await fetch(`${connection.origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
try {
  for (const name of ["frontend", "backend"]) {
    const repo = join(directory, name);
    await mkdir(repo);
    git(repo, "init", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    await writeFile(
      join(repo, "same.ts"),
      `export const scope = "${name}";\nexport const ${name}Before = 1;\nexport const adjacent = 3;\n`,
    );
    git(repo, "add", ".");
    git(repo, "commit", "-m", "baseline");
    await writeFile(
      join(repo, "same.ts"),
      `export const scope = "${name}";\nexport const ${name}After = 2;\nexport const adjacent = 3;\n`,
    );
    repositories.push(repo);
  }
  connection = await launch();
  const manifestPath = join(directory, "review.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      title: "Agent handoff validation",
      targets: repositories.map((repo) => ({ repo, comparison: { kind: "working" } })),
    }),
  );
  const runCli = (...args) =>
    execFileSync(
      process.execPath,
      [
        "dist/cli.js",
        "review",
        ...args,
        "--state-dir",
        stateDir,
        "--port",
        String(connection.port),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  const catalogue = JSON.parse(runCli("repos"));
  assert.equal(catalogue.repositories.length, 2);
  const markdown = runCli("create", "--manifest", manifestPath);
  assert.ok(!markdown.includes(connection.token));
  const reviewUrl = /^\[Review changes here\]\((http:\/\/127\.0\.0\.1:\d+\/review\/[^)]+)\)$/.exec(
    markdown,
  )?.[1];
  assert.ok(reviewUrl, "CLI must print a clickable Markdown link");
  const id = new URL(reviewUrl).pathname.split("/").at(-1);
  let saved = await api(`/api/reviews/${id}`);
  assert.equal(saved.targets.length, 2);
  assert.ok(saved.targets.every((target) => target.captured));

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const pageErrors = [];
  context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.message)));
  const launchPage = await context.newPage();
  await launchPage.goto(connection.url);
  await launchPage.locator('[data-review-status="ready"]').waitFor();
  await launchPage.waitForFunction(() => location.hash === "");
  const cookies = await context.cookies();
  assert.ok(cookies.some((cookie) => cookie.httpOnly && cookie.sameSite === "Strict"));
  const page = await context.newPage();
  await page.goto(reviewUrl);
  await page.getByRole("region", { name: "Saved review" }).waitFor();
  await page.locator('[data-review-status="ready"]').waitFor();
  assert.equal(new URL(page.url()).hash, "");
  const header = page.getByRole("region", { name: "Saved review" });
  await header.getByText("Agent handoff validation", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  // Select the changed line itself. A hover-only gutter button can disappear
  // when the renderer updates after browser focus or source loading.
  await page
    .locator('[data-additions] [data-column-number="2"] [data-line-number-content]')
    .click();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Review note text" })
    .fill("Frontend feedback from the browser");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page.getByText("Frontend feedback from the browser", { exact: true }).waitFor();
  const second = saved.targets[1];
  await api(`/api/reviews/${id}/targets/${second.id}/notes`, {
    expectedRevision: 0,
    mutation: {
      type: "add",
      note: { path: "same.ts", side: "new", line: 2, text: "Backend feedback across repositories" },
    },
  });
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector('button[aria-label="Copy comments"]')?.textContent?.trim().endsWith("2"),
  );
  await header.getByRole("button", { name: "Copy comments", exact: true }).click();
  await header.getByText("Copied 2 comments", { exact: true }).waitFor();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  for (const expected of [
    "Frontend feedback from the browser",
    "Backend feedback across repositories",
    "frontendAfter",
    "backendAfter",
    "adjacent",
    "same.ts",
    ...repositories,
  ])
    assert.ok(clipboard.includes(expected), `Feedback must include ${expected}`);
  assert.match(clipboard, /2/);

  const previousToken = connection.token;
  const previousPort = connection.port;
  await stopHost();
  await writeFile(join(repositories[0], "same.ts"), "export const changedAfterCapture = true;\n");
  connection = await launch(previousPort);
  assert.equal(connection.token, previousToken);
  saved = await api(`/api/reviews/${id}`);
  assert.equal(saved.commentCount, 2);
  const source = await api(`/api/reviews/${id}/targets/${saved.targets[0].id}/source?path=same.ts`);
  assert.ok(source.new.includes("frontendAfter"));
  assert.ok(!source.new.includes("changedAfterCapture"));
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector('button[aria-label="Copy comments"]')?.textContent?.trim().endsWith("2"),
  );
  await page.getByText("Frontend feedback from the browser", { exact: true }).waitFor();
  await header.getByRole("combobox", { name: "Review target" }).selectOption(second.id);
  await page.getByText("Backend feedback across repositories", { exact: true }).waitFor();
  await header.getByRole("button", { name: "Review details and actions", exact: true }).click();
  await page.getByRole("button", { name: "Clear all comments", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await api(`/api/reviews/${id}/feedback`)).count, 2);
  await page.getByRole("button", { name: "Clear all comments", exact: true }).click();
  await page.getByRole("button", { name: "Confirm clear", exact: true }).click();
  await header.getByText("Comments cleared", { exact: true }).waitFor();
  assert.equal(
    await header.getByRole("button", { name: "Copy comments", exact: true }).isEnabled(),
    false,
  );
  assert.equal((await api(`/api/reviews/${id}/feedback`)).count, 0);
  assert.deepEqual(pageErrors, []);
  if (process.env.MED_VALIDATION_SCREENSHOT)
    await page.screenshot({ path: process.env.MED_VALIDATION_SCREENSHOT });
  console.log(
    JSON.stringify({
      checks:
        "built CLI discovery and multi-repo snapshot manifest; token-free link and new-tab cookie auth; UI comment; copied cross-repo source context; same-port restart and frozen snapshots; persistent comments; cancel and confirm clear",
      repositories: 2,
      commentsCopied: 2,
      pageErrors,
    }),
  );
} finally {
  await browser?.close();
  await stopHost();
  await rm(directory, { recursive: true, force: true });
}

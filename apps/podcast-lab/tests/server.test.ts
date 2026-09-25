import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server";
let folder: string, server: ReturnType<typeof createServer>;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "podcast-http-"));
  await writeFile(join(folder, "episode.mp3"), "0123456789");
  await mkdir(join(folder, "avatars"));
  await writeFile(
    join(folder, "avatars", "a".repeat(64) + ".webp"),
    "portrait",
  );
  server = createServer(folder, 0);
});
afterAll(async () => {
  server.stop(true);
  await rm(folder, { recursive: true, force: true });
});
test("range serving supports seeking and rejects invalid ranges", async () => {
  const ranged = await fetch(new URL("/audio", server.url), {
    headers: { Range: "bytes=3-6" },
  });
  expect(ranged.status).toBe(206);
  expect(ranged.headers.get("content-range")).toBe("bytes 3-6/10");
  expect(await ranged.text()).toBe("3456");
  const suffix = await fetch(new URL("/audio", server.url), {
    headers: { Range: "bytes=-3" },
  });
  expect(await suffix.text()).toBe("789");
  for (const range of ["bytes=20-", "bytes=4-2", "bytes=-0", "bytes=0-1,4-5"]) {
    const response = await fetch(new URL("/audio", server.url), {
      headers: { Range: range },
    });
    expect(response.status).toBe(416);
  }
  const head = await fetch(new URL("/audio", server.url), { method: "HEAD" });
  expect(head.headers.get("content-length")).toBe("10");
  expect(await head.text()).toBe("");
});
test("raw data and credentials are not exposed", async () => {
  for (const path of [
    "/.local/source.json",
    "/pipeline/classify.py",
    "/.env",
    "/enrichment.log",
  ])
    expect((await fetch(new URL(path, server.url))).status).toBe(404);
  expect(
    (await fetch(new URL("/audio", server.url), { method: "POST" })).status,
  ).toBe(405);
});

test("avatars are immutable local files with a restricted filename", async () => {
  const path = "/avatars/" + "a".repeat(64) + ".webp";
  const response = await fetch(new URL(path, server.url));
  expect(response.headers.get("content-type")).toBe("image/webp");
  expect(response.headers.get("cache-control")).toContain("immutable");
  expect(await response.text()).toBe("portrait");
  for (const invalid of [
    "/avatars/source.json",
    "/avatars/" + "b".repeat(64) + ".webp",
  ])
    expect((await fetch(new URL(invalid, server.url))).status).toBe(404);
});

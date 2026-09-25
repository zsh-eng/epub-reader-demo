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

test("library and prepared episode routes stay scoped to the selected show", async () => {
  await mkdir(join(folder, "benchmark", "decoder"), { recursive: true });
  await writeFile(
    join(folder, "benchmark", "decoder", "episode.mp3"),
    "decoder-audio",
  );
  await writeFile(
    join(folder, "benchmark", "decoder", "episode.json"),
    JSON.stringify({ title: "Decoder" }),
  );
  await writeFile(
    join(folder, "library.json"),
    JSON.stringify({ shows: [{ id: "decoder" }], episodes: [] }),
  );
  expect(
    await (await fetch(new URL("/library.json", server.url))).json(),
  ).toEqual({ shows: [{ id: "decoder" }], episodes: [] });
  expect(
    await (
      await fetch(new URL("/episodes/decoder/episode.json", server.url))
    ).json(),
  ).toEqual({ title: "Decoder" });
  const audio = await fetch(new URL("/episodes/decoder/audio", server.url), {
    headers: { Range: "bytes=0-6" },
  });
  expect(audio.status).toBe(206);
  expect(await audio.text()).toBe("decoder");
  for (const path of [
    "/episodes/decoder/source.json",
    "/episodes/unknown/audio",
    "/shows/unknown/artwork",
  ])
    expect((await fetch(new URL(path, server.url))).status).toBe(404);
});

test("unchanged library responses revalidate without retransmitting metadata", async () => {
  const first = await fetch(new URL("/library.json", server.url));
  const etag = first.headers.get("etag")!;
  expect(etag).toBeTruthy();
  await first.arrayBuffer();
  const unchanged = await fetch(new URL("/library.json", server.url), {
    headers: { "If-None-Match": etag },
  });
  expect(unchanged.status).toBe(304);
  expect(await unchanged.text()).toBe("");
  await writeFile(
    join(folder, "library.json"),
    JSON.stringify({ shows: [], episodes: [{ id: "new-episode" }] }),
  );
  const changed = await fetch(new URL("/library.json", server.url), {
    headers: { "If-None-Match": etag },
  });
  expect(changed.status).toBe(200);
  expect((await changed.json()).episodes[0].id).toBe("new-episode");
});

test("catalog compression is prebuilt and honors gzip refusal", async () => {
  const bytes = JSON.stringify({ shows: [{ id: "ezra" }], episodes: [] });
  await writeFile(join(folder, "library.json"), bytes);
  await writeFile(join(folder, "library.json.gz"), Bun.gzipSync(bytes));
  const zipped = await fetch(new URL("/library.json", server.url), {
    headers: { "Accept-Encoding": "gzip" },
  });
  expect(zipped.headers.get("content-encoding")).toBe("gzip");
  expect(zipped.headers.get("vary")).toBe("Accept-Encoding");
  expect(await zipped.text()).toBe(bytes);
  const plain = await fetch(new URL("/library.json", server.url), {
    headers: { "Accept-Encoding": "gzip;q=0" },
  });
  expect(plain.headers.get("content-encoding")).toBeNull();
  expect(await plain.text()).toBe(bytes);
});

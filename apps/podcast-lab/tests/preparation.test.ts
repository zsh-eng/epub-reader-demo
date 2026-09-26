import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createServer } from "../server";

// Model inference is the external boundary. Exercise real HTTP, catalog lookup,
// durable state, serialization, duplicate requests, retry and range serving.
test("preparation API queues once, protects local work, persists ready assets and retries", async () => {
  const root = await mkdtemp(join(tmpdir(), "undertone-prepare-"));
  const a = "a".repeat(20),
    b = "b".repeat(20);
  await Bun.write(
    join(root, "library.json"),
    JSON.stringify({
      shows: [
        {
          id: "show",
          title: "A show",
          description: "Context",
          feed: "https://example.org/feed",
        },
      ],
      episodes: [a, b].map((id) => ({
        id,
        showId: "show",
        title: id,
        audioURL: "https://example.org/audio",
        preparedId: null,
      })),
    }),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const runner = async (folder: string) => {
    const id = basename(folder);
    calls.push(id);
    if (id === a) {
      await Bun.write(join(folder, "episode.mp3"), "same analyzed bytes");
      await Bun.write(
        join(folder, "analysis.json"),
        JSON.stringify({
          audioHash: "exact-version",
          rows: ["partial speech"],
          speakers: ["matching speaker"],
          analysisRevision: 1,
        }),
      );
      await Bun.write(
        join(folder, "analysis-state.json"),
        JSON.stringify({
          analysisRevision: 1,
          coverageEnd: 300,
          analysisComplete: false,
        }),
      );
      await gate;
    }
    if (id === b && calls.filter((x) => x === b).length === 1)
      throw new Error("Model unavailable");
    await Bun.write(join(folder, "episode.mp3"), "same analyzed bytes");
    await Bun.write(
      join(folder, "episode.json"),
      JSON.stringify({ audioHash: "exact-version", rows: ["speech"] }),
    );
    await Bun.write(
      join(folder, "status.json"),
      JSON.stringify({ id, phase: "ready", detail: "Ready", ownerPID: 0 }),
    );
  };
  let server = createServer(root, 0, runner);
  const post = (id: string) =>
    fetch(new URL(`/api/preparations/${id}`, server.url), {
      method: "POST",
      headers: { Origin: server.url.origin, "X-Undertone-Preparation": "1" },
    });
  const state = async (id: string) =>
    (await fetch(new URL(`/api/preparations/${id}`, server.url))).json();
  const waitFor = async (id: string, phase: string) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if ((await state(id)).phase === phase) return;
      await Bun.sleep(10);
    }
    expect((await state(id)).phase).toBe(phase);
  };
  try {
    const denied = await fetch(new URL(`/api/preparations/${a}`, server.url), {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "X-Undertone-Preparation": "1",
      },
    });
    expect(denied.status).toBe(403);
    expect((await post("c".repeat(20))).status).toBe(404);
    const responses = await Promise.all([post(a), post(a)]);
    responses.push(await post(b));
    expect(responses.map((r) => r.status)).toEqual([202, 202, 202]);
    expect(calls).toEqual([a]);
    const deadline = Date.now() + 3000;
    while ((await state(a)).analysisRevision !== 1 && Date.now() < deadline)
      await Bun.sleep(10);
    expect((await state(a)).analysisRevision).toBe(1);
    expect(
      await (
        await fetch(new URL(`/episodes/${a}/analysis.json`, server.url))
      ).json(),
    ).toMatchObject({
      rows: ["partial speech"],
      speakers: ["matching speaker"],
      analysisRevision: 1,
    });
    expect(
      (
        await fetch(new URL(`/episodes/${a}/audio`, server.url), {
          headers: { Range: "bytes=0-3" },
        })
      ).status,
    ).toBe(206);
    await Bun.write(
      join(root, "prepared", a, "draft.json"),
      JSON.stringify({ revision: 1, paragraphs: ["Draft speech"] }),
    );
    expect(
      await (
        await fetch(new URL(`/api/preparations/${a}/draft`, server.url))
      ).json(),
    ).toEqual({ revision: 1, paragraphs: ["Draft speech"] });
    expect(
      (await fetch(new URL(`/episodes/${a}/episode.json`, server.url))).status,
    ).toBe(404);
    release();
    await waitFor(a, "ready");
    await waitFor(b, "failed");
    expect(calls).toEqual([a, b]);
    await post(b);
    await waitFor(b, "ready");
    const response = await fetch(new URL(`/episodes/${a}/audio`, server.url), {
      headers: { Range: "bytes=0-3" },
    });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("same");
    expect(
      (await fetch(new URL(`/episodes/${a}/worker.log`, server.url))).status,
    ).toBe(404);
    server.stop(true);
    server = createServer(root, 0, runner);
    expect((await state(a)).phase).toBe("ready");
    await post(a);
    expect(calls).toEqual([a, b, b]);
    expect(
      await (await fetch(new URL("/api/preparations", server.url))).json(),
    ).toEqual([a, b]);
    const interrupted = "d".repeat(20);
    await mkdir(join(root, "prepared", interrupted));
    await Bun.write(
      join(root, "prepared", interrupted, "status.json"),
      JSON.stringify({
        id: interrupted,
        phase: "transcribing",
        detail: "Working",
        ownerPID: 0,
      }),
    );
    expect((await state(interrupted)).phase).toBe("failed");
  } finally {
    release();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

import { afterEach, expect, test } from "bun:test";
import { createRemote } from "../src/lib/sync/server";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const query = { cursor: 0, limit: 500, excludeOwnDevice: false };
const page = { records: [], cursor: 0, head: 0, hasMore: false };
async function collect(source: AsyncIterable<unknown>) {
  const pages = [];
  for await (const item of source) pages.push(item);
  return pages;
}
test("old servers are probed once, then use paginated fallback", async () => {
  const paths: string[] = [];
  globalThis.fetch = (async (input) => {
    const path = String(input);
    paths.push(path);
    return path.includes("pull-stream")
      ? new Response("missing", { status: 404 })
      : Response.json(page);
  }) as typeof fetch;
  const signal = new AbortController().signal;
  const remote = createRemote(signal);
  expect(await collect(remote.pullStream!("device", query, signal))).toEqual([
    page,
  ]);
  expect(await collect(remote.pullStream!("device", query, signal))).toEqual([
    page,
  ]);
  expect(paths.filter((p) => p.includes("pull-stream"))).toHaveLength(1);
  expect(paths).toHaveLength(3);
});
test("does not hide authentication errors behind fallback", async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return new Response("unauthorized", { status: 401 });
  }) as typeof fetch;
  const signal = new AbortController().signal;
  await expect(
    collect(createRemote(signal).pullStream!("device", query, signal)),
  ).rejects.toThrow("401");
  expect(requests).toBe(1);
});
test("reads a complete stream and rejects a truncated one", async () => {
  for (const complete of [true, false]) {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify(page) + "\n" + (complete ? '{"type":"end"}\n' : ""),
        { headers: { "Content-Type": "application/x-ndjson" } },
      )) as typeof fetch;
    const signal = new AbortController().signal;
    const run = collect(
      createRemote(signal).pullStream!("device", query, signal),
    );
    if (complete) expect(await run).toEqual([page]);
    else await expect(run).rejects.toThrow("Truncated");
  }
});

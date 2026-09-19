import { describe, expect, it } from "vitest";
import {
  SyncClient,
  createSyncClientState,
  createSyncPullStream,
  readSyncPullStream,
  MAX_SYNC_STREAM_FRAME_BYTES,
  type SyncPullResponse,
  type SyncRemote,
  type SyncClientStateStore,
  type SyncStorage,
  type SyncRecord,
} from "@zsh-eng/local-sync";
const encoder = new TextEncoder();
const response = (text: string) =>
  new Response(text, { headers: { "Content-Type": "application/x-ndjson" } });
const page = (seq: number, more = true): SyncPullResponse => ({
  records: [
    {
      key: `key-${seq}`,
      value: "opaque",
      schemaVersion: 1,
      isDeleted: false,
      deviceId: "remote",
      hlc: { wallTimeMs: 1, counter: seq },
      serverSeq: seq,
    },
  ],
  cursor: seq,
  head: 3,
  hasMore: more,
});
const collect = async (source: AsyncIterable<SyncPullResponse>) => {
  const values = [];
  for await (const value of source) values.push(value);
  return values;
};
function fixture(
  stream: NonNullable<SyncRemote["pullStream"]>,
  apply?: SyncStorage<readonly SyncRecord[]>["applyRemoteRecords"],
) {
  let current = createSyncClientState("test");
  const stateStore: SyncClientStateStore = {
    read: () => current,
    write: (state) => {
      current = state;
    },
  };
  const applied: number[] = [];
  const client = new SyncClient({
    stateStore,
    remote: {
      pullStream: stream,
      pull: async () => {
        throw new Error("Unexpected fallback");
      },
      push: async () => ({ results: [] }),
    },
    storage: {
      prepareRemoteRecords: (records) => records,
      applyRemoteRecords:
        apply ??
        (async (records) => {
          applied.push(...records.map((r) => r.serverSeq));
          return { applied: records.length, skipped: 0 };
        }),
      getPendingChanges: async () => [],
      reconcilePushResults: async () => 0,
    },
  });
  return { client, stateStore, applied };
}
describe("bounded sync streams", () => {
  it("decodes frames across byte boundaries including UTF-8", async () => {
    const source = page(3, false);
    source.records[0]!.value = "🌱";
    const bytes = encoder.encode(JSON.stringify(source) + '\n{"type":"end"}\n');
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (offset === bytes.length) return c.close();
        c.enqueue(bytes.slice(offset, ++offset));
      },
    });
    expect(
      await collect(
        readSyncPullStream(
          new Response(body, {
            headers: { "Content-Type": "application/x-ndjson" },
          }),
          new AbortController().signal,
        ),
      ),
    ).toEqual([source]);
  });
  it.each([
    "",
    JSON.stringify(page(1)) + "\n",
    '{"type":"end"}\n',
    JSON.stringify(page(3, false)) + '\n{"type":"end"}\n{}\n',
  ])("rejects incomplete or invalid framing", async (text) => {
    await expect(
      collect(readSyncPullStream(response(text), new AbortController().signal)),
    ).rejects.toThrow();
  });
  it("limits a frame before parsing it", async () => {
    await expect(
      collect(
        readSyncPullStream(
          response("x".repeat(MAX_SYNC_STREAM_FRAME_BYTES + 1)),
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow("byte limit");
  });
  it("cancels a stalled read on abort and on idle timeout", async () => {
    for (const abort of [true, false]) {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      });
      const controller = new AbortController();
      const run = collect(
        readSyncPullStream(
          new Response(body, {
            headers: { "Content-Type": "application/x-ndjson" },
          }),
          controller.signal,
          5,
        ),
      );
      if (abort) controller.abort();
      await expect(run).rejects.toThrow();
      expect(cancelled).toBe(true);
    }
  });
  it("keeps a fixed head across clean windows and commits each page once", async () => {
    const requests: unknown[] = [];
    const f = fixture(async function* (_device, request) {
      requests.push(request);
      if (request.cursor === 0) {
        yield page(1);
        yield page(2);
      } else {
        yield page(3, false);
      }
    });
    expect(await f.client.pull()).toEqual({ pulled: 3, skipped: 0 });
    expect(f.applied).toEqual([1, 2, 3]);
    expect(requests).toMatchObject([
      { cursor: 0, excludeOwnDevice: false },
      { cursor: 2, head: 3, excludeOwnDevice: false },
    ]);
    expect(f.stateStore.read()).toMatchObject({
      pullCursor: 3,
      bootstrapped: true,
    });
  });
  it("prefetches only one page while a write is pending", async () => {
    let fetched = 0,
      release!: () => void,
      entered!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = fixture(
      async function* () {
        for (let seq = 1; seq <= 3; seq++) {
          fetched++;
          yield page(seq, seq < 3);
        }
      },
      async (records) => {
        if (records[0]!.serverSeq === 1) {
          entered();
          await gate;
        }
        return { applied: records.length, skipped: 0 };
      },
    );
    const run = f.client.pull();
    await writing;
    await Promise.resolve();
    expect(fetched).toBe(2);
    expect(f.stateStore.read()!.pullCursor).toBe(0);
    release();
    await run;
  });
  it("does not advance past a failed write and cancels its pending reader", async () => {
    let aborted = false;
    const f = fixture(
      async function* (_device, _request, signal) {
        yield page(1);
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          ),
        );
      },
      async () => {
        throw new Error("disk failed");
      },
    );
    await expect(f.client.pull()).rejects.toThrow("disk failed");
    expect(aborted).toBe(true);
    expect(f.stateStore.read()).toMatchObject({
      pullCursor: 0,
      bootstrapped: false,
    });
  });
  it("resumes committed pages after truncation without marking bootstrap complete", async () => {
    let truncated = true;
    const f = fixture(async function* (_device, request, signal) {
      const text =
        [1, 2, 3]
          .filter((n) => n > request.cursor)
          .map((n) => JSON.stringify(page(n, n < 3)))
          .join("\n") + "\n";
      yield* readSyncPullStream(
        response(text + (truncated ? "" : '{"type":"end"}\n')),
        signal,
      );
    });
    await expect(f.client.pull()).rejects.toThrow("Truncated");
    expect(f.stateStore.read()).toMatchObject({
      pullCursor: 3,
      bootstrapped: false,
    });
    // Real server emits a final empty page when all records already committed.
    truncated = false;
    const state = f.stateStore.read()!;
    const client = new SyncClient({
      stateStore: f.stateStore,
      remote: {
        pull: async () => {
          throw new Error();
        },
        push: async () => ({ results: [] }),
        async *pullStream(_d, query) {
          expect(query.cursor).toBe(state.pullCursor);
          yield { records: [], cursor: 3, head: 3, hasMore: false };
        },
      },
      storage: {
        prepareRemoteRecords: (r) => r,
        applyRemoteRecords: async () => ({ applied: 0, skipped: 0 }),
        getPendingChanges: async () => [],
        reconcilePushResults: async () => 0,
      },
    });
    await client.pull();
    expect(f.stateStore.read()!.bootstrapped).toBe(true);
  });
  it("rejects a changed pagination head", async () => {
    const f = fixture(async function* () {
      yield page(1);
      yield { ...page(2), head: 4 };
    });
    await expect(f.client.pull()).rejects.toThrow("head");
    expect(f.stateStore.read()!.pullCursor).toBe(1);
  });
  it("server stream has a clean end and propagates source failures", async () => {
    async function* good() {
      yield page(3, false);
    }
    expect(
      await collect(
        readSyncPullStream(
          new Response(createSyncPullStream(good()), {
            headers: { "Content-Type": "application/x-ndjson" },
          }),
          new AbortController().signal,
        ),
      ),
    ).toEqual([page(3, false)]);
    async function* bad() {
      yield page(1);
      throw new Error("database failed");
    }
    await expect(
      collect(
        readSyncPullStream(
          new Response(createSyncPullStream(bad()), {
            headers: { "Content-Type": "application/x-ndjson" },
          }),
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow("database failed");
  });
});

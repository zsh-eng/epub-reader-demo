import { describe, expect, test, vi } from "vitest";
import { createFilePrefetch, pierreFile } from "../../src/web/data/file-prefetch";
import type { BrowseApi } from "../../src/web/data/browse";
import type { BrowseRead, BrowseSource } from "../../src/shared/browse";

const source: BrowseSource = { kind: "worktree", repo: "/repo" };
const file = (path = "a.ts", origin: BrowseSource = source): BrowseRead => ({
  source: origin,
  path,
  identity: path,
  kind: "text",
  text: "const a = 1",
  size: 11,
});
function fixture(
  read = vi.fn<BrowseApi["read"]>(async (s: BrowseSource, path: string) => file(path, s)),
) {
  const api = { read, list: vi.fn<BrowseApi["list"]>() } as BrowseApi;
  return { cache: createFilePrefetch(api), read };
}
describe("hover prefetch", () => {
  test("joins an in-flight read and uses the visible renderer's syntax identity", async () => {
    let finish!: (file: BrowseRead) => void;
    const read = vi.fn<BrowseApi["read"]>(
      () =>
        new Promise<BrowseRead>((resolve) => {
          finish = resolve;
        }),
    );
    const { cache } = fixture(read);
    const warm = vi.fn<() => Promise<void>>(async () => {});
    cache.prefetch(source, "a.ts", warm);
    const opened = cache.api.read(source, "a.ts");
    finish(file());
    expect(await opened).toEqual(file());
    expect(read).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledWith(pierreFile(file()));
    cache.dispose();
  });
  test("consumes cached bytes once so a subsequent refresh reads again", async () => {
    const { cache, read } = fixture();
    cache.prefetch(source, "a.ts");
    await cache.api.read(source, "a.ts");
    await cache.api.read(source, "a.ts");
    expect(read).toHaveBeenCalledTimes(2);
    cache.dispose();
  });
  test("isolates worktrees and commit versions, and invalidates worktree bytes", async () => {
    const { cache, read } = fixture();
    cache.prefetch(source, "a.ts");
    cache.invalidate();
    await cache.api.read(source, "a.ts");
    await cache.api.read({ kind: "worktree", repo: "/other" }, "a.ts");
    await cache.api.read({ kind: "commit", repo: "/repo", oid: "a".repeat(40) }, "a.ts");
    expect(read).toHaveBeenCalledTimes(4);
    cache.dispose();
  });
  test("bounds speculation to two requests, including syntax work", async () => {
    const { cache, read } = fixture();
    let finish!: () => void;
    const warm = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    cache.prefetch(source, "a.ts", warm);
    cache.prefetch(source, "b.ts", warm);
    await Promise.resolve();
    cache.prefetch(source, "c.ts", warm);
    expect(read).toHaveBeenCalledTimes(2);
    finish();
    cache.dispose();
  });
  test("never highlights metadata responses or large and plain files", async () => {
    for (const result of [
      { ...file(), kind: "binary" as const },
      { ...file(), plain: true },
      { ...file(), text: "x".repeat(300_000) },
    ]) {
      const { cache } = fixture(vi.fn(async () => result));
      const warm = vi.fn<() => Promise<void>>(async () => {});
      cache.prefetch(source, "a.ts", warm);
      await cache.api.read(source, "a.ts");
      expect(warm).not.toHaveBeenCalled();
      cache.dispose();
    }
  });
  test("expires speculative content", async () => {
    const { cache, read } = fixture();
    cache.prefetch(source, "a.ts");
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6000);
    await cache.api.read(source, "a.ts");
    now.mockRestore();
    expect(read).toHaveBeenCalledTimes(2);
    cache.dispose();
  });
  test("a late invalidated read cannot repopulate the cache or warm stale syntax", async () => {
    let finish!: (file: BrowseRead) => void;
    const read = vi
      .fn<BrowseApi["read"]>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(file());
    const { cache } = fixture(read);
    const warm = vi.fn<() => Promise<void>>(async () => {});
    cache.prefetch(source, "a.ts", warm);
    cache.invalidate();
    finish(file());
    await Promise.resolve();
    await cache.api.read(source, "a.ts");
    expect(read).toHaveBeenCalledTimes(2);
    expect(warm).not.toHaveBeenCalled();
    cache.dispose();
  });
  test("does not deliver a prefetched response to an aborted reader", async () => {
    const { cache } = fixture();
    cache.prefetch(source, "a.ts");
    const abort = new AbortController();
    abort.abort();
    await expect(cache.api.read(source, "a.ts", abort.signal)).rejects.toThrow(/abort/i);
    cache.dispose();
  });
});

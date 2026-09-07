import { afterEach, expect, spyOn, test } from "bun:test";
import {
  createImageDatabase,
  ImageCacheStore,
  listUsableCachedImages,
  type ImageCacheDatabase,
} from "./db";

const databases: ImageCacheDatabase[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});
const blob = () => new Blob(["image bytes"], { type: "image/png" });
function database() {
  const value = createImageDatabase(`ImageCache-test-${crypto.randomUUID()}`);
  databases.push(value);
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function metadata(url: string) {
  return { url, altText: "Image", cachedAt: 1, thumbnail: blob(), size: 22 };
}

test("repairs incomplete records and deduplicates display and download requests", async () => {
  const db = database();
  await db.images.put({ url: "https://image/a" });
  let fetches = 0;
  const cache = new ImageCacheStore(
    db,
    async () => {
      fetches++;
      return blob();
    },
    async () => blob(),
  );
  const [first, second] = await Promise.all([
    cache.acquire("https://image/a", "first"),
    cache.acquire("https://image/a", "second"),
    cache.download("https://image/a", "third"),
  ]);
  expect(first).toBe(second);
  expect(fetches).toBe(1);
  expect(cache.memory.get("https://image/a")?.referenceCount).toBe(2);
  expect(
    (await db.imageBlobs.get("https://image/a"))?.content.size,
  ).toBeGreaterThan(0);
  cache.release("https://image/a");
  expect(cache.memory.has("https://image/a")).toBe(true);
  cache.release("https://image/a");
  expect(cache.memory.size).toBe(0);
  await db.imageBlobs.delete("https://image/a");
  await cache.download("https://image/a", "repair");
  expect(fetches).toBe(2);
  expect(await listUsableCachedImages(db)).toHaveLength(1);
});

test("cache repair is atomic when the blob write fails", async () => {
  const db = database();
  await db.images.put({ url: "https://image/a" });
  const cache = new ImageCacheStore(
    db,
    async () => blob(),
    async () => blob(),
  );
  const fail = () => {
    throw new Error("Blob write rejected");
  };
  db.imageBlobs.hook("creating", fail);
  await expect(cache.download("https://image/a", "alt")).rejects.toThrow(
    "Blob write rejected",
  );
  expect(await db.images.get("https://image/a")).toEqual({
    url: "https://image/a",
  });
  expect(await db.imageBlobs.count()).toBe(0);
  db.imageBlobs.hook("creating").unsubscribe(fail);
  await cache.download("https://image/a", "alt");
  expect(await listUsableCachedImages(db)).toHaveLength(1);
});

test("offline count excludes metadata-only and empty full-content records", async () => {
  const db = database();
  await db.images.bulkPut([
    metadata("valid"),
    metadata("missing"),
    metadata("empty"),
    { url: "uncached" },
  ]);
  await db.imageBlobs.bulkPut([
    { url: "valid", content: blob() },
    { url: "empty", content: new Blob() },
  ]);
  expect((await listUsableCachedImages(db)).map((image) => image.url)).toEqual([
    "valid",
  ]);
});

test("HTTP errors are not persisted and a retry is allowed", async () => {
  const db = database();
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("Not found", { status: 404 }),
  );
  try {
    const cache = new ImageCacheStore(db, undefined, async () => blob());
    await expect(
      cache.download("https://image/missing", "alt"),
    ).rejects.toThrow("404");
    expect(await db.images.count()).toBe(0);
    fetch.mockResolvedValue(new Response(blob()));
    await cache.download("https://image/missing", "alt");
    expect(await db.images.count()).toBe(1);
  } finally {
    fetch.mockRestore();
  }
});

test("sign-out revokes references and blocks late downloads and all future writes", async () => {
  const db = database();
  await db.images.put(metadata("cached"));
  await db.imageBlobs.put({ url: "cached", content: blob() });
  const pending = deferred<Blob>();
  const started = deferred<void>();
  const cache = new ImageCacheStore(
    db,
    async () => {
      started.resolve();
      return pending.promise;
    },
    async () => blob(),
  );
  await cache.acquire("cached", "alt");
  const revoke = spyOn(URL, "revokeObjectURL");
  const delayed = cache.acquire("delayed", "alt");
  // Attach the rejection assertion before releasing the deferred download.
  const rejected = delayed.catch((error: Error) => error);
  await started.promise;
  await cache.clear();
  expect(cache.memory.size).toBe(0);
  expect(revoke).toHaveBeenCalledTimes(1);
  pending.resolve(blob());
  expect(await rejected).toBeInstanceOf(Error);
  await db.open();
  await expect(cache.download("future", "alt")).rejects.toThrow(
    "cleared for sign-out",
  );
  expect(await db.images.count()).toBe(0);
  expect(await db.imageBlobs.count()).toBe(0);
  revoke.mockRestore();
});

test("sign-out invalidates a delayed thumbnail before persistence", async () => {
  const db = database();
  const pending = deferred<Blob>();
  const started = deferred<void>();
  const cache = new ImageCacheStore(
    db,
    async () => blob(),
    async () => {
      started.resolve();
      return pending.promise;
    },
  );
  const request = cache.download("delayed-thumbnail", "alt");
  const rejected = request.catch((error: Error) => error);
  await started.promise;
  await cache.clear();
  pending.resolve(blob());
  expect(await rejected).toBeInstanceOf(Error);
  await db.open();
  expect(await db.images.count()).toBe(0);
});

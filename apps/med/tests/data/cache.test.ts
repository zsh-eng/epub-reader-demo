import { describe, expect, test } from "vitest";
import { ByteLru } from "../../src/web/data/cache";

describe("byte-bounded review cache", () => {
  test("evicts the least-recently-used review and refuses an oversized entry", () => {
    const cache = new ByteLru<string>(10, 3);
    cache.set("a", "first", 4);
    cache.set("b", "second", 4);
    expect(cache.get("a")).toBe("first");
    cache.set("c", "third", 4);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("first");
    expect(cache.bytes).toBe(8);
    cache.set("large", "cannot retain", 11);
    expect(cache.get("large")).toBeUndefined();
    expect(cache.bytes).toBe(8);
    cache.set("a", "replacement", 2);
    expect(cache.bytes).toBe(6);
  });
});

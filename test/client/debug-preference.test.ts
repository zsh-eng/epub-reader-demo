import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => vi.unstubAllEnvs());

describe("local debug preference", () => {
  it.each([true, false])(
    "uses the build default DEV=%s without saving it",
    async (development) => {
      vi.stubEnv("DEV", development);
      const store = await import("@/lib/debug-preference");
      expect(store.getDebugEnabled()).toBe(development);
      expect(localStorage.getItem(store.DEBUG_ENABLED_STORAGE_KEY)).toBeNull();
    },
  );

  it.each([true, false])(
    "keeps the explicit choice %s across reload and build changes",
    async (enabled) => {
      const store = await import("@/lib/debug-preference");
      store.setDebugEnabled(enabled);
      vi.resetModules();
      vi.stubEnv("DEV", !enabled);
      const restored = await import("@/lib/debug-preference");
      expect(restored.getDebugEnabled()).toBe(enabled);
      expect(localStorage.getItem(store.DEBUG_ENABLED_STORAGE_KEY)).toBe(
        String(enabled),
      );
    },
  );

  it("updates other subscribers when a tab changes or clears the preference", async () => {
    vi.stubEnv("DEV", false);
    const store = await import("@/lib/debug-preference");
    const listener = vi.fn();
    const unsubscribe = store.subscribeDebugPreference(listener);
    localStorage.setItem(store.DEBUG_ENABLED_STORAGE_KEY, "true");
    window.dispatchEvent(
      new StorageEvent("storage", { key: store.DEBUG_ENABLED_STORAGE_KEY }),
    );
    expect(store.getDebugEnabled()).toBe(true);
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(store.getDebugEnabled()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

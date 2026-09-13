import { describe, expect, it } from "vitest";
import {
  createSyncClientStateStore,
  getOrCreateSyncClientState,
  nextSyncHlcBatch,
  observeSyncHlcBatch,
  tickSyncHlcBatch,
  compareSyncVersions,
} from "@zsh-eng/local-sync";

describe("client-owned clock and state", () => {
  it("isolates accounts in one storage provider and survives a restart", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const a = createSyncClientStateStore(storage, "app/account-a");
    const b = createSyncClientStateStore(storage, "app/account-b");
    getOrCreateSyncClientState("device-a", a);
    getOrCreateSyncClientState("device-b", b);
    nextSyncHlcBatch(2, a, 1_000);
    a.write({ ...a.read()!, pullCursor: 42, bootstrapped: true });

    const restarted = createSyncClientStateStore(storage, "app/account-a");
    expect(nextSyncHlcBatch(1, restarted, 900)).toEqual([
      { wallTimeMs: 1_000, counter: 2 },
    ]);
    expect(restarted.read()?.pullCursor).toBe(42);
    expect(b.read()).toMatchObject({
      deviceId: "device-b",
      pullCursor: 0,
      hlc: { wallTimeMs: 0, counter: 0 },
    });
    expect([...data.keys()]).toEqual(["app/account-a", "app/account-b"]);
  });

  it("observes remote-ahead clocks and breaks equal-clock ties consistently", () => {
    let state = getOrCreateSyncClientState("device-a", {
      read: () => null,
      write: () => {},
    });
    const store = {
      read: () => state,
      write: (next: typeof state) => {
        state = next;
      },
    };
    observeSyncHlcBatch([{ wallTimeMs: 2_000, counter: 9 }], store);
    const [hlc] = nextSyncHlcBatch(1, store, 1_000);
    expect(hlc).toEqual({ wallTimeMs: 2_000, counter: 10 });
    expect(
      compareSyncVersions(
        { hlc: hlc!, deviceId: "a" },
        { hlc: hlc!, deviceId: "b" },
      ),
    ).toBe(-1);
  });

  it("ticks without browser state or a global wall clock", () => {
    expect(tickSyncHlcBatch({ wallTimeMs: 0, counter: 0 }, 2, 300)).toEqual([
      { wallTimeMs: 300, counter: 0 },
      { wallTimeMs: 300, counter: 1 },
    ]);
    expect(() =>
      tickSyncHlcBatch({ wallTimeMs: 0, counter: 0 }, -1, 300),
    ).toThrow();
  });
});

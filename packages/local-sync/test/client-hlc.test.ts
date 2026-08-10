import { describe, expect, it } from "vitest";
import {
  createHybridLogicalClock,
  type HlcStateStorage,
  type HlcStateTransition,
} from "../src/client/index.js";
import type { HybridLogicalTimestamp } from "../src/core/index.js";

class MemoryHlcStateStorage implements HlcStateStorage {
  private readonly states = new Map<string, HybridLogicalTimestamp>();
  private operationTail: Promise<void> = Promise.resolve();
  updateCount = 0;

  update(
    deviceId: string,
    transition: HlcStateTransition,
  ): Promise<HybridLogicalTimestamp> {
    const result = this.operationTail.then(() => {
      this.updateCount += 1;
      const stored = this.states.get(deviceId);
      const current = stored === undefined ? undefined : { ...stored };
      const next = transition(current);
      const persisted = Object.freeze({ ...next });
      this.states.set(deviceId, persisted);
      return persisted;
    });
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

describe("client hybrid logical clock", () => {
  it("uses physical time and a counter to remain monotonic", async () => {
    const stateStorage = new MemoryHlcStateStorage();
    let now = 100;
    const clock = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage,
      now: () => now,
    });

    await expect(clock.tick()).resolves.toEqual({
      wallTimeMs: 100,
      counter: 0,
    });
    await expect(clock.tick()).resolves.toEqual({
      wallTimeMs: 100,
      counter: 1,
    });

    now = 90;
    await expect(clock.tick()).resolves.toEqual({
      wallTimeMs: 100,
      counter: 2,
    });

    now = 101;
    await expect(clock.tick()).resolves.toEqual({
      wallTimeMs: 101,
      counter: 0,
    });
  });

  it("restores state across clock instances and isolates devices", async () => {
    const stateStorage = new MemoryHlcStateStorage();
    const first = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage,
      now: () => 100,
    });
    await first.tick();

    const restarted = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage,
      now: () => 50,
    });
    const otherDevice = createHybridLogicalClock({
      deviceId: "device-2",
      stateStorage,
      now: () => 50,
    });

    await expect(restarted.tick()).resolves.toEqual({
      wallTimeMs: 100,
      counter: 1,
    });
    await expect(otherDevice.tick()).resolves.toEqual({
      wallTimeMs: 50,
      counter: 0,
    });
  });

  it("advances causally after remote timestamps", async () => {
    const stateStorage = new MemoryHlcStateStorage();
    let now = 10;
    const clock = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage,
      now: () => now,
    });

    await expect(
      clock.observe({ wallTimeMs: 20, counter: 3 }),
    ).resolves.toEqual({ wallTimeMs: 20, counter: 4 });
    await expect(
      clock.observe({ wallTimeMs: 15, counter: 100 }),
    ).resolves.toEqual({ wallTimeMs: 20, counter: 5 });
    await expect(
      clock.observe({ wallTimeMs: 20, counter: 8 }),
    ).resolves.toEqual({ wallTimeMs: 20, counter: 9 });

    now = 30;
    await expect(
      clock.observe({ wallTimeMs: 25, counter: 100 }),
    ).resolves.toEqual({ wallTimeMs: 30, counter: 0 });
  });

  it("serializes concurrent timestamp allocation through storage", async () => {
    const clock = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage: new MemoryHlcStateStorage(),
      now: () => 100,
    });

    const timestamps = await Promise.all(
      Array.from({ length: 50 }, () => clock.tick()),
    );

    expect(timestamps.map(({ counter }) => counter)).toEqual(
      Array.from({ length: 50 }, (_, counter) => counter),
    );
  });

  it("reserves a consecutive batch in one durable update", async () => {
    const stateStorage = new MemoryHlcStateStorage();
    const clock = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage,
      now: () => 100,
    });

    await expect(clock.tickMany(4)).resolves.toEqual([
      { wallTimeMs: 100, counter: 0 },
      { wallTimeMs: 100, counter: 1 },
      { wallTimeMs: 100, counter: 2 },
      { wallTimeMs: 100, counter: 3 },
    ]);
    expect(stateStorage.updateCount).toBe(1);
    await expect(clock.tick()).resolves.toEqual({
      wallTimeMs: 100,
      counter: 4,
    });
  });

  it("returns an empty batch without advancing durable state", async () => {
    const stateStorage = new MemoryHlcStateStorage();
    const clock = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage,
      now: () => 100,
    });

    await expect(clock.tickMany(0)).resolves.toEqual([]);
    expect(stateStorage.updateCount).toBe(0);
    await expect(clock.tickMany(-1)).rejects.toThrow(
      "HLC batch count must be a non-negative safe integer",
    );
    expect(stateStorage.updateCount).toBe(0);
  });

  it("rejects invalid device IDs", () => {
    const stateStorage = new MemoryHlcStateStorage();

    expect(() =>
      createHybridLogicalClock({
        deviceId: "invalid device",
        stateStorage,
      }),
    ).toThrow("deviceId must use NanoID-compatible ASCII characters");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHybridLogicalClock } from "../src/client/index.js";
import {
  initializeSqliteSchema,
  SqliteHlcStateStorage,
} from "../src/adapters/sqlite/index.js";
import { defineSyncSchema, table, text } from "../src/schema/index.js";
import { BunSqliteTestDriver } from "./support/bun-sqlite-driver.js";

interface StoredHlcRow {
  readonly device_id: string;
  readonly wall_time_ms: number;
  readonly counter: number;
}

describe("SQLite HLC state storage", () => {
  let driver: BunSqliteTestDriver;

  beforeEach(async () => {
    driver = new BunSqliteTestDriver();
    await initializeSqliteSchema(
      driver,
      defineSyncSchema({
        books: table({ id: text().primaryKey() }),
      }),
    );
  });

  afterEach(() => {
    driver.close();
  });

  it("persists clock state across instances and device IDs", async () => {
    const stateStorage = new SqliteHlcStateStorage(driver);
    const first = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage,
      now: () => 100,
    });
    await first.tick();
    await first.tick();

    const restarted = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage: new SqliteHlcStateStorage(driver),
      now: () => 50,
    });
    const otherDevice = createHybridLogicalClock({
      deviceId: "device-2",
      stateStorage,
      now: () => 50,
    });

    await expect(restarted.tick()).resolves.toEqual({
      wallTimeMs: 100,
      counter: 2,
    });
    await expect(otherDevice.tick()).resolves.toEqual({
      wallTimeMs: 50,
      counter: 0,
    });
    expect(
      await driver.all<StoredHlcRow>(
        `select device_id, wall_time_ms, counter
         from sync_hlc_state
         order by device_id`,
        [],
      ),
    ).toEqual([
      { device_id: "device-1", wall_time_ms: 100, counter: 2 },
      { device_id: "device-2", wall_time_ms: 50, counter: 0 },
    ]);
  });

  it("rolls back failed transitions and remains usable", async () => {
    const stateStorage = new SqliteHlcStateStorage(driver);
    const clock = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage,
      now: () => 100,
    });
    await clock.tick();

    await expect(
      stateStorage.update("device-1", () => {
        throw new Error("transition failed");
      }),
    ).rejects.toThrow("transition failed");
    await expect(clock.tick()).resolves.toEqual({
      wallTimeMs: 100,
      counter: 1,
    });
  });

  it("serializes concurrent updates on one storage instance", async () => {
    const clock = createHybridLogicalClock({
      deviceId: "device-1",
      stateStorage: new SqliteHlcStateStorage(driver),
      now: () => 100,
    });

    const timestamps = await Promise.all(
      Array.from({ length: 25 }, () => clock.tick()),
    );

    expect(timestamps.map(({ counter }) => counter)).toEqual(
      Array.from({ length: 25 }, (_, counter) => counter),
    );
  });

  it("persists only the final timestamp from a reserved batch", async () => {
    const stateStorage = new SqliteHlcStateStorage(driver);
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
    expect(
      await driver.all<StoredHlcRow>(
        `select device_id, wall_time_ms, counter
         from sync_hlc_state`,
        [],
      ),
    ).toEqual([{ device_id: "device-1", wall_time_ms: 100, counter: 3 }]);
  });
});

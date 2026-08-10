import {
  type HybridLogicalTimestamp,
  isValidSyncDeviceId,
} from "../core/index.js";

export type HlcStateTransition = (
  current: HybridLogicalTimestamp | undefined,
) => HybridLogicalTimestamp;

/**
 * Durable state boundary used by the client clock.
 *
 * Implementations must apply each synchronous transition atomically and return
 * only after the resulting state is durable. A transition must be free of side
 * effects because a storage implementation may retry it after contention.
 */
export interface HlcStateStorage {
  update(
    deviceId: string,
    transition: HlcStateTransition,
  ): Promise<HybridLogicalTimestamp>;
}

export interface HybridLogicalClock {
  readonly deviceId: string;

  /** Allocates a durable timestamp for a new local event. */
  tick(): Promise<HybridLogicalTimestamp>;

  /** Allocates consecutive durable timestamps in one state update. */
  tickMany(count: number): Promise<readonly HybridLogicalTimestamp[]>;

  /** Advances the durable clock after observing a remote event. */
  observe(remote: HybridLogicalTimestamp): Promise<HybridLogicalTimestamp>;
}

export interface HybridLogicalClockOptions {
  readonly deviceId: string;
  readonly stateStorage: HlcStateStorage;
  readonly now?: () => number;
}

/** Creates a client-owned HLC backed by injected durable state storage. */
export function createHybridLogicalClock(
  options: HybridLogicalClockOptions,
): HybridLogicalClock {
  if (!isValidSyncDeviceId(options.deviceId)) {
    throw new Error("deviceId must use NanoID-compatible ASCII characters");
  }

  const physicalClock = options.now ?? Date.now;

  return Object.freeze({
    deviceId: options.deviceId,

    async tick(): Promise<HybridLogicalTimestamp> {
      const wallTimeMs = physicalClock();
      return options.stateStorage.update(options.deviceId, (current) =>
        tick(current, wallTimeMs),
      );
    },

    async tickMany(count: number): Promise<readonly HybridLogicalTimestamp[]> {
      assertNonNegativeSafeInteger(count, "HLC batch count");
      if (count === 0) {
        return Object.freeze([]);
      }

      const wallTimeMs = physicalClock();
      const finalTimestamp = await options.stateStorage.update(
        options.deviceId,
        (current) => {
          const first = tick(current, wallTimeMs);
          return createTimestamp(
            first.wallTimeMs,
            addToCounter(first.counter, count - 1),
          );
        },
      );

      const firstCounter = finalTimestamp.counter - (count - 1);
      return Object.freeze(
        Array.from({ length: count }, (_, index) =>
          createTimestamp(finalTimestamp.wallTimeMs, firstCounter + index),
        ),
      );
    },

    async observe(
      remote: HybridLogicalTimestamp,
    ): Promise<HybridLogicalTimestamp> {
      const wallTimeMs = physicalClock();
      return options.stateStorage.update(options.deviceId, (current) =>
        receive(current, remote, wallTimeMs),
      );
    },
  });
}

function tick(
  current: HybridLogicalTimestamp | undefined,
  wallTimeMs: number,
): HybridLogicalTimestamp {
  if (current === undefined) {
    return createTimestamp(wallTimeMs, 0);
  }

  if (wallTimeMs > current.wallTimeMs) {
    return createTimestamp(wallTimeMs, 0);
  }

  return createTimestamp(current.wallTimeMs, increment(current.counter));
}

function receive(
  current: HybridLogicalTimestamp | undefined,
  remote: HybridLogicalTimestamp,
  physicalWallTimeMs: number,
): HybridLogicalTimestamp {
  if (current === undefined) {
    if (physicalWallTimeMs > remote.wallTimeMs) {
      return createTimestamp(physicalWallTimeMs, 0);
    }

    return createTimestamp(remote.wallTimeMs, increment(remote.counter));
  }

  const wallTimeMs = Math.max(
    physicalWallTimeMs,
    current.wallTimeMs,
    remote.wallTimeMs,
  );

  if (wallTimeMs === current.wallTimeMs && wallTimeMs === remote.wallTimeMs) {
    return createTimestamp(
      wallTimeMs,
      increment(Math.max(current.counter, remote.counter)),
    );
  }

  if (wallTimeMs === current.wallTimeMs) {
    return createTimestamp(wallTimeMs, increment(current.counter));
  }

  if (wallTimeMs === remote.wallTimeMs) {
    return createTimestamp(wallTimeMs, increment(remote.counter));
  }

  return createTimestamp(wallTimeMs, 0);
}

function increment(value: number): number {
  return addToCounter(value, 1);
}

function addToCounter(value: number, amount: number): number {
  if (amount > Number.MAX_SAFE_INTEGER - value) {
    throw new Error("HLC logical counter exceeds the safe integer range");
  }

  return value + amount;
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

function createTimestamp(
  wallTimeMs: number,
  counter: number,
): HybridLogicalTimestamp {
  return Object.freeze({ wallTimeMs, counter });
}

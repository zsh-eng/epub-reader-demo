import type { SyncHlc } from "./protocol.js";

/** Reserve ordered versions, including when wall time moves backwards. */
export function tickSyncHlcBatch(
  previous: SyncHlc,
  count: number,
  now: number,
): SyncHlc[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("HLC batch count must be a non-negative safe integer");
  }
  const wallTimeMs = Math.max(now, previous.wallTimeMs);
  const firstCounter =
    wallTimeMs > previous.wallTimeMs ? 0 : previous.counter + 1;
  return Array.from({ length: count }, (_, index) => ({
    wallTimeMs,
    counter: firstCounter + index,
  }));
}

export function compareSyncHlc(left: SyncHlc, right: SyncHlc): number {
  return left.wallTimeMs === right.wallTimeMs
    ? left.counter - right.counter
    : left.wallTimeMs - right.wallTimeMs;
}

/** Observe remote versions without creating a local mutation. */
export function observeSyncHlc(
  previous: SyncHlc,
  timestamps: readonly SyncHlc[],
): SyncHlc {
  return timestamps.reduce(
    (latest, candidate) =>
      compareSyncHlc(candidate, latest) > 0 ? candidate : latest,
    previous,
  );
}

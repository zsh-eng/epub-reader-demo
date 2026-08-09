import type {
  HlcStateStorage,
  HlcStateTransition,
} from "../../client/index.js";
import {
  type HybridLogicalTimestamp,
  isValidSyncDeviceId,
} from "../../core/index.js";
import type { SqlDriver } from "./index.js";

interface HlcStateRow {
  readonly wall_time_ms: number;
  readonly counter: number;
}

/** Persists one atomic HLC state row per device in local SQLite. */
export class SqliteHlcStateStorage implements HlcStateStorage {
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly driver: SqlDriver) {}

  update(
    deviceId: string,
    transition: HlcStateTransition,
  ): Promise<HybridLogicalTimestamp> {
    if (!isValidSyncDeviceId(deviceId)) {
      return Promise.reject(
        new Error("deviceId must use NanoID-compatible ASCII characters"),
      );
    }

    return this.enqueue(() =>
      this.driver.transaction(async (transaction) => {
        const rows = await transaction.all<HlcStateRow>(
          `select wall_time_ms, counter
           from sync_hlc_state
           where device_id = ?`,
          [deviceId],
        );
        const row = rows[0];
        const current =
          row === undefined
            ? undefined
            : createTimestamp(row.wall_time_ms, row.counter);
        const next = transition(current);
        assertTimestamp(next);

        await transaction.run(
          `insert into sync_hlc_state (
             device_id, wall_time_ms, counter
           ) values (?, ?, ?)
           on conflict (device_id) do update set
             wall_time_ms = excluded.wall_time_ms,
             counter = excluded.counter`,
          [deviceId, next.wallTimeMs, next.counter],
        );

        return createTimestamp(next.wallTimeMs, next.counter);
      }),
    );
  }

  private enqueue<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function assertTimestamp(timestamp: HybridLogicalTimestamp): void {
  assertNonNegativeSafeInteger(timestamp.wallTimeMs, "HLC wallTimeMs");
  assertNonNegativeSafeInteger(timestamp.counter, "HLC counter");
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
  assertNonNegativeSafeInteger(wallTimeMs, "stored HLC wallTimeMs");
  assertNonNegativeSafeInteger(counter, "stored HLC counter");
  return Object.freeze({ wallTimeMs, counter });
}

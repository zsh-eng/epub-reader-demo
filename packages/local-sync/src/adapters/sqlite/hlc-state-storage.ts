import type {
  HlcStateStorage,
  HlcStateTransition,
} from "../../client/index.js";
import type { HybridLogicalTimestamp } from "../../core/index.js";
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
            : { wallTimeMs: row.wall_time_ms, counter: row.counter };
        const next = transition(current);

        await transaction.run(
          `insert into sync_hlc_state (
             device_id, wall_time_ms, counter
           ) values (?, ?, ?)
           on conflict (device_id) do update set
             wall_time_ms = excluded.wall_time_ms,
             counter = excluded.counter`,
          [deviceId, next.wallTimeMs, next.counter],
        );

        return next;
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

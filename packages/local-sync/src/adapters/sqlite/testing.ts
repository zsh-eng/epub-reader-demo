import type {
  SqlDriver,
  SqlExecutor,
  SqlParameters,
  SqlRunResult,
} from "./index.js";

export type FakeSqlCall =
  | {
      readonly kind: "run";
      readonly sql: string;
      readonly parameters: SqlParameters;
    }
  | {
      readonly kind: "all";
      readonly sql: string;
      readonly parameters: SqlParameters;
    }
  | {
      readonly kind: "transaction";
      readonly phase: "begin" | "commit" | "rollback";
    };

/**
 * Deterministic recording fake for testing code built on the SQLite boundary.
 * It records calls and returns explicitly queued results; it does not execute
 * SQL or emulate SQLite behavior.
 */
export class FakeSqlDriver implements SqlDriver {
  private readonly recordedCalls: FakeSqlCall[] = [];
  private readonly runResults: SqlRunResult[] = [];
  private readonly queryResults: (readonly unknown[])[] = [];

  get calls(): readonly FakeSqlCall[] {
    return this.recordedCalls;
  }

  enqueueRunResult(result: SqlRunResult): void {
    this.runResults.push(result);
  }

  enqueueRows<TRow>(rows: readonly TRow[]): void {
    this.queryResults.push([...rows]);
  }

  async run(sql: string, parameters: SqlParameters): Promise<SqlRunResult> {
    this.recordedCalls.push({
      kind: "run",
      sql,
      parameters: [...parameters],
    });

    const result = this.runResults.shift();
    if (result === undefined) {
      throw new Error(`No fake run result queued for SQL: ${sql}`);
    }

    return result;
  }

  async all<TRow>(
    sql: string,
    parameters: SqlParameters,
  ): Promise<readonly TRow[]> {
    this.recordedCalls.push({
      kind: "all",
      sql,
      parameters: [...parameters],
    });

    const rows = this.queryResults.shift();
    if (rows === undefined) {
      throw new Error(`No fake query result queued for SQL: ${sql}`);
    }

    return rows as readonly TRow[];
  }

  async transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    this.recordedCalls.push({ kind: "transaction", phase: "begin" });

    try {
      const result = await work(this);
      this.recordedCalls.push({ kind: "transaction", phase: "commit" });
      return result;
    } catch (error) {
      this.recordedCalls.push({ kind: "transaction", phase: "rollback" });
      throw error;
    }
  }
}

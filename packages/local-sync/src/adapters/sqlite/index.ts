/** Values that every supported SQLite adapter must be able to bind. */
export type SqlValue = null | number | string;

export type SqlParameters = readonly SqlValue[];
export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface SqlRunResult {
  readonly rowsAffected: number;
}

/** SQL operations available both on a database and inside a transaction. */
export interface SqlExecutor {
  run(sql: string, parameters: SqlParameters): Promise<SqlRunResult>;
  all<TRow = SqlRow>(
    sql: string,
    parameters: SqlParameters,
  ): Promise<readonly TRow[]>;
}

/**
 * Minimal async boundary implemented by sqlite-wasm and Expo SQLite adapters.
 *
 * A transaction commits when the callback resolves and rolls back when it
 * rejects. The callback receives an executor without a nested transaction API.
 */
export interface SqlDriver extends SqlExecutor {
  transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult>;
}

export * from "./hlc-state-storage.js";
export * from "./schema.js";

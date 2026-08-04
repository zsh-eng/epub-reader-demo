import { Database } from "bun:sqlite";
import type {
  SqlDriver,
  SqlExecutor,
  SqlParameters,
  SqlRunResult,
  SqlRow,
} from "../../src/adapters/sqlite/index.js";

/** Real in-memory SQLite implementation used only by adapter conformance tests. */
export class BunSqliteTestDriver implements SqlDriver {
  private readonly database = new Database(":memory:", { strict: true });

  close(): void {
    this.database.close();
  }

  async run(sql: string, parameters: SqlParameters): Promise<SqlRunResult> {
    const result = this.database.run(sql, [...parameters]);
    return { rowsAffected: result.changes };
  }

  async all<TRow = SqlRow>(
    sql: string,
    parameters: SqlParameters,
  ): Promise<readonly TRow[]> {
    return this.database.query(sql).all(...parameters) as TRow[];
  }

  async transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    this.database.run("begin immediate");

    try {
      const result = await work(this);
      this.database.run("commit");
      return result;
    } catch (error) {
      this.database.run("rollback");
      throw error;
    }
  }
}

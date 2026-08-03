import { describe, expect, expectTypeOf, it } from "vitest";
import type { SqlDriver, SqlRunResult } from "../src/adapters/sqlite/index.js";
import { FakeSqlDriver } from "../src/adapters/sqlite/testing.js";

interface BookRow {
  id: string;
  title: string;
}

describe("SQLite driver boundary", () => {
  it("records writes and returns queued results", async () => {
    const driver = new FakeSqlDriver();
    driver.enqueueRunResult({ rowsAffected: 1 });

    const result = await driver.run("update books set title = ? where id = ?", [
      "Updated",
      "book-1",
    ]);

    expect(result).toEqual({ rowsAffected: 1 });
    expect(driver.calls).toEqual([
      {
        kind: "run",
        sql: "update books set title = ? where id = ?",
        parameters: ["Updated", "book-1"],
      },
    ]);
    expectTypeOf(result).toEqualTypeOf<SqlRunResult>();
  });

  it("records queries and preserves their row type", async () => {
    const driver = new FakeSqlDriver();
    driver.enqueueRows<BookRow>([{ id: "book-1", title: "Example" }]);

    const rows = await driver.all<BookRow>(
      "select id, title from books where id = ?",
      ["book-1"],
    );

    expect(rows).toEqual([{ id: "book-1", title: "Example" }]);
    expect(driver.calls[0]).toEqual({
      kind: "all",
      sql: "select id, title from books where id = ?",
      parameters: ["book-1"],
    });
    expectTypeOf(rows).toEqualTypeOf<readonly BookRow[]>();
  });

  it("commits a successful transaction", async () => {
    const driver = new FakeSqlDriver();
    driver.enqueueRunResult({ rowsAffected: 1 });

    const result = await driver.transaction(async (transaction) => {
      await transaction.run("insert into books (id) values (?)", ["book-1"]);
      return "committed";
    });

    expect(result).toBe("committed");
    expect(driver.calls.map(formatCall)).toEqual([
      "transaction:begin",
      "run:insert into books (id) values (?)",
      "transaction:commit",
    ]);
  });

  it("records a rollback when transaction work rejects", async () => {
    const driver = new FakeSqlDriver();
    const failure = new Error("stop transaction");

    await expect(
      driver.transaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(driver.calls.map(formatCall)).toEqual([
      "transaction:begin",
      "transaction:rollback",
    ]);
  });

  it("rejects operations without an explicitly queued result", async () => {
    const driver = new FakeSqlDriver();

    await expect(driver.all("select 1", [])).rejects.toThrow(
      "No fake query result queued for SQL: select 1",
    );
    await expect(driver.run("delete from books", [])).rejects.toThrow(
      "No fake run result queued for SQL: delete from books",
    );
  });

  it("implements the public driver interface", () => {
    expectTypeOf<FakeSqlDriver>().toMatchTypeOf<SqlDriver>();
  });
});

function formatCall(call: FakeSqlDriver["calls"][number]): string {
  if (call.kind === "transaction") {
    return `${call.kind}:${call.phase}`;
  }

  return `${call.kind}:${call.sql}`;
}

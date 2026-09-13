import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSyncHonoRoutes,
  SYNC_D1_SCHEMA_SQL,
  type SyncD1Database,
  type SyncD1Statement,
} from "@zsh-eng/local-sync/hono";
import {
  type SyncPushChange,
  type SyncPushResponse,
  type SyncPullResponse,
} from "@zsh-eng/local-sync";

// Execute the package's actual SQL against SQLite. Reader also tests this adapter
// in Cloudflare's D1 runtime with its production migrations and authentication.
class Statement implements SyncD1Statement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private values: SQLInputValue[] = [];
  constructor(database: DatabaseSync, sql: string) {
    this.database = database;
    this.sql = sql;
  }
  bind(...values: unknown[]) {
    this.values = values as SQLInputValue[];
    return this;
  }
  async first<T>(): Promise<T | null> {
    return (
      (this.database.prepare(this.sql).get(...this.values) as T | undefined) ??
      null
    );
  }
  async all<T>(): Promise<{ results: T[] }> {
    return {
      results: this.database.prepare(this.sql).all(...this.values) as T[],
    };
  }
}
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
type AppEnv = { Variables: { account: string; device: string | undefined } };

function app() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  sqlite.exec(SYNC_D1_SCHEMA_SQL);
  const database: SyncD1Database = {
    prepare: (sql) => new Statement(sqlite, sql),
    async batch<T>(statements: SyncD1Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements)
          results.push(await statement.all<T>());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return new Hono<AppEnv>().route(
    "/bridge",
    createSyncHonoRoutes<AppEnv>({
      requireAuth: async (c, next) => {
        // Authentication fixture: production hosts supply their own session middleware.
        const account = c.req.header("Test-Account");
        if (!account) return c.json({ error: "Unauthorized" }, 401);
        c.set("account", account);
        c.set("device", c.req.header("Test-Device"));
        await next();
      },
      getIdentity: (c) => ({
        userId: c.get("account"),
        deviceId: c.get("device"),
      }),
      getDatabase: () => database,
      now: () => 1_000,
    }),
  );
}
function change(
  key: string,
  counter: number,
  isDeleted = false,
): SyncPushChange {
  return {
    key,
    value: `opaque value ${counter}`,
    hlc: { wallTimeMs: 1_000, counter },
    schemaVersion: 7,
    isDeleted,
  };
}
function headers(account = "a", device = "one") {
  return {
    "Content-Type": "application/json",
    "Test-Account": account,
    "Test-Device": device,
  };
}

describe("standalone Hono/D1 adapter", () => {
  it("keeps opaque winners, handles retries, and isolates authenticated accounts", async () => {
    const api = app();
    const push = async (changes: SyncPushChange[], account = "a") => {
      const response = await api.request("/bridge/push", {
        method: "POST",
        headers: headers(account),
        body: JSON.stringify({ changes }),
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<SyncPushResponse>;
    };
    const initial = await push([change("key", 2)]);
    const duplicate = await push([change("key", 2)]);
    expect(duplicate.results[0]).toEqual({
      accepted: false,
      winner: initial.results[0]!.winner,
    });
    expect((await push([change("key", 1)])).results[0]?.winner.value).toBe(
      "opaque value 2",
    );
    expect(
      (await push([change("key", 3, true)])).results[0]?.winner.isDeleted,
    ).toBe(true);
    expect((await push([change("key", 0)], "b")).results[0]?.winner.value).toBe(
      "opaque value 0",
    );
  });

  it("paginates a fixed head and advances across omitted own-device records", async () => {
    const api = app();
    await api.request("/bridge/push", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        changes: [change("first", 1), change("second", 2)],
      }),
    });
    const firstResponse = await api.request(
      "/bridge/pull?cursor=0&limit=1&excludeOwnDevice=false",
      { headers: headers("a", "two") },
    );
    expect(firstResponse.headers.get("Cache-Control")).toBe("no-store");
    const first = (await firstResponse.json()) as SyncPullResponse;
    expect(first.hasMore).toBe(true);
    await api.request("/bridge/push", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ changes: [change("third", 3)] }),
    });
    const second = (await (
      await api.request(
        `/bridge/pull?cursor=${first.cursor}&head=${first.head}&limit=1&excludeOwnDevice=false`,
        { headers: headers("a", "two") },
      )
    ).json()) as SyncPullResponse;
    expect(second.records.map((row) => row.key)).toEqual(["second"]);
    expect(second).toMatchObject({
      cursor: first.head,
      head: first.head,
      hasMore: false,
    });
    const own = (await (
      await api.request("/bridge/pull?cursor=0&excludeOwnDevice=true", {
        headers: headers(),
      })
    ).json()) as SyncPullResponse;
    expect(own.records).toEqual([]);
    expect(own.cursor).toBeGreaterThan(first.head);
  });

  it("rejects unauthenticated, invalid-device and future-clock writes", async () => {
    const api = app();
    const send = (
      requestHeaders: Record<string, string>,
      changes: SyncPushChange[],
    ) =>
      api.request("/bridge/push", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ changes }),
      });
    expect(
      (await send({ "Content-Type": "application/json" }, [])).status,
    ).toBe(401);
    expect((await send(headers("a", "bad device"), [])).status).toBe(400);
    expect(
      (
        await send(headers(), [
          { ...change("future", 0), hlc: { wallTimeMs: 400_000, counter: 0 } },
        ])
      ).status,
    ).toBe(400);
    const empty = (await (
      await api.request("/bridge/pull?cursor=0&excludeOwnDevice=false", {
        headers: headers(),
      })
    ).json()) as SyncPullResponse;
    expect(empty).toMatchObject({ records: [], cursor: 0 });
  });
});

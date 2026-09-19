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

describe("streaming Hono/D1 pull", () => {
  it("enforces auth and bounded windows, retaining the head across requests", async () => {
    const api = app();
    expect(
      (await api.request("/bridge/pull-stream?cursor=0&excludeOwnDevice=false"))
        .status,
    ).toBe(401);
    const headers = {
      "Test-Account": "owner",
      "Test-Device": "writer",
      "Content-Type": "application/json",
    };
    const changes = Array.from({ length: 40 }, (_, n) => change(`key-${n}`, n));
    expect(
      (
        await api.request("/bridge/push", {
          method: "POST",
          headers,
          body: JSON.stringify({ changes }),
        })
      ).status,
    ).toBe(200);
    const read = async (cursor: number, head?: number) => {
      const result = await api.request(
        `/bridge/pull-stream?cursor=${cursor}&limit=1&excludeOwnDevice=false${head === undefined ? "" : `&head=${head}`}`,
        { headers },
      );
      expect(result.status).toBe(200);
      return (await result.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    };
    const first = await read(0);
    expect(first).toHaveLength(33);
    expect(first.at(-1)).toEqual({ type: "end" });
    expect(first[31].hasMore).toBe(true);
    const second = await read(first[31].cursor, first[0].head);
    expect(second).toHaveLength(9);
    expect(second[7].hasMore).toBe(false);
    const other = await api.request(
      "/bridge/pull-stream?cursor=0&excludeOwnDevice=false",
      { headers: { ...headers, "Test-Account": "other" } },
    );
    expect(
      (await other.text()).split("\n").map((s) => s && JSON.parse(s))[0]
        .records,
    ).toEqual([]);
  });
  it("bounds page bytes in SQL and serves negotiated gzip without losing records", async () => {
    const api = app();
    const headers = {
      "Test-Account": "owner",
      "Test-Device": "writer",
      "Content-Type": "application/json",
    };
    for (let batch = 0; batch < 3; batch++) {
      const changes = Array.from({ length: 8 }, (_, n) => ({
        ...change(`large-${batch}-${n}`, batch * 8 + n),
        value: "x".repeat(60_000),
      }));
      expect(
        (
          await api.request("/bridge/push", {
            method: "POST",
            headers,
            body: JSON.stringify({ changes }),
          })
        ).status,
      ).toBe(200);
    }
    const result = await api.request(
      "/bridge/pull-stream?cursor=0&excludeOwnDevice=false",
      { headers: { ...headers, "Accept-Encoding": "gzip" } },
    );
    expect(result.headers.get("Content-Encoding")).toBe("gzip");
    const text = await new Response(
      result.body!.pipeThrough(new DecompressionStream("gzip")),
    ).text();
    const frames = text
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    expect(frames.at(-1)).toEqual({ type: "end" });
    const pages = frames.slice(0, -1);
    expect(pages).toHaveLength(3);
    expect(pages.flatMap((p) => p.records)).toHaveLength(24);
    expect(pages.every((p) => p.records.length <= 8)).toBe(true);
    const raw = await api.request(
      "/bridge/pull-stream?cursor=0&excludeOwnDevice=false",
      { headers: { ...headers, "Accept-Encoding": "gzip;q=0" } },
    );
    expect(raw.headers.get("Content-Encoding")).toBeNull();
    await raw.body?.cancel();
  });
});
